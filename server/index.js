import express from "express";
import multer from "multer";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashPassword,
  verifyPassword,
  validateProject,
  makeScenes,
  quote,
  VOICES,
} from "./domain.js";
import { renderVideo, probe, command } from "./render.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const root = process.env.DATA_DIR || path.join(appRoot, "data");
mkdirSync(path.join(root, "uploads"), { recursive: true });
const db = new DatabaseSync(path.join(root, "studio.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,password TEXT,credits INTEGER DEFAULT 300);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),data TEXT);
CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),file TEXT,kind TEXT,duration REAL);
CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),project_id TEXT,label TEXT,amount INTEGER,created TEXT);
CREATE TABLE IF NOT EXISTS scripts(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),title TEXT,content TEXT,created TEXT);
CREATE TABLE IF NOT EXISTS keys(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),label TEXT,created TEXT);
`);
const app = express();
app.disable("x-powered-by");
if (process.env.COOKIE_SECURE === "1") app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
    req.headers.origin &&
    req.headers.origin !== `${req.protocol}://${req.get("host")}` &&
    !/^http:\/\/(localhost|127\.0\.0\.1):(5173|4173)$/.test(req.headers.origin)
  )
    return res.status(403).json({ error: "Request origin is not allowed." });
  next();
});
app.use(express.json({ limit: "200kb" }));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const read = (row) => (row ? JSON.parse(row.data) : null);
const find = (id, uid) =>
  read(
    db
      .prepare("SELECT data FROM projects WHERE id=? AND user_id=?")
      .get(id, uid),
  );
const save = (p) => {
  p.updated = new Date().toISOString();
  db.prepare(
    "INSERT INTO projects VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
  ).run(p.id, p.userId, JSON.stringify(p));
  return p;
};
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  credits: u.credits,
});
const userById = (id) => db.prepare("SELECT * FROM users WHERE id=?").get(id);
function credit(uid, pid, label, amount) {
  db.prepare("UPDATE users SET credits=credits+? WHERE id=?").run(amount, uid);
  db.prepare(
    "INSERT INTO ledger(id,user_id,project_id,label,amount,created) VALUES(?,?,?,?,?,?)",
  ).run(randomUUID(), uid, pid, label, amount, new Date().toISOString());
}
function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function session(req, res, uid) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    digest(token),
    uid,
    Date.now() + 30 * 86400000,
  );
  res.cookie("motion_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "1",
    maxAge: 30 * 86400000,
    path: "/",
  });
}
function token(req) {
  return req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("motion_session="))
    ?.slice(15);
}
app.use("/api", (req, res, next) => {
  const t = token(req);
  const s = t
    ? db
        .prepare("SELECT user_id FROM sessions WHERE token=? AND expires>?")
        .get(digest(t), Date.now())
    : null;
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const key = bearer
    ? db.prepare("SELECT user_id FROM keys WHERE hash=?").get(digest(bearer))
    : null;
  req.user = s || key ? userById((s || key).user_id) : null;
  next();
});
const auth = (req, res, next) =>
  req.user
    ? next()
    : res.status(401).json({ error: "Please sign in to continue." });
