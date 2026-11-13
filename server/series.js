import { randomUUID } from "node:crypto";
import { HttpError } from "./providers.js";
import { generateNarration } from "./script-service.js";
import { validateProject } from "./domain.js";

export function installSeries({
  app,
  db,
  auth,
  requireVerified,
  transaction,
  createProject,
  enqueueRender,
  find,
  youtube,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS series(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),name TEXT,topics TEXT,settings TEXT,interval_days INTEGER,next_at TEXT,active INTEGER,created TEXT,error TEXT);
    CREATE TABLE IF NOT EXISTS series_runs(id TEXT PRIMARY KEY,series_id TEXT REFERENCES series(id),user_id TEXT REFERENCES users(id),scheduled_at TEXT,topic TEXT,project_id TEXT,publication_id TEXT,status TEXT,error TEXT,created TEXT,UNIQUE(series_id,scheduled_at));`);
  db.prepare(
    "UPDATE series SET active=0,error='Reconnect through Outstand and confirm the series visibility before resuming.' WHERE active=1 AND user_id NOT IN (SELECT user_id FROM outstand_connections)",
  ).run();
  const get = (id, uid) =>
    db.prepare("SELECT * FROM series WHERE id=? AND user_id=?").get(id, uid);
  function safe(s) {
    return {
      id: s.id,
      name: s.name,
      topics: JSON.parse(s.topics),
      intervalDays: s.interval_days,
      nextAt: s.next_at,
      active: !!s.active,
      error: s.error,
      settings: JSON.parse(s.settings),
      runs: db
        .prepare(
          "SELECT id,scheduled_at,topic,project_id,publication_id,status,error FROM series_runs WHERE series_id=? ORDER BY created DESC LIMIT 30",
        )
        .all(s.id),
    };
  }
  function ready(uid) {
    if (!process.env.OPENROUTER_API_KEY || !youtube.configured)
      throw new HttpError(
        503,
        "Autopilot requires OpenRouter and Outstand credentials on the server.",
      );
    if (!youtube.hasConnection(uid))
      throw new HttpError(400, "Connect your YouTube channel first.");
    if (
      process.env.REQUIRE_EMAIL_VERIFICATION === "1" &&
      !db.prepare("SELECT email_verified FROM users WHERE id=?").get(uid)
        ?.email_verified
    )
      throw new HttpError(403, "Verify your email before using Autopilot.");
  }
  app.get("/api/series", auth, (req, res) =>
    res.json({
      configured: !!(process.env.OPENROUTER_API_KEY && youtube.configured),
      series: db
        .prepare("SELECT * FROM series WHERE user_id=? ORDER BY created DESC")
        .all(req.user.id)
        .map(safe),
    }),
  );
  app.post("/api/series", auth, requireVerified, (req, res) => {
    ready(req.user.id);
    if (req.body.confirmed !== true)
      throw new HttpError(
        400,
        "Confirm automatic generation, credit use, and scheduled publishing.",
      );
    const topics = Array.isArray(req.body.topics)
      ? req.body.topics.map((t) => String(t).trim()).filter(Boolean)
      : [];
    if (
      !topics.length ||
      topics.length > 100 ||
      topics.some((t) => t.length < 3 || t.length > 300)
    )
      throw new HttpError(400, "Add 1–100 topics of 3–300 characters each.");
    if (![1, 7].includes(req.body.intervalDays))
      throw new HttpError(400, "Choose a daily or weekly schedule.");
    const next = Date.parse(req.body.nextAt);
    if (!Number.isFinite(next) || next < Date.now() + 15 * 60000)
      throw new HttpError(
        400,
        "Choose a first publishing time at least 15 minutes from now.",
      );
    if (
      db
        .prepare("SELECT count(*) AS n FROM series WHERE user_id=?")
        .get(req.user.id).n >= 10
    )
      throw new HttpError(400, "A workspace can have up to ten series.");
    const settings = validateProject({
      ...req.body.settings,
      script: "Placeholder narration for validating series settings.",
      audioId: null,
      musicId: null,
      scenes: [],
    });
    if (
      req.body.settings?.privacy &&
      !["private", "unlisted", "public"].includes(req.body.settings.privacy)
    )
      throw new HttpError(400, "Choose a valid publication visibility.");
    const {
      voice,
      background,
      aspect,
      captions,
      graphics,
      music,
      musicVolume,
    } = settings;
    const id = randomUUID();
    db.prepare("INSERT INTO series VALUES(?,?,?,?,?,?,?,1,?,NULL)").run(
      id,
      req.user.id,
      String(req.body.name || "My series")
        .trim()
        .slice(0, 100),
      JSON.stringify(topics),
      JSON.stringify({
        voice,
        background,
        aspect,
        captions,
        graphics,
        music,
        musicVolume,
        madeForKids: !!req.body.madeForKids,
        synthetic: !!req.body.synthetic,
        privacy: req.body.settings?.privacy || "private",
      }),
      req.body.intervalDays,
      new Date(next).toISOString(),
      new Date().toISOString(),
    );
    res.status(201).json(safe(get(id, req.user.id)));
    setImmediate(() => void tick());
  });
  app.patch("/api/series/:id", auth, requireVerified, (req, res) => {
    const s = get(req.params.id, req.user.id);
    if (!s) throw new HttpError(404, "Series not found.");
    if (typeof req.body.active !== "boolean")
      throw new HttpError(
        400,
        "Choose whether to pause or resume this series.",
      );
    if (req.body.active) {
      ready(req.user.id);
      if (!JSON.parse(s.topics).length)
        throw new HttpError(
          400,
          "This series has used all of its topics. Create a new series.",
        );
      if (Date.parse(s.next_at) < Date.now() + 15 * 60000)
        throw new HttpError(
          409,
          "The next publishing time has passed. Create a new schedule; past times are never published immediately.",
        );
    }
    db.prepare("UPDATE series SET active=?,error=NULL WHERE id=?").run(
      req.body.active ? 1 : 0,
      s.id,
    );
    res.json(safe(get(s.id, req.user.id)));
    setImmediate(() => void tick());
  });
  app.post("/api/series/runs/:id/retry", auth, requireVerified, (req, res) => {
    ready(req.user.id);
    const run = db
      .prepare("SELECT * FROM series_runs WHERE id=? AND user_id=?")
      .get(req.params.id, req.user.id);
    if (!run) throw new HttpError(404, "Series run not found.");
    if (run.status !== "failed")
      throw new HttpError(409, "Only failed runs can be retried.");
    const next = req.body.publishAt
      ? Date.parse(req.body.publishAt)
      : Date.parse(run.scheduled_at);
    if (!Number.isFinite(next) || next < Date.now() + 15 * 60000)
      throw new HttpError(
        400,
        "Provide a new publishing time at least 15 minutes from now.",
      );
    if (
      db
        .prepare(
          "SELECT id FROM series_runs WHERE series_id=? AND scheduled_at=? AND id<>?",
        )
        .get(run.series_id, new Date(next).toISOString(), run.id)
    )
      throw new HttpError(409, "Another run already uses that time.");
    if (run.publication_id) {
      const job = db
        .prepare("SELECT status FROM publications WHERE id=? AND user_id=?")
        .get(run.publication_id, req.user.id);
      if (job?.status === "failed")
        youtube.retry(
          req.user.id,
          run.publication_id,
          new Date(next).toISOString(),
        );
      else if (next !== Date.parse(run.scheduled_at))
        throw new HttpError(
          409,
          "An upload is already active or scheduled. Manage its time in YouTube Studio.",
        );
    }
    if (run.project_id && !run.publication_id) {
      const project = find(run.project_id, req.user.id);
      if (project && ["draft", "failed", "cancelled"].includes(project.status))
        enqueueRender(req.user.id, project.id);
    }
    db.prepare(
      "UPDATE series_runs SET scheduled_at=?,status=?,error=NULL WHERE id=?",
    ).run(
      new Date(next).toISOString(),
      run.publication_id
        ? "uploading"
        : run.project_id
          ? "rendering"
          : "queued",
      run.id,
    );
    res.json({ ok: true });
    setImmediate(() => void tick());
  });
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const s of db
        .prepare("SELECT * FROM series WHERE active=1 AND next_at<=?")
        .all(new Date(Date.now() + 30 * 60000).toISOString())) {
        if (
          db
            .prepare(
              "SELECT r.id FROM series_runs r LEFT JOIN publications p ON p.id=r.publication_id WHERE r.series_id=? AND r.status IN ('queued','rendering','uploading','scheduled') AND r.scheduled_at<? AND (p.status IS NULL OR p.status<>'published') LIMIT 1",
            )
            .get(s.id, new Date().toISOString())
        ) {
          db.prepare(
            "UPDATE series SET active=0,error='A previous publication has no successful outcome yet. Inspect Outstand before resuming future runs.' WHERE id=?",
          ).run(s.id);
          continue;
        }
        if (Date.parse(s.next_at) < Date.now() + 10 * 60000) {
          db.prepare("UPDATE series SET active=0,error=? WHERE id=?").run(
            "Publishing time was missed while the server was unavailable. Create a new future schedule.",
            s.id,
          );
          continue;
        }
        const topics = JSON.parse(s.topics);
        if (!topics.length) {
          db.prepare("UPDATE series SET active=0 WHERE id=?").run(s.id);
          continue;
        }
        transaction(() => {
          const inserted = db
            .prepare(
              "INSERT OR IGNORE INTO series_runs VALUES(?,?,?,?,?,NULL,NULL,'queued',NULL,?)",
            )
            .run(
              randomUUID(),
              s.id,
              s.user_id,
              s.next_at,
              topics[0],
              new Date().toISOString(),
            );
          if (inserted.changes)
            db.prepare(
              "UPDATE series SET topics=?,next_at=?,active=? WHERE id=?",
            ).run(
              JSON.stringify(topics.slice(1)),
              new Date(
                Date.parse(s.next_at) + s.interval_days * 86400000,
              ).toISOString(),
              topics.length > 1 ? 1 : 0,
              s.id,
            );
        });
      }
      const runs = db
        .prepare(
          "SELECT * FROM series_runs WHERE status IN ('queued','rendering','uploading','scheduled') ORDER BY created",
        )
        .all();
      for (const run of runs) {
        try {
          ready(run.user_id);
          const s = get(run.series_id, run.user_id),
            settings = JSON.parse(s.settings);
          if (run.status === "queued") {
            if (Date.parse(run.scheduled_at) < Date.now() + 10 * 60000)
              throw new Error(
                "The publishing time was missed. Choose a new time before retrying.",
              );
            const script = await generateNarration(run.topic, true);
            let project;
            transaction(() => {
              project = createProject(run.user_id, {
                ...settings,
                title: run.topic.slice(0, 100),
                script: script.content,
              });
              db.prepare(
                "UPDATE series_runs SET project_id=?,status='rendering' WHERE id=?",
              ).run(project.id, run.id);
            });
            enqueueRender(run.user_id, project.id);
          } else if (run.status === "rendering") {
            const project = find(run.project_id, run.user_id);
            if (!project) throw new Error("The generated project was deleted.");
            if (["failed", "cancelled", "draft"].includes(project.status))
              throw new Error(
                "The render stopped. Its reserved credits were returned; retry this run when ready.",
              );
            if (project.status === "succeeded") {
              const existing = db
                .prepare(
                  "SELECT id FROM publications WHERE user_id=? AND project_id=? AND version=?",
                )
                .get(run.user_id, project.id, project.exports);
              const job =
                existing ||
                (await youtube.publish(run.user_id, {
                  projectId: project.id,
                  title: project.title,
                  description: `A video about ${run.topic}.`,
                  privacy: settings.privacy || "private",
                  publishAt: run.scheduled_at,
                  confirmed: true,
                  madeForKids: settings.madeForKids,
                  synthetic: settings.synthetic,
                }));
              db.prepare(
                "UPDATE series_runs SET publication_id=?,status='uploading' WHERE id=?",
              ).run(job.id, run.id);
            }
          } else {
            const job = db
              .prepare(
                "SELECT status,error FROM publications WHERE id=? AND user_id=?",
              )
              .get(run.publication_id, run.user_id);
            if (!job || ["failed", "cancelled", "blocked"].includes(job.status))
              throw new Error(job?.error || "Publication not found.");
            if (job.status === "scheduled")
              db.prepare(
                "UPDATE series_runs SET status='scheduled',error=NULL WHERE id=?",
              ).run(run.id);
            if (job.status === "published")
              db.prepare(
                "UPDATE series_runs SET status='complete',error=NULL WHERE id=?",
              ).run(run.id);
          }
        } catch (e) {
          db.prepare(
            "UPDATE series_runs SET status='failed',error=? WHERE id=?",
          ).run(e.message, run.id);
          db.prepare("UPDATE series SET active=0,error=? WHERE id=?").run(
            "A run needs attention. Future runs are paused to avoid repeated credit use.",
            run.series_id,
          );
        }
      }
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(
    () => void tick().catch(() => {}),
    process.env.NODE_ENV === "test" ? 300 : 15000,
  );
  timer.unref();
  setImmediate(() => void tick());
}
