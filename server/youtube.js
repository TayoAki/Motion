import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  appURL,
  encryptionReady,
  seal,
  unseal,
  providerFetch,
  providerJSON,
  HttpError,
} from "./providers.js";

export function installYouTube({
  app,
  db,
  auth,
  digest,
  root,
  find,
  requireVerified,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS youtube_connections(user_id TEXT PRIMARY KEY REFERENCES users(id),channel_id TEXT,title TEXT,access_token TEXT,refresh_token TEXT,expires INTEGER);
    CREATE TABLE IF NOT EXISTS youtube_states(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
    CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),project_id TEXT,version INTEGER,title TEXT,description TEXT,privacy TEXT,publish_at TEXT,made_for_kids INTEGER,synthetic INTEGER,status TEXT,progress INTEGER,file TEXT,size INTEGER,upload_url TEXT,video_id TEXT,error TEXT,created TEXT,updated TEXT,UNIQUE(user_id,project_id,version));`);
  if (
    !db
      .prepare("PRAGMA table_info(publications)")
      .all()
      .some((c) => c.name === "channel_id")
  )
    db.exec("ALTER TABLE publications ADD COLUMN channel_id TEXT");
  const configured = !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    encryptionReady()
  );
  const callbackURL = () => `${appURL()}/api/youtube/callback`;
  const connection = (uid) =>
    db.prepare("SELECT * FROM youtube_connections WHERE user_id=?").get(uid);
  const get = (id, uid) =>
    db
      .prepare("SELECT * FROM publications WHERE id=? AND user_id=?")
      .get(id, uid);
  const safeJob = (j) => ({
    id: j.id,
    projectId: j.project_id,
    title: j.title,
    privacy: j.privacy,
    publishAt: j.publish_at,
    status: j.status,
    progress: j.progress,
    videoId: j.video_id,
    url: j.video_id
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(j.video_id)}`
      : null,
    error: j.error,
    created: j.created,
    updated: j.updated,
  });
  function ready() {
    if (!configured)
      throw new HttpError(
        503,
        "Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and a 32-byte TOKEN_ENCRYPTION_KEY to connect YouTube.",
      );
  }
  const refreshes = new Map();
  async function access(uid, force = false) {
    ready();
    const c = connection(uid);
    if (!c) throw new HttpError(400, "Connect a YouTube channel first.");
    if (!force && c.expires > Date.now() + 60000) return unseal(c.access_token);
    if (!refreshes.has(uid))
      refreshes.set(
        uid,
        (async () => {
          const token = await providerJSON(
            "https://oauth2.googleapis.com/token",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                refresh_token: unseal(c.refresh_token),
                grant_type: "refresh_token",
              }),
            },
            "Google token refresh",
          );
          if (!token.access_token)
            throw new HttpError(
              502,
              "Google did not return an access token. Reconnect your channel.",
            );
          db.prepare(
            "UPDATE youtube_connections SET access_token=?,refresh_token=?,expires=? WHERE user_id=?",
          ).run(
            seal(token.access_token),
            token.refresh_token ? seal(token.refresh_token) : c.refresh_token,
            Date.now() + Number(token.expires_in || 3600) * 1000,
            uid,
          );
          return token.access_token;
        })().finally(() => refreshes.delete(uid)),
      );
    return refreshes.get(uid);
  }
  async function youtube(uid, route, body, method = body ? "PUT" : "GET") {
    const call = async (force) =>
      providerFetch(`https://www.googleapis.com/youtube/v3${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${await access(uid, force)}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    let response = await call(false);
    if (response.status === 401) response = await call(true);
    if (!response.ok)
      throw new HttpError(
        502,
        "YouTube rejected this request. Check the channel's permissions, quota, and Google app verification.",
      );
    return response.status === 204 ? {} : response.json();
  }
  app.get("/api/youtube", auth, (req, res) => {
    const c = connection(req.user.id);
    res.json({
      configured,
      callbackURL: callbackURL(),
      channel: c ? { id: c.channel_id, title: c.title } : null,
      publications: db
        .prepare(
          "SELECT * FROM publications WHERE user_id=? ORDER BY created DESC LIMIT 100",
        )
        .all(req.user.id)
        .map(safeJob),
    });
  });
  app.post("/api/youtube/connect", auth, requireVerified, (req, res) => {
    ready();
    if (
      db
        .prepare(
          "SELECT id FROM publications WHERE user_id=? AND status IN ('queued','uploading','finishing')",
        )
        .get(req.user.id)
    )
      throw new HttpError(
        409,
        "Wait for active uploads before changing channels.",
      );
    db.prepare("DELETE FROM youtube_states WHERE expires<? OR user_id=?").run(
      Date.now(),
      req.user.id,
    );
    const state = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO youtube_states VALUES(?,?,?)").run(
      digest(state),
      req.user.id,
      Date.now() + 600000,
    );
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: callbackURL(),
      response_type: "code",
      scope:
        "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      access_type: "offline",
      prompt: "consent",
      state,
    }).toString();
    res.json({ url: url.toString() });
  });
  app.get("/api/youtube/callback", async (req, res) => {
    try {
      ready();
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const row = /^[0-9a-f]{64}$/.test(state)
        ? db
            .prepare("SELECT * FROM youtube_states WHERE hash=? AND expires>?")
            .get(digest(state), Date.now())
        : null;
      if (!req.user || !row || row.user_id !== req.user.id)
        throw new Error(
          "The connection request expired. Sign in and reconnect.",
        );
      db.prepare("DELETE FROM youtube_states WHERE hash=?").run(digest(state));
      if (req.query.error)
        throw new Error(
          "Google authorization was cancelled. Your channel was not changed.",
        );
      if (typeof req.query.code !== "string" || req.query.code.length > 2048)
        throw new Error("Google did not return an authorization code.");
      const token = await providerJSON(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code: req.query.code,
            redirect_uri: callbackURL(),
            grant_type: "authorization_code",
          }),
        },
        "Google authorization",
      );
      if (!token.access_token || !token.refresh_token)
        throw new Error(
          "Google did not grant offline access. Reconnect and grant the requested permissions.",
        );
      const channels = await providerJSON(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${token.access_token}` } },
        "YouTube channel lookup",
      );
      const channel = channels.items?.[0];
      if (!channel?.id)
        throw new Error("This Google account has no YouTube channel.");
      // Keep existing credentials until both authorization and channel discovery succeed.
      db.prepare(
        "INSERT INTO youtube_connections VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET channel_id=excluded.channel_id,title=excluded.title,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires=excluded.expires",
      ).run(
        req.user.id,
        channel.id,
        String(channel.snippet?.title || "YouTube channel").slice(0, 200),
        seal(token.access_token),
        seal(token.refresh_token),
        Date.now() + Number(token.expires_in || 3600) * 1000,
      );
      res.redirect(`${appURL()}/#autopilot?connected=1`);
    } catch (e) {
      const message = e.status
        ? "Google could not complete the connection. Check the OAuth configuration and try again."
        : e.message;
      res.redirect(
        `${appURL()}/#autopilot?error=${encodeURIComponent(message)}`,
      );
    }
  });
  app.delete("/api/youtube/connection", auth, async (req, res) => {
    if (
      db
        .prepare(
          "SELECT id FROM publications WHERE user_id=? AND status IN ('queued','uploading','finishing')",
        )
        .get(req.user.id)
    )
      throw new HttpError(
        409,
        "Wait for active uploads to finish before disconnecting.",
      );
    const c = connection(req.user.id);
    if (c) {
      const response = await providerFetch(
        "https://oauth2.googleapis.com/revoke",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: unseal(c.refresh_token) }),
        },
      );
      if (!response.ok && response.status !== 400)
        throw new HttpError(
          502,
          "Google could not revoke access. Retry disconnecting.",
        );
    }
    db.prepare("DELETE FROM youtube_connections WHERE user_id=?").run(
      req.user.id,
    );
    db.prepare("DELETE FROM youtube_states WHERE user_id=?").run(req.user.id);
    res.json({
      message:
        "Channel disconnected. Existing videos and YouTube schedules remain on YouTube.",
    });
  });
  function uploadURL(value) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      ![
        "www.googleapis.com",
        "youtube.googleapis.com",
        "upload.youtube.com",
      ].includes(url.hostname)
    )
      throw new Error("YouTube returned an invalid upload session.");
    return url.toString();
  }
  function offset(response, size) {
    const range = response.headers.get("range");
    const value = range ? Number(/^bytes=0-(\d+)$/.exec(range)?.[1]) + 1 : 0;
    if (!Number.isSafeInteger(value) || value < 0 || value > size)
      throw new Error("YouTube returned an invalid upload offset.");
    return value;
  }
  async function setVideo(job, videoId) {
    if (!/^[\w-]{6,64}$/.test(videoId || ""))
      throw new Error("YouTube did not return a video ID.");
    db.prepare(
      "UPDATE publications SET video_id=?,status='finishing',progress=95,updated=? WHERE id=?",
    ).run(videoId, new Date().toISOString(), job.id);
    const status = {
      privacyStatus: job.publish_at ? "private" : job.privacy,
      selfDeclaredMadeForKids: !!job.made_for_kids,
      containsSyntheticMedia: !!job.synthetic,
      ...(job.publish_at ? { publishAt: job.publish_at } : {}),
    };
    if (job.publish_at && Date.parse(job.publish_at) < Date.now() + 60000)
      throw new Error(
        "The scheduled time passed during upload. The video is private; choose a new time in YouTube Studio.",
      );
    const result = await youtube(job.user_id, "/videos?part=status", {
      id: videoId,
      status,
    });
    const actual = result.status || status;
    const warning =
      !job.publish_at && job.privacy !== actual.privacyStatus
        ? "Google kept this video private. Unverified YouTube API projects may only upload private videos."
        : null;
    db.prepare(
      "UPDATE publications SET status=?,privacy=?,publish_at=?,error=?,progress=100,updated=? WHERE id=?",
    ).run(
      actual.publishAt ? "scheduled" : "published",
      actual.privacyStatus || "private",
      actual.publishAt || null,
      warning,
      new Date().toISOString(),
      job.id,
    );
    await unlink(job.file).catch(() => {});
  }
  async function upload(job) {
    if (
      !connection(job.user_id) ||
      connection(job.user_id).channel_id !== job.channel_id
    )
      throw new Error(
        "The connected channel changed. Reconnect the original channel to resume this publication.",
      );
    if (job.video_id) return setVideo(job, job.video_id);
    let url = job.upload_url ? unseal(job.upload_url) : null;
    if (!url) {
      const response = await providerFetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await access(job.user_id)}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Length": String(job.size),
            "X-Upload-Content-Type": "video/mp4",
          },
          body: JSON.stringify({
            snippet: {
              title: job.title,
              description: job.description,
              categoryId: "22",
            },
            status: {
              privacyStatus: "private",
              selfDeclaredMadeForKids: !!job.made_for_kids,
              containsSyntheticMedia: !!job.synthetic,
            },
          }),
        },
      );
      if (!response.ok || !response.headers.get("location"))
        throw new Error(
          "YouTube could not start the upload. Check API quota and channel permissions.",
        );
      url = uploadURL(response.headers.get("location"));
      db.prepare("UPDATE publications SET upload_url=? WHERE id=?").run(
        seal(url),
        job.id,
      );
    }
    uploadURL(url);
    const send = async (headers, body) => {
      const call = async (force) =>
        providerFetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${await access(job.user_id, force)}`,
            ...headers,
          },
          ...(body ? { body } : {}),
        });
      let response = await call(false);
      if (response.status === 401) response = await call(true);
      return response;
    };
    // Query the server before resuming, including after an ambiguous network failure.
    let response = await send({
      "Content-Length": "0",
      "Content-Range": `bytes */${job.size}`,
    });
    if ([200, 201].includes(response.status))
      return setVideo(job, (await response.json()).id);
    if (response.status !== 308)
      throw new Error(
        "The upload session is unavailable. Check your channel before retrying; no replacement upload was created.",
      );
    let start = offset(response, job.size);
    const file = await open(job.file, "r");
    try {
      while (start < job.size) {
        const end = Math.min(start + 8 * 1024 * 1024, job.size);
        const buffer = Buffer.alloc(end - start);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
        if (bytesRead !== buffer.length)
          throw new Error("The private upload copy is incomplete.");
        response = await send(
          {
            "Content-Type": "video/mp4",
            "Content-Length": String(buffer.length),
            "Content-Range": `bytes ${start}-${end - 1}/${job.size}`,
          },
          buffer,
        );
        if ([200, 201].includes(response.status))
          return setVideo(job, (await response.json()).id);
        if (response.status !== 308)
          throw new Error(
            "YouTube paused the upload. Retry to resume the same session.",
          );
        const next = offset(response, job.size);
        if (next <= start)
          throw new Error(
            "YouTube did not accept the upload chunk. Retry to resume.",
          );
        start = next;
        db.prepare(
          "UPDATE publications SET progress=?,updated=? WHERE id=?",
        ).run(
          Math.floor((start / job.size) * 90),
          new Date().toISOString(),
          job.id,
        );
      }
      throw new Error(
        "YouTube has not confirmed completion. Retry to check the existing session.",
      );
    } finally {
      await file.close();
    }
  }
  let processing = false;
  async function drain() {
    if (processing || !configured) return;
    processing = true;
    try {
      let job;
      while (
        (job = db
          .prepare(
            "SELECT * FROM publications WHERE status='queued' ORDER BY created LIMIT 1",
          )
          .get())
      ) {
        db.prepare(
          "UPDATE publications SET status='uploading',error=NULL,updated=? WHERE id=?",
        ).run(new Date().toISOString(), job.id);
        try {
          await upload(job);
        } catch (e) {
          db.prepare(
            "UPDATE publications SET status='failed',error=?,updated=? WHERE id=?",
          ).run(
            e instanceof HttpError || /^(The |YouTube |Google )/.test(e.message)
              ? e.message
              : "Upload interrupted. Retry to resume the same YouTube session.",
            new Date().toISOString(),
            job.id,
          );
        }
      }
    } finally {
      processing = false;
    }
  }
  const locks = new Set();
  async function publish(uid, body) {
    ready();
    if (!connection(uid)) throw new HttpError(400, "Connect a channel first.");
    const project = find(String(body.projectId || ""), uid);
    if (!project) throw new HttpError(404, "Project not found.");
    if (project.status !== "succeeded" || !project.file || project.dirty)
      throw new HttpError(
        409,
        "Finish exporting the latest project changes before publishing.",
      );
    if (!["private", "unlisted", "public"].includes(body.privacy))
      throw new HttpError(400, "Choose a valid privacy setting.");
    const title = String(body.title || project.title || "My video").trim();
    if (!title || title.length > 100 || /[<>]/.test(title))
      throw new HttpError(
        400,
        "YouTube titles need 1–100 characters and cannot contain angle brackets.",
      );
    const description = String(body.description || "").trim();
    if (description.length > 5000 || /[<>]/.test(description))
      throw new HttpError(
        400,
        "Descriptions can contain up to 5,000 characters, without angle brackets.",
      );
    let publishAt = null;
    if (body.publishAt) {
      const date = Date.parse(body.publishAt);
      if (!Number.isFinite(date) || date < Date.now() + 600000)
        throw new HttpError(
          400,
          "Schedule at least ten minutes in the future.",
        );
      publishAt = new Date(date).toISOString();
    }
    if (body.confirmed !== true)
      throw new HttpError(
        400,
        "Confirm your upload and publishing choices before continuing.",
      );
    const key = `${uid}:${project.id}:${project.exports}`;
    if (
      locks.has(key) ||
      db
        .prepare(
          "SELECT id FROM publications WHERE user_id=? AND project_id=? AND version=?",
        )
        .get(uid, project.id, project.exports)
    )
      throw new HttpError(
        409,
        "This export already has a publication. Retry the existing job or export a new version.",
      );
    locks.add(key);
    const id = randomUUID(),
      file = path.join(root, "youtube", `${id}.mp4`);
    try {
      if (
        db
          .prepare(
            "SELECT count(*) AS n FROM publications WHERE status IN ('queued','uploading','finishing')",
          )
          .get().n >= 20
      )
        throw new HttpError(429, "The upload queue is full. Try again later.");
      await mkdir(path.dirname(file), { recursive: true });
      await copyFile(path.join(root, project.file), file);
      const size = (await stat(file)).size;
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO publications(id,user_id,project_id,version,title,description,privacy,publish_at,made_for_kids,synthetic,status,progress,file,size,upload_url,video_id,error,created,updated,channel_id) VALUES(?,?,?,?,?,?,?,?,?,?,'queued',0,?,?,NULL,NULL,NULL,?,?,?)",
      ).run(
        id,
        uid,
        project.id,
        project.exports,
        title,
        description,
        body.privacy,
        publishAt,
        body.madeForKids ? 1 : 0,
        body.synthetic ? 1 : 0,
        file,
        size,
        now,
        now,
        connection(uid).channel_id,
      );
      setImmediate(() => void drain());
      return safeJob(get(id, uid));
    } catch (e) {
      await unlink(file).catch(() => {});
      throw e;
    } finally {
      locks.delete(key);
    }
  }
  app.post("/api/youtube/publish", auth, requireVerified, async (req, res) =>
    res.status(202).json(await publish(req.user.id, req.body)),
  );
  app.post(
    "/api/youtube/publications/:id/retry",
    auth,
    requireVerified,
    (req, res) => {
      ready();
      const job = get(req.params.id, req.user.id);
      if (!job) throw new HttpError(404, "Publication not found.");
      if (job.status !== "failed")
        throw new HttpError(409, "Only interrupted uploads can be retried.");
      if (connection(req.user.id)?.channel_id !== job.channel_id)
        throw new HttpError(
          409,
          "Reconnect the original channel before retrying this publication.",
        );
      db.prepare(
        "UPDATE publications SET status='queued',error=NULL WHERE id=?",
      ).run(job.id);
      res.status(202).json(safeJob(get(job.id, req.user.id)));
      void drain();
    },
  );
  app.post(
    "/api/youtube/publications/:id/cancel-schedule",
    auth,
    async (req, res) => {
      const job = get(req.params.id, req.user.id);
      if (!job) throw new HttpError(404, "Publication not found.");
      if (
        job.status !== "scheduled" ||
        !job.video_id ||
        Date.parse(job.publish_at) <= Date.now()
      )
        throw new HttpError(
          409,
          "This publication is no longer scheduled. Manage it in YouTube Studio.",
        );
      if (connection(req.user.id)?.channel_id !== job.channel_id)
        throw new HttpError(
          409,
          "Reconnect the original channel before changing this schedule.",
        );
      // Omitting publishAt in a full status update removes the scheduled time.
      await youtube(req.user.id, "/videos?part=status", {
        id: job.video_id,
        status: {
          privacyStatus: "private",
          selfDeclaredMadeForKids: !!job.made_for_kids,
          containsSyntheticMedia: !!job.synthetic,
        },
      });
      db.prepare(
        "UPDATE publications SET status='published',privacy='private',publish_at=NULL,updated=? WHERE id=?",
      ).run(new Date().toISOString(), job.id);
      res.json(safeJob(get(job.id, req.user.id)));
    },
  );
  db.prepare(
    "UPDATE publications SET status='queued' WHERE status IN ('uploading','finishing')",
  ).run();
  setImmediate(() => void drain());
  function retry(uid, id, publishAt) {
    ready();
    const job = get(id, uid);
    if (!job) throw new HttpError(404, "Publication not found.");
    if (job.status !== "failed")
      throw new HttpError(409, "Only interrupted uploads can be retried.");
    if (connection(uid)?.channel_id !== job.channel_id)
      throw new HttpError(
        409,
        "Reconnect the original channel before retrying this publication.",
      );
    if (
      publishAt &&
      (!Number.isFinite(Date.parse(publishAt)) ||
        Date.parse(publishAt) < Date.now() + 600000)
    )
      throw new HttpError(
        400,
        "Choose a publishing time at least ten minutes from now.",
      );
    db.prepare(
      "UPDATE publications SET status='queued',error=NULL,publish_at=? WHERE id=?",
    ).run(publishAt ? new Date(publishAt).toISOString() : job.publish_at, id);
    setImmediate(() => void drain());
    return safeJob(get(id, uid));
  }
  return { configured, publish, retry };
}