const rates = new Map();
function authRate(req, res, next) {
  const key = req.ip;
  const entry = rates.get(key) || { time: Date.now(), count: 0 };
  if (Date.now() - entry.time > 15 * 60000) {
    entry.time = Date.now();
    entry.count = 0;
  }
  entry.count++;
  rates.set(key, entry);
  if (entry.count > 30)
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again in 15 minutes." });
  next();
}
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    renderer: "ffmpeg",
    scriptAI: !!process.env.OPENROUTER_API_KEY,
    billing: false,
    youtube: false,
    mode: "local-studio",
  }),
);
app.get("/api/me", (req, res) =>
  res.json({ user: req.user ? publicUser(req.user) : null }),
);
const voicePreviews = new Map();
app.get("/api/voices/:id", auth, async (req, res) => {
  const voice = req.params.id;
  if (!VOICES.includes(voice))
    return res.status(404).json({ error: "Voice not found." });
  const file = path.join(root, `voice-${voice}.wav`);
  if (!existsSync(file)) {
    if (!voicePreviews.has(voice)) {
      voicePreviews.set(
        voice,
        command("ffmpeg", [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          `flite=text=Every great story starts with a little imagination:voice=${voice}`,
          file,
        ]).finally(() => voicePreviews.delete(voice)),
      );
    }
    await voicePreviews.get(voice);
  }
  res.sendFile(file);
});
app.post("/api/auth/signup", authRate, async (req, res) => {
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8 || password.length > 128)
    return res
      .status(400)
      .json({ error: "Use a password between 8 and 128 characters." });
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
    return res
      .status(409)
      .json({ error: "An account already exists. Please log in." });
  const id = randomUUID(),
    hash = await hashPassword(password);
  try {
    transaction(() => {
      db.prepare(
        "INSERT INTO users(id,email,name,password,credits) VALUES(?,?,?,?,0)",
      ).run(
        id,
        email,
        String(req.body.name || email.split("@")[0]).slice(0, 80),
        hash,
      );
      credit(id, null, "Welcome — local studio credits", 300);
    });
  } catch {
    return res
      .status(409)
      .json({ error: "An account already exists. Please log in." });
  }
  session(req, res, id);
  res.status(201).json({ user: publicUser(userById(id)) });
});
app.post("/api/auth/login", authRate, async (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(
    String(req.body.email || "")
      .trim()
      .toLowerCase(),
  );
  const password = String(req.body.password || "").slice(0, 129);
  if (!u || !(await verifyPassword(password, u.password)))
    return res.status(401).json({ error: "Email or password is incorrect." });
  session(req, res, u.id);
  res.json({ user: publicUser(u) });
});
app.post("/api/auth/logout", (req, res) => {
  const t = token(req);
  if (t) db.prepare("DELETE FROM sessions WHERE token=?").run(digest(t));
  res.clearCookie("motion_session");
  res.json({ ok: true });
});
app.get("/api/projects", auth, (req, res) =>
  res.json(
    db
      .prepare("SELECT data FROM projects WHERE user_id=? ORDER BY rowid DESC")
      .all(req.user.id)
      .map(read),
  ),
);
app.get("/api/projects/:id", auth, (req, res) => {
  const p = find(req.params.id, req.user.id);
  p ? res.json(p) : res.status(404).json({ error: "Project not found." });
});
function ownedUpload(id, uid, kind) {
  if (!id) return null;
  const item = db
    .prepare("SELECT * FROM uploads WHERE id=? AND user_id=? AND kind=?")
    .get(id, uid, kind);
  if (!item)
    throw new Error(
      "Uploaded file is missing or belongs to a different account.",
    );
  return item;
}
app.post("/api/quote", auth, (req, res) => {
  const input = validateProject(req.body);
  const audio = ownedUpload(input.audioId, req.user.id, "narration");
  res.json(quote(input.script, audio?.duration));
});
app.post("/api/projects", auth, (req, res) => {
  const input = validateProject(req.body);
  ownedUpload(input.audioId, req.user.id, "narration");
  ownedUpload(input.musicId, req.user.id, "music");
  const p = save({
    ...input,
    id: randomUUID(),
    userId: req.user.id,
    created: new Date().toISOString(),
    status: "draft",
    progress: 0,
    scenes: input.scenes.length
      ? input.scenes
      : makeScenes(input.script, input.background),
    exports: 0,
  });
  res.status(201).json(p);
});
app.patch("/api/projects/:id", auth, (req, res) => {
  const p = find(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  if (["queued", "running"].includes(p.status))
    return res
      .status(409)
      .json({ error: "Wait for generation to finish before editing." });
  const input = validateProject({ ...p, ...req.body });
  ownedUpload(input.audioId, req.user.id, "narration");
  ownedUpload(input.musicId, req.user.id, "music");
  // Editing scene words also updates narration; uploaded audio remains the source when present.
  if (req.body.scenes && !p.audioId)
    input.script = input.scenes.map((s) => s.text).join(" ");
  const checked = validateProject(input);
  res.json(save({ ...p, ...checked, dirty: !!p.file }));
});
app.delete("/api/projects/:id", auth, (req, res) => {
  const p = find(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  if (["queued", "running"].includes(p.status))
    return res
      .status(409)
      .json({ error: "Cancel this job before deleting it." });
  db.prepare("DELETE FROM projects WHERE id=? AND user_id=?").run(
    p.id,
    req.user.id,
  );
  res.json({ ok: true });
});

const queue = [],
  active = new Map();
let processing = false;
async function drain() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      const { id, uid } = queue.shift();
      let p = find(id, uid);
      if (!p || p.status !== "queued") continue;
      const controller = new AbortController();
      active.set(id, controller);
      p = save({
        ...p,
        status: "running",
        progress: 3,
        stage: "Preparing your story",
      });
      try {
        const audio = ownedUpload(p.audioId, uid, "narration");
        const music = ownedUpload(p.musicId, uid, "music");
        const result = await renderVideo({
          project: p,
          root,
          media: path.join(appRoot, "public/media"),
          audioFile: audio?.file,
          musicFile: music?.file,
          signal: controller.signal,
          runId: randomUUID(),
          progress: (value, stage) => {
            const current = find(id, uid);
            if (current && current.status !== "cancelled")
              save({ ...current, progress: value, stage });
          },
        });
        controller.signal.throwIfAborted();
        save({
          ...find(id, uid),
          ...result,
          status: "succeeded",
          progress: 100,
          stage: "Your video is ready",
          dirty: false,
          reserved: 0,
          exports: (p.exports || 0) + 1,
        });
      } catch (e) {
        const current = find(id, uid);
        if (current && current.status !== "cancelled")
          transaction(() => {
            if (current.reserved)
              credit(
                uid,
                id,
                "Render failed — credits returned",
                current.reserved,
              );
            save({
              ...current,
              status: "failed",
              reserved: 0,
              error:
                e.message === "Cancelled"
                  ? "Generation cancelled."
                  : "Rendering could not finish. Your credits were returned. Please try again.",
              stage: "Generation stopped",
            });
          });
        if (e.name !== "AbortError")
          console.error("Render failure", id, e.message);
      } finally {
        active.delete(id);
      }
    }
  } finally {
    processing = false;
  }
}
app.post("/api/projects/:id/render", auth, (req, res) => {
  let p = find(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  if (["queued", "running"].includes(p.status))
    return res
      .status(409)
      .json({ error: "This project is already rendering." });
  if (queue.length >= 20)
    return res
      .status(429)
      .json({ error: "The render queue is full. Please try again shortly." });
  const audio = ownedUpload(p.audioId, req.user.id, "narration");
  const cost = p.file ? 4 : quote(p.script, audio?.duration).credits;
  if (req.user.credits < cost)
    return res
      .status(402)
      .json({ error: "Not enough local credits for this render." });
  transaction(() => {
    credit(
      req.user.id,
      p.id,
      p.file ? "Updated video export" : "Video generation",
      -cost,
    );
    p = save({
      ...p,
      status: "queued",
      progress: 0,
      reserved: cost,
      error: null,
      stage: "Waiting in the render queue",
    });
  });
  queue.push({ id: p.id, uid: req.user.id });
  res.status(202).json(p);
  void drain();
});
app.post("/api/projects/:id/cancel", auth, (req, res) => {
  const p = find(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  if (!["queued", "running"].includes(p.status))
    return res.status(409).json({ error: "This job is no longer running." });
  active.get(p.id)?.abort();
  const value = transaction(() => {
    if (p.reserved)
      credit(
        req.user.id,
        p.id,
        "Generation cancelled — credits returned",
        p.reserved,
      );
    return save({ ...p, status: "cancelled", reserved: 0, stage: "Cancelled" });
  });
  res.json(value);
});
app.get("/api/projects/:id/:asset", auth, (req, res, next) => {
  if (!["video", "poster", "download", "manifest"].includes(req.params.asset))
    return next();
  const p = find(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: "Project not found." });
  if (req.params.asset === "manifest") {
    res.attachment(`${p.title.replace(/[^a-z0-9]/gi, "-")}.json`);
    return res.json({
      title: p.title,
      script: p.script,
      aspect: p.aspect,
      voice: p.voice,
      scenes: p.scenes,
      captions: p.captions,
      graphics: p.graphics,
      music: p.music,
      musicVolume: p.musicVolume,
    });
  }
  const file = req.params.asset === "poster" ? p.poster : p.file;
  if (!file || !existsSync(path.join(root, file)))
    return res.status(404).json({ error: "Render your project first." });
  res.set("Cache-Control", "private, no-cache");
  if (req.params.asset === "download")
    return res.download(
      path.join(root, file),
      `${p.title.replace(/[^a-z0-9]/gi, "-")}.mp4`,
    );
  res.sendFile(path.join(root, file));
});
const upload = multer({
  dest: path.join(root, "uploads"),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});
app.post(
  "/api/uploads/:kind",
  auth,
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file)
      return res.status(400).json({ error: "Choose an audio file first." });
    try {
      if (!["narration", "music"].includes(req.params.kind))
        throw new Error("Unsupported upload type.");
      const metadata = await probe(file.path);
      const duration = Number(metadata.format.duration);
      if (
        !metadata.streams.some((s) => s.codec_type === "audio") ||
        !Number.isFinite(duration) ||
        duration < 0.3 ||
        duration > 600
      )
        throw new Error(
          "Choose valid audio between 0.3 seconds and 10 minutes.",
        );
      const id = randomUUID();
      db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?)").run(
        id,
        req.user.id,
        file.path,
        req.params.kind,
        duration,
      );
      res.status(201).json({ id, duration, name: file.originalname });
    } catch (e) {
      await unlink(file.path).catch(() => {});
      res.status(400).json({ error: e.message });
    }
  },
);
app.get("/api/history", auth, (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT id,project_id,label,amount,created FROM ledger WHERE user_id=? ORDER BY rowid DESC",
      )
      .all(req.user.id),
  ),
);
app.get("/api/scripts", auth, (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT id,title,content,created FROM scripts WHERE user_id=? ORDER BY rowid DESC",
      )
      .all(req.user.id),
  ),
);
app.post("/api/scripts", auth, async (req, res) => {
  const topic = String(req.body.topic || "")
    .trim()
    .slice(0, 300);
  if (topic.length < 3)
    return res.status(400).json({ error: "Tell us what your video is about." });
  let content,
    source = "starter";
  if (process.env.OPENROUTER_API_KEY) {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        signal: AbortSignal.timeout(60000),
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
          max_tokens: 1200,
          messages: [
            {
              role: "system",
              content:
                "Write an accurate, engaging 150-250 word YouTube narration script. Plain text only, no headings or stage directions. Do not invent facts, sources, or statistics.",
            },
            { role: "user", content: topic },
          ],
        }),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.choices?.[0]?.message?.content)
      return res
        .status(502)
        .json({
          error:
            "The script provider could not complete this request. Try again.",
        });
    content = result.choices[0].message.content.slice(0, 8000);
    source = "ai";
  } else
    content = `What makes ${topic} worth exploring? Sometimes, the most interesting stories begin with a simple question.\n\nIn this video, we are taking a closer look at ${topic}. Start with what you already know, then look for the detail you might have missed. A new perspective can turn an ordinary subject into a remarkable story.\n\nConsider the people, places, and ideas connected to this topic. What changed over time? What surprised you? Add one verified example here to make the story your own.\n\nThe next time you think about ${topic}, take a moment to look a little closer. There is always more to discover. If this sparked your curiosity, save this video and join us for the next story.`;
  const row = {
    id: randomUUID(),
    title: topic,
    content,
    created: new Date().toISOString(),
    source,
  };
  db.prepare("INSERT INTO scripts VALUES(?,?,?,?,?)").run(
    row.id,
    req.user.id,
    topic,
    content,
    row.created,
  );
  res.status(201).json(row);
});
app.delete("/api/scripts/:id", auth, (req, res) => {
  db.prepare("DELETE FROM scripts WHERE id=? AND user_id=?").run(
    req.params.id,
    req.user.id,
  );
  res.json({ ok: true });
});
app.get("/api/keys", auth, (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT substr(hash,1,12) AS id,label,created FROM keys WHERE user_id=?",
      )
      .all(req.user.id),
  ),
);
app.post("/api/keys", auth, (req, res) => {
  if (
    db
      .prepare("SELECT count(*) AS n FROM keys WHERE user_id=?")
      .get(req.user.id).n >= 10
  )
    return res
      .status(400)
      .json({ error: "Delete an existing key first (maximum 10)." });
  const key = `motion_${randomBytes(24).toString("hex")}`,
    hash = digest(key);
  db.prepare("INSERT INTO keys VALUES(?,?,?,?)").run(
    hash,
    req.user.id,
    String(req.body.label || "Studio API key").slice(0, 80),
    new Date().toISOString(),
  );
  res.status(201).json({ key, id: hash.slice(0, 12) });
});
app.delete("/api/keys/:id", auth, (req, res) => {
  db.prepare("DELETE FROM keys WHERE user_id=? AND substr(hash,1,12)=?").run(
    req.user.id,
    req.params.id,
  );
  res.json({ ok: true });
});
app.patch("/api/me", auth, (req, res) => {
  const name = String(req.body.name || "")
    .trim()
    .slice(0, 80);
  if (!name) return res.status(400).json({ error: "Enter your name." });
  db.prepare("UPDATE users SET name=? WHERE id=?").run(name, req.user.id);
  res.json({ user: publicUser(userById(req.user.id)) });
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API route not found." }),
);
app.use(express.static(path.join(appRoot, "dist")));
app.get("/{*path}", (_req, res) =>
  existsSync(path.join(appRoot, "dist/index.html"))
    ? res.sendFile(path.join(appRoot, "dist/index.html"))
    : res
        .status(503)
        .send("Run npm run build, or use the Vite development server."),
);
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res
    .status(err instanceof multer.MulterError ? 400 : 400)
    .json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "File too large. The limit is 100 MB."
          : err.message || "Something went wrong.",
    });
});
// Recover reservations atomically after a process restart.
for (const row of db.prepare("SELECT data FROM projects").all()) {
  const p = read(row);
  if (["queued", "running"].includes(p.status))
    transaction(() => {
      if (p.reserved)
        credit(
          p.userId,
          p.id,
          "Interrupted render — credits returned",
          p.reserved,
        );
      save({
        ...p,
        status: "failed",
        reserved: 0,
        error: "The server restarted. Credits were returned; you can retry.",
      });
    });
}
const port = Number(process.env.PORT || 4310);
app.listen(port, "0.0.0.0", () =>
  console.log(`Motion Studio API ready on port ${port}`),
);
