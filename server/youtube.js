import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { appURL, providerFetch, HttpError } from "./providers.js";

// Preserve the studio's YouTube API while delegating connection and delivery to Outstand.
export function installYouTube({
  app,
  db,
  auth,
  digest,
  root,
  find,
  requireVerified,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),project_id TEXT,version INTEGER,title TEXT,description TEXT,privacy TEXT,publish_at TEXT,made_for_kids INTEGER,synthetic INTEGER,status TEXT,progress INTEGER,file TEXT,size INTEGER,upload_url TEXT,video_id TEXT,error TEXT,created TEXT,updated TEXT,UNIQUE(user_id,project_id,version));
    CREATE TABLE IF NOT EXISTS outstand_connections(user_id TEXT PRIMARY KEY REFERENCES users(id),account_id TEXT UNIQUE,channel_id TEXT,title TEXT,created TEXT);
    CREATE TABLE IF NOT EXISTS outstand_states(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);`);
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(publications)")
      .all()
      .map((c) => c.name),
  );
  const additions = {
    channel_id: "TEXT",
    provider: "TEXT DEFAULT 'google'",
    outstand_post_id: "TEXT",
    outstand_media_id: "TEXT",
    outstand_media_url: "TEXT",
    outstand_upload_done: "INTEGER DEFAULT 0",
    outstand_request: "TEXT",
    outstand_create_at: "INTEGER",
    outstand_activated: "INTEGER DEFAULT 0",
    outstand_last_poll: "INTEGER DEFAULT 0",
    outstand_attempt: "INTEGER DEFAULT 0",
    outstand_retry: "INTEGER DEFAULT 0",
    outstand_recreate: "TEXT",
    outstand_history: "TEXT DEFAULT '[]'",
  };
  for (const [name, type] of Object.entries(additions))
    if (!columns.has(name))
      db.exec(`ALTER TABLE publications ADD COLUMN ${name} ${type}`);
  db.prepare(
    "UPDATE publications SET status='blocked',error='Legacy Google job retained. Check YouTube Studio before creating another export.' WHERE provider='google' AND status IN ('queued','uploading','finishing')",
  ).run();
  const configured = !!process.env.OUTSTAND_API_KEY;
  const connection = (uid) =>
    db.prepare("SELECT * FROM outstand_connections WHERE user_id=?").get(uid);
  const get = (id, uid) =>
    db
      .prepare("SELECT * FROM publications WHERE id=? AND user_id=?")
      .get(id, uid);
  const callbackURL = () => `${appURL()}/api/youtube/callback`;
  function ready() {
    if (!configured)
      throw new HttpError(
        503,
        "Configure OUTSTAND_API_KEY on the server to connect and publish to YouTube.",
      );
  }
  function update(id, values) {
    const fields = { ...values, updated: new Date().toISOString() };
    db.prepare(
      `UPDATE publications SET ${Object.keys(fields)
        .map((k) => `${k}=?`)
        .join(",")} WHERE id=?`,
    ).run(...Object.values(fields), id);
  }
  const safeJob = (j) => ({
    id: j.id,
    projectId: j.project_id,
    title: j.title,
    provider: j.provider,
    privacy: j.privacy,
    publishAt: j.publish_at,
    status: j.status,
    progress: j.progress,
    videoId: j.video_id,
    postId: j.outstand_post_id,
    url:
      j.video_id && /^[\w-]{6,64}$/.test(j.video_id)
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(j.video_id)}`
        : null,
    error: j.error,
    created: j.created,
    updated: j.updated,
    retryable: j.provider === "outstand" && j.status === "failed",
  });
  async function api(route, options = {}, acceptCreatedPost = false) {
    ready();
    let response;
    try {
      response = await providerFetch(`https://api.outstand.so/v1${route}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${process.env.OUTSTAND_API_KEY}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    } catch {
      throw new HttpError(
        502,
        "Outstand could not be reached. Retry the existing job to recover its state.",
      );
    }
    const result = await response.json().catch(() => ({}));
    if (acceptCreatedPost && typeof result.post?.id === "string") return result;
    if (!response.ok || result.success === false) {
      const error = new HttpError(
        502,
        response.status === 402
          ? "Outstand requires an active subscription before API publishing is available."
          : response.status === 403
            ? "The Outstand API key lacks permission for this operation."
            : "Outstand rejected the request. Check its dashboard, account connection, and API key permissions.",
      );
      error.providerStatus = response.status;
      throw error;
    }
    return result;
  }
  async function ownedAccount(uid, id) {
    const query = new URLSearchParams({
      id,
      tenantId: uid,
      network: "youtube",
      includeTokens: "false",
      limit: "100",
    });
    const result = await api(`/social-accounts?${query}`);
    const account = result.data?.find(
      (a) =>
        a.id === id &&
        a.network === "youtube" &&
        a.tenant_id === uid &&
        (a.isActive === true || a.isActive === 1),
    );
    if (!account)
      throw new HttpError(
        403,
        "Outstand did not confirm an active YouTube account belonging to this workspace. Reconnect it from Motion.",
      );
    return account;
  }
  function active(uid) {
    return db
      .prepare(
        "SELECT id FROM publications WHERE user_id=? AND provider='outstand' AND status IN ('queued','uploading','finishing','waiting','scheduled')",
      )
      .get(uid);
  }
  function assertChannel(job) {
    if (connection(job.user_id)?.account_id !== job.channel_id)
      throw new HttpError(
        409,
        "Reconnect the original Outstand channel before managing this publication.",
      );
  }
  app.get("/api/youtube", auth, (req, res) => {
    const c = connection(req.user.id);
    res.json({
      configured,
      provider: "outstand",
      callbackURL: callbackURL(),
      channel: c
        ? { id: c.channel_id, title: c.title, accountId: c.account_id }
        : null,
      publications: db
        .prepare(
          "SELECT * FROM publications WHERE user_id=? ORDER BY created DESC LIMIT 100",
        )
        .all(req.user.id)
        .map(safeJob),
    });
  });
  app.post("/api/youtube/connect", auth, requireVerified, async (req, res) => {
    ready();
    if (active(req.user.id))
      throw new HttpError(
        409,
        "Finish or cancel pending Outstand publications before changing channels.",
      );
    const state = randomBytes(32).toString("hex"),
      redirect = new URL(callbackURL());
    redirect.searchParams.set("state", state);
    db.prepare("DELETE FROM outstand_states WHERE expires<? OR user_id=?").run(
      Date.now(),
      req.user.id,
    );
    db.prepare("INSERT INTO outstand_states VALUES(?,?,?)").run(
      digest(state),
      req.user.id,
      Date.now() + 600000,
    );
    const result = await api("/social-networks/youtube/auth-url", {
      method: "POST",
      body: JSON.stringify({
        redirect_uri: redirect.toString(),
        tenant_id: req.user.id,
        force_account_selection: true,
      }),
    });
    const url = new URL(result.data?.auth_url || "invalid:");
    if (
      url.protocol !== "https:" ||
      !["www.outstand.so", "outstand.so"].includes(url.hostname) ||
      !url.pathname.startsWith("/app/api/socials/youtube/") ||
      url.username ||
      url.password ||
      url.port
    )
      throw new HttpError(
        502,
        "Outstand returned an invalid connection address.",
      );
    res.json({ url: url.toString() });
  });
  app.get("/api/youtube/callback", async (req, res) => {
    try {
      ready();
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const record = /^[a-f0-9]{64}$/.test(state)
        ? db
            .prepare("SELECT * FROM outstand_states WHERE hash=? AND expires>?")
            .get(digest(state), Date.now())
        : null;
      if (!req.user || !record || record.user_id !== req.user.id)
        throw new HttpError(
          400,
          "The connection request expired. Sign in and reconnect through Outstand.",
        );
      db.prepare("DELETE FROM outstand_states WHERE hash=?").run(digest(state));
      if (req.query.error || req.query.success !== "true")
        throw new HttpError(
          400,
          "Outstand authorization was cancelled or did not succeed.",
        );
      const id = req.query.account_id;
      if (typeof id !== "string" || !id || id.length > 255)
        throw new HttpError(
          400,
          "Outstand did not return an account identifier.",
        );
      const account = await ownedAccount(req.user.id, id);
      if (active(req.user.id))
        throw new HttpError(
          409,
          "A publication started while connecting. Finish it before changing channels.",
        );
      if (
        db
          .prepare(
            "SELECT user_id FROM outstand_connections WHERE account_id=? AND user_id<>?",
          )
          .get(id, req.user.id)
      )
        throw new HttpError(
          409,
          "This Outstand account is already connected to another workspace.",
        );
      db.prepare(
        "INSERT INTO outstand_connections VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET account_id=excluded.account_id,channel_id=excluded.channel_id,title=excluded.title,created=excluded.created",
      ).run(
        req.user.id,
        id,
        account.network_unique_id || id,
        String(account.nickname || account.username || "YouTube channel").slice(
          0,
          200,
        ),
        new Date().toISOString(),
      );
      res.redirect(`${appURL()}/#autopilot?connected=1`);
    } catch (error) {
      res.redirect(
        `${appURL()}/#autopilot?error=${encodeURIComponent(error instanceof HttpError ? error.message : "Outstand could not complete the connection. Check its configuration and try again.")}`,
      );
    }
  });
  app.delete("/api/youtube/connection", auth, async (req, res) => {
    if (active(req.user.id))
      throw new HttpError(
        409,
        "Finish or cancel pending Outstand publications before disconnecting.",
      );
    const c = connection(req.user.id);
    if (c) {
      await ownedAccount(req.user.id, c.account_id);
      await api(`/social-accounts/${encodeURIComponent(c.account_id)}`, {
        method: "DELETE",
      });
    }
    db.prepare("DELETE FROM outstand_connections WHERE user_id=?").run(
      req.user.id,
    );
    db.prepare("DELETE FROM outstand_states WHERE user_id=?").run(req.user.id);
    db.prepare(
      "UPDATE series SET active=0,error='YouTube channel disconnected. Reconnect before resuming.' WHERE user_id=?",
    ).run(req.user.id);
    res.json({
      message:
        "Channel disconnected from Outstand. Published videos remain on YouTube.",
    });
  });
  function schedule(value) {
    if (!value) return null;
    const time = Date.parse(value);
    if (
      !Number.isFinite(time) ||
      time < Date.now() + 600000 ||
      time > Date.now() + 30 * 86400000
    )
      throw new HttpError(
        400,
        "Choose a publishing time at least ten minutes and no more than 30 days from now.",
      );
    return new Date(time).toISOString();
  }
  function mediaURL(value, upload = false) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !(upload
        ? url.hostname.endsWith(".r2.cloudflarestorage.com")
        : url.hostname === "media.outstand.so") ||
      url.username ||
      url.password ||
      url.port
    )
      throw new HttpError(502, "Outstand returned an invalid media address.");
    return url.toString();
  }
  async function prepareMedia(job) {
    if (job.outstand_media_url) return job.outstand_media_url;
    let mediaId = job.outstand_media_id;
    if (!mediaId || !job.outstand_upload_done) {
      const result = await api("/media/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: `${job.id}.mp4`,
          content_type: "video/mp4",
        }),
      });
      if (typeof result.data?.id !== "string")
        throw new HttpError(502, "Outstand did not return a media identifier.");
      const url = mediaURL(result.data.upload_url, true);
      mediaId = result.data.id;
      update(job.id, {
        outstand_media_id: mediaId,
        outstand_upload_done: 0,
        progress: 10,
      });
      const stream = createReadStream(job.file);
      try {
        const response = await providerFetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(job.size),
          },
          body: stream,
          duplex: "half",
          signal: AbortSignal.timeout(300000),
        });
        await response.body?.cancel();
        if (!response.ok)
          throw new HttpError(
            502,
            "Outstand media transfer failed. Retry to upload this export again.",
          );
      } finally {
        stream.destroy();
      }
      update(job.id, { outstand_upload_done: 1, progress: 70 });
    }
    const result = await api(`/media/${encodeURIComponent(mediaId)}/confirm`, {
        method: "POST",
        body: JSON.stringify({ size: job.size }),
      }),
      media = result.data || result;
    if (media.status !== "active" || typeof media.url !== "string")
      throw new HttpError(
        502,
        "Outstand has not confirmed the uploaded media.",
      );
    const url = mediaURL(media.url);
    update(job.id, { outstand_media_url: url, progress: 80 });
    return url;
  }
  function target(post, job) {
    if (
      !post ||
      post.id !== job.outstand_post_id ||
      post.socialAccounts?.length !== 1 ||
      post.socialAccounts[0].id !== job.channel_id ||
      post.socialAccounts[0].network !== "youtube"
    )
      throw new HttpError(
        502,
        "Outstand did not confirm the exact requested YouTube destination. No additional destinations are authorized.",
      );
    return post.socialAccounts[0];
  }
  function resultStatus(job, post) {
    const account = target(post, job);
    if (account.status === "published" && account.platformPostId) {
      update(job.id, {
        status: "published",
        progress: 100,
        video_id: String(account.platformPostId),
        publish_at: post.scheduledAt || null,
        error: null,
        outstand_activated: 1,
        outstand_retry: 0,
      });
      return;
    }
    if (account.status === "failed") {
      const code = String(account.error || "").match(
        /release_pending|org_limit_reached|daily_limit_reached|provider_quota_exhausted|quota_unavailable/,
      )?.[0];
      throw new HttpError(
        409,
        `Outstand reported a failed YouTube publication${code ? ` (${code})` : ""}. Inspect the Outstand dashboard before retrying.`,
      );
    }
    if (post.isDraft)
      throw new HttpError(
        409,
        "This post is a draft in Outstand. Retry explicitly to resume publishing.",
      );
    update(job.id, {
      status:
        post.scheduledAt && Date.parse(post.scheduledAt) > Date.now()
          ? "scheduled"
          : "waiting",
      progress: 95,
      error: null,
      outstand_activated: 1,
      outstand_retry: 0,
      publish_at: post.scheduledAt || null,
    });
  }
  async function loadPost(job) {
    return (await api(`/posts/${encodeURIComponent(job.outstand_post_id)}`))
      .post;
  }
  function finishReplacement(job) {
    update(job.id, {
      outstand_history: JSON.stringify([
        ...JSON.parse(job.outstand_history || "[]"),
        job.outstand_recreate,
      ]),
      outstand_post_id: null,
      outstand_request: null,
      outstand_create_at: null,
      outstand_recreate: null,
      outstand_activated: 0,
      outstand_attempt: job.outstand_attempt + 1,
    });
    return get(job.id, job.user_id);
  }
  async function processJob(job) {
    assertChannel(job);
    if (job.outstand_recreate) {
      try {
        const post = await loadPost(job),
          account = target(post, job);
        if (
          account.status !== "failed" ||
          post.publishedAt ||
          account.platformPostId
        )
          throw new HttpError(
            409,
            "Outstand no longer reports a wholly failed post. Check the dashboard before retrying.",
          );
        await api(`/posts/${encodeURIComponent(job.outstand_recreate)}`, {
          method: "DELETE",
        });
      } catch (error) {
        if (error.providerStatus !== 404) throw error;
      }
      job = finishReplacement(job);
    }
    if (job.outstand_post_id) {
      const post = await loadPost(job),
        account = target(post, job);
      if (
        account.status === "failed" &&
        job.outstand_retry &&
        !post.publishedAt &&
        !account.platformPostId
      ) {
        update(job.id, { outstand_recreate: job.outstand_post_id });
        return processJob(get(job.id, job.user_id));
      }
      if (!post.isDraft) {
        if (
          job.outstand_retry &&
          job.publish_at &&
          post.scheduledAt !== job.publish_at &&
          account.status === "pending" &&
          !post.publishedAt
        ) {
          schedule(job.publish_at);
          await api(`/posts/${encodeURIComponent(job.outstand_post_id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              scheduledAt: job.publish_at,
              isDraft: false,
            }),
          });
          return resultStatus(job, await loadPost(job));
        }
        return resultStatus(job, post);
      }
      if (job.outstand_activated && !job.outstand_retry)
        throw new HttpError(
          409,
          "This post was paused in Outstand. Retry explicitly to resume it.",
        );
    } else {
      const url = await prepareMedia(job);
      job = get(job.id, job.user_id);
      if (!job.outstand_request) {
        const request = {
          containers: [
            {
              content: job.description || job.title,
              media: [{ url, filename: `${job.id}.mp4` }],
            },
          ],
          accounts: [job.channel_id],
          isDraft: true,
          ...(job.publish_at ? { scheduledAt: job.publish_at } : {}),
          youtube: {
            title: job.title,
            privacyStatus: job.privacy,
            madeForKids: !!job.made_for_kids,
            containsSyntheticMedia: !!job.synthetic,
          },
        };
        update(job.id, {
          outstand_request: JSON.stringify(request),
          outstand_create_at: Date.now(),
          progress: 85,
        });
        job = get(job.id, job.user_id);
      }
      if (Date.now() - job.outstand_create_at >= 23 * 3600000)
        throw new HttpError(
          409,
          "The Outstand idempotency recovery window expired. Inspect its dashboard before creating another export; this job will not create a replacement post.",
        );
      const result = await api(
        "/posts",
        {
          method: "POST",
          headers: { "Idempotency-Key": `${job.id}-${job.outstand_attempt}` },
          body: job.outstand_request,
        },
        true,
      );
      if (typeof result.post?.id !== "string")
        throw new HttpError(502, "Outstand did not return a post identifier.");
      update(job.id, {
        outstand_post_id: result.post.id,
        progress: 90,
        status: "finishing",
      });
      job = get(job.id, job.user_id);
      const post = await loadPost(job);
      target(post, job);
      if (!post.isDraft) return resultStatus(job, post);
    }
    if (job.publish_at && Date.parse(job.publish_at) < Date.now() + 60000)
      throw new HttpError(
        409,
        "The publishing time was missed during preparation. Retry with a future time; this draft will not publish immediately.",
      );
    const result = await api(
      `/posts/${encodeURIComponent(job.outstand_post_id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          isDraft: false,
          ...(job.publish_at ? { scheduledAt: job.publish_at } : {}),
        }),
      },
    );
    if (result.scheduled === false && result.rescheduled !== true)
      throw new HttpError(
        502,
        "Outstand did not confirm that publishing was queued. Inspect the existing post before retrying.",
      );
    update(job.id, { outstand_activated: 1 });
    resultStatus(job, await loadPost(job));
  }
  const locks = new Set();
  const jobLocks = new Set();
  async function publish(uid, body) {
    ready();
    const channel = connection(uid);
    if (!channel)
      throw new HttpError(
        400,
        "Connect a YouTube channel through Outstand first.",
      );
    const project = find(String(body.projectId || ""), uid);
    if (!project) throw new HttpError(404, "Project not found.");
    if (project.status !== "succeeded" || !project.file || project.dirty)
      throw new HttpError(
        409,
        "Finish exporting the latest project changes before publishing.",
      );
    if (!["private", "unlisted", "public"].includes(body.privacy))
      throw new HttpError(400, "Choose a valid privacy setting.");
    const title = String(body.title || project.title || "My video").trim(),
      description = String(body.description || "").trim();
    if (!title || title.length > 100 || /[<>]/.test(title))
      throw new HttpError(
        400,
        "YouTube titles need 1–100 characters without angle brackets.",
      );
    if (description.length > 5000 || /[<>]/.test(description))
      throw new HttpError(
        400,
        "Descriptions need up to 5,000 characters without angle brackets.",
      );
    const publishAt = schedule(body.publishAt);
    if (body.confirmed !== true)
      throw new HttpError(
        400,
        "Confirm uploading to Outstand media storage and your publishing choices.",
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
        "This export already has a publication. Retry it or export a new version.",
      );
    locks.add(key);
    const id = randomUUID(),
      file = path.join(root, "publishing", `${id}.mp4`);
    try {
      if (
        db
          .prepare(
            "SELECT count(*) AS n FROM publications WHERE provider='outstand' AND status IN ('queued','uploading','finishing')",
          )
          .get().n >= 20
      )
        throw new HttpError(429, "The upload queue is full. Try again later.");
      await ownedAccount(uid, channel.account_id);
      await mkdir(path.dirname(file), { recursive: true });
      await copyFile(path.join(root, project.file), file);
      const size = (await stat(file)).size,
        now = new Date().toISOString();
      if (
        db
          .prepare(
            "SELECT count(*) AS n FROM publications WHERE provider='outstand' AND status IN ('queued','uploading','finishing')",
          )
          .get().n >= 20
      )
        throw new HttpError(429, "The upload queue is full. Try again later.");
      db.prepare(
        "INSERT INTO publications(id,user_id,project_id,version,title,description,privacy,publish_at,made_for_kids,synthetic,status,progress,file,size,created,updated,channel_id,provider) VALUES(?,?,?,?,?,?,?,?,?,?,'queued',0,?,?,?,?,?,'outstand')",
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
        channel.account_id,
      );
      setImmediate(() => void drain());
      return safeJob(get(id, uid));
    } catch (error) {
      await unlink(file).catch(() => {});
      throw error;
    } finally {
      locks.delete(key);
    }
  }
  function retry(uid, id, publishAt) {
    ready();
    const job = get(id, uid);
    if (!job) throw new HttpError(404, "Publication not found.");
    if (jobLocks.has(id))
      throw new HttpError(
        409,
        "This publication is being checked. Try again shortly.",
      );
    if (job.provider !== "outstand")
      throw new HttpError(
        409,
        "Manage legacy Google publications in YouTube Studio.",
      );
    if (job.status !== "failed")
      throw new HttpError(409, "Only failed publications can be retried.");
    assertChannel(job);
    const next = publishAt ? schedule(publishAt) : job.publish_at;
    if (
      !job.outstand_post_id &&
      job.outstand_request &&
      next !== job.publish_at
    )
      throw new HttpError(
        409,
        "Recover the original Outstand draft before changing its time.",
      );
    if (
      !job.outstand_post_id &&
      job.outstand_create_at &&
      Date.now() - job.outstand_create_at >= 23 * 3600000
    )
      throw new HttpError(
        409,
        "The idempotency recovery window expired. Check Outstand before creating another export.",
      );
    update(id, {
      status: "queued",
      error: null,
      outstand_retry: 1,
      publish_at: next,
    });
    setImmediate(() => void drain());
    return safeJob(get(id, uid));
  }
  app.post("/api/youtube/publish", auth, requireVerified, async (req, res) =>
    res.status(202).json(await publish(req.user.id, req.body)),
  );
  app.post(
    "/api/youtube/publications/:id/retry",
    auth,
    requireVerified,
    (req, res) =>
      res
        .status(202)
        .json(retry(req.user.id, req.params.id, req.body.publishAt)),
  );
  app.post(
    "/api/youtube/publications/:id/cancel-schedule",
    auth,
    async (req, res) => {
      ready();
      const job = get(req.params.id, req.user.id);
      if (!job) throw new HttpError(404, "Publication not found.");
      if (job.provider !== "outstand")
        throw new HttpError(
          409,
          "Manage legacy Google schedules in YouTube Studio.",
        );
      if (
        !job.outstand_post_id ||
        !job.publish_at ||
        Date.parse(job.publish_at) < Date.now() + 60000 ||
        !["scheduled", "waiting", "failed"].includes(job.status)
      )
        throw new HttpError(
          409,
          "This publication is not safely cancellable here. Check Outstand and YouTube Studio.",
        );
      assertChannel(job);
      if (jobLocks.has(job.id))
        throw new HttpError(
          409,
          "This publication is being checked. Try again shortly.",
        );
      jobLocks.add(job.id);
      try {
        const post = await loadPost(job),
          account = target(post, job);
        if (
          post.publishedAt ||
          account.platformPostId ||
          account.status === "published"
        )
          throw new HttpError(
            409,
            "This video was already published. Manage it in YouTube Studio.",
          );
        await api(`/posts/${encodeURIComponent(job.outstand_post_id)}`, {
          method: "DELETE",
        });
      } catch (error) {
        if (error.providerStatus !== 404) throw error;
      } finally {
        jobLocks.delete(job.id);
      }
      update(job.id, { status: "cancelled", error: null });
      res.json(safeJob(get(job.id, req.user.id)));
    },
  );
  let processing = false;
  async function drain() {
    if (processing || !configured) return;
    processing = true;
    try {
      const interval = process.env.NODE_ENV === "test" ? 200 : 15000;
      const jobs = db
        .prepare(
          "SELECT * FROM publications WHERE provider='outstand' AND (status='queued' OR (status IN ('waiting','scheduled') AND outstand_last_poll<? AND (publish_at IS NULL OR publish_at<? OR outstand_last_poll<?))) ORDER BY created LIMIT 20",
        )
        .all(
          Date.now() - interval,
          new Date(Date.now() + 60000).toISOString(),
          Date.now() - (process.env.NODE_ENV === "test" ? 200 : 300000),
        );
      for (const job of jobs) {
        if (jobLocks.has(job.id)) continue;
        jobLocks.add(job.id);
        update(job.id, {
          outstand_last_poll: Date.now(),
          ...(job.status === "queued"
            ? { status: "uploading", error: null }
            : {}),
        });
        try {
          if (["waiting", "scheduled"].includes(job.status))
            resultStatus(job, await loadPost(job));
          else await processJob(job);
        } catch (error) {
          const polling = ["waiting", "scheduled"].includes(job.status),
            terminal = error.status === 409 || error.providerStatus === 404;
          update(job.id, {
            status: polling && !terminal ? job.status : "failed",
            error:
              error instanceof HttpError
                ? error.message
                : "Outstand processing was interrupted. Retry the existing job; no replacement post has been authorized.",
          });
        } finally {
          jobLocks.delete(job.id);
        }
      }
    } finally {
      processing = false;
    }
  }
  db.prepare(
    "UPDATE publications SET status='queued' WHERE provider='outstand' AND status IN ('uploading','finishing')",
  ).run();
  const timer = setInterval(
    () => void drain().catch(() => {}),
    process.env.NODE_ENV === "test" ? 300 : 15000,
  );
  timer.unref();
  setImmediate(() => void drain());
  return {
    configured,
    provider: "outstand",
    hasConnection: (uid) => !!connection(uid),
    publish,
    retry,
  };
}
