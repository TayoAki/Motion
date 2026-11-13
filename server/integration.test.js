import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { probe } from "./render.js";

test(
  "accounts, ownership, actual MP4 generation, re-export, cancellation, API keys, and restart recovery",
  { timeout: 240000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "motion-studio-test-"));
    const portFinder = createServer();
    portFinder.listen(0, "127.0.0.1");
    await once(portFinder, "listening");
    const port = portFinder.address().port;
    await new Promise((r) => portFinder.close(r));
    let server,
      logs = "";
    async function start() {
      server = spawn(process.execPath, ["server/index.js"], {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          DATA_DIR: dataDir,
          PORT: String(port),
          OPENROUTER_API_KEY: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.stdout.on("data", (d) => {
        logs += d;
      });
      server.stderr.on("data", (d) => {
        logs += d;
      });
      for (let i = 0; i < 150; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error("Server did not start: " + logs);
    }
    async function stop() {
      if (!server || server.exitCode !== null) return;
      const ended = once(server, "exit");
      server.kill("SIGTERM");
      await ended;
    }
    t.after(async () => {
      await stop();
      await rm(dataDir, { recursive: true, force: true });
    });
    await start();
    async function req(url, method = "GET", body, cookie, bearer) {
      const response = await fetch(`http://127.0.0.1:${port}/api${url}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const type = response.headers.get("content-type") || "";
      return {
        status: response.status,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
        body: type.includes("json")
          ? await response.json()
          : new Uint8Array(await response.arrayBuffer()),
      };
    }
    assert.equal((await req("/projects")).status, 401);
    assert.equal(
      (
        await req("/auth/signup", "POST", {
          email: "bad",
          password: "12345678",
        })
      ).status,
      400,
    );
    const account = await req("/auth/signup", "POST", {
      name: "Creator",
      email: "creator@example.test",
      password: "password for this test",
    });
    assert.equal(account.status, 201);
    assert.equal(account.body.user.credits, 300);
    const cookie = account.cookie;
    const outsider = await req("/auth/signup", "POST", {
      email: "other@example.test",
      password: "different password",
    });
    assert.equal(
      (
        await req("/auth/login", "POST", {
          email: "creator@example.test",
          password: "wrong password",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await req("/auth/login", "POST", {
          email: "creator@example.test",
          password: "password for this test",
        })
      ).status,
      200,
    );
    // Voice previews are real WAVs from the same synthesizer used for rendering.
    for (const voice of ["slt", "rms", "awb", "kal"]) {
      const preview = await req(`/voices/${voice}`, "GET", null, cookie);
      assert.equal(preview.status, 200);
      assert.equal(Buffer.from(preview.body.slice(0, 4)).toString(), "RIFF");
    }
    const narration = await req("/voices/slt", "GET", null, cookie);
    const uploadBody = new FormData();
    uploadBody.append(
      "file",
      new Blob([narration.body], { type: "audio/wav" }),
      "narration.wav",
    );
    const uploadResult = await fetch(
      `http://127.0.0.1:${port}/api/uploads/narration`,
      { method: "POST", headers: { Cookie: cookie }, body: uploadBody },
    );
    assert.equal(uploadResult.status, 201);
    const audio = await uploadResult.json();
    assert.ok(audio.duration > 0);
    assert.equal(
      (await req("/projects", "POST", { audioId: audio.id }, outsider.cookie))
        .status,
      400,
    );
    const invalidAudio = new FormData();
    invalidAudio.append("file", new Blob(["not audio"]), "bad.mp3");
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${port}/api/uploads/narration`, {
          method: "POST",
          headers: { Cookie: cookie },
          body: invalidAudio,
        })
      ).status,
      400,
    );
    const created = await req(
      "/projects",
      "POST",
      {
        title: "A real test story",
        script: "The mountains tell a story. Take a breath and enjoy the view.",
        background: "mountains",
        captions: true,
        graphics: true,
        music: true,
      },
      cookie,
    );
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal(
      (await req(`/projects/${id}`, "GET", null, outsider.cookie)).status,
      404,
    );
    assert.equal(
      (
        await req(
          `/projects/${id}`,
          "PATCH",
          { title: "stolen" },
          outsider.cookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (await req(`/projects/${id}/render`, "POST", {}, outsider.cookie)).status,
      404,
    );
    assert.equal(
      (await req(`/projects/${id}/render`, "POST", {}, cookie)).status,
      202,
    );
    assert.equal(
      (await req(`/projects/${id}/render`, "POST", {}, cookie)).status,
      409,
    );
    async function completed(projectId = id) {
      for (let i = 0; i < 500; i++) {
        const p = (await req(`/projects/${projectId}`, "GET", null, cookie))
          .body;
        if (!["running", "queued"].includes(p.status)) {
          assert.equal(p.status, "succeeded", JSON.stringify(p) + "\n" + logs);
          return p;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error("Render exceeded deadline: " + logs);
    }
    let project = await completed();
    const info = await probe(path.join(dataDir, project.file));
    assert.equal(
      info.streams.find((s) => s.codec_type === "video").width,
      1920,
    );
    assert.equal(
      info.streams.find((s) => s.codec_type === "video").height,
      1080,
    );
    assert.ok(info.streams.some((s) => s.codec_type === "audio"));
    assert.ok(Number(info.format.duration) > 1);
    assert.equal(
      (await req(`/projects/${id}/video`, "GET", null, outsider.cookie)).status,
      404,
    );
    const download = await req(`/projects/${id}/download`, "GET", null, cookie);
    assert.equal(download.status, 200);
    assert.ok(download.body.length > 10000);
    assert.ok(
      (await req(`/projects/${id}/manifest`, "GET", null, cookie)).body.scenes
        .length > 0,
    );
    const firstBalance = (await req("/me", "GET", null, cookie)).body.user
      .credits;
    assert.equal(firstBalance, 299);
    const changed = await req(
      `/projects/${id}`,
      "PATCH",
      {
        aspect: "9:16",
        scenes: project.scenes.map((s) => ({ ...s, background: "forest" })),
      },
      cookie,
    );
    assert.equal(changed.body.dirty, true);
    await req(`/projects/${id}/render`, "POST", {}, cookie);
    project = await completed();
    const vertical = await probe(path.join(dataDir, project.file));
    assert.equal(
      vertical.streams.find((s) => s.codec_type === "video").width,
      1080,
    );
    assert.equal(
      vertical.streams.find((s) => s.codec_type === "video").height,
      1920,
    );
    assert.equal(
      (await req("/me", "GET", null, cookie)).body.user.credits,
      firstBalance - 4,
    );
    await req(`/projects/${id}/render`, "POST", {}, cookie);
    assert.equal(
      (await req(`/projects/${id}/cancel`, "POST", {}, cookie)).status,
      200,
    );
    assert.equal(
      (await req(`/projects/${id}/cancel`, "POST", {}, cookie)).status,
      409,
    );
    assert.equal(
      (await req("/me", "GET", null, cookie)).body.user.credits,
      firstBalance - 4,
    );
    const key = (await req("/keys", "POST", { label: "integration" }, cookie))
      .body;
    assert.ok(key.key.startsWith("motion_"));
    assert.equal(
      (await req("/projects", "GET", null, null, key.key)).status,
      200,
    );
    const rpc = (method, params = {}, bearer = key.key) =>
      req(
        "/mcp",
        "POST",
        { jsonrpc: "2.0", id: 1, method, params },
        null,
        bearer,
      );
    assert.equal(
      (await rpc("initialize", { protocolVersion: "2025-06-18" })).body.result
        .protocolVersion,
      "2025-06-18",
    );
    assert.ok(
      (await rpc("tools/list")).body.result.tools.some(
        (t) => t.name === "project_render",
      ),
    );
    assert.equal(
      (await rpc("tools/call", { name: "project_get", arguments: { id } })).body
        .result.isError,
      undefined,
    );
    assert.equal(
      JSON.parse(
        (await rpc("tools/call", { name: "project_export", arguments: { id } }))
          .body.result.content[0].text,
      ).requiresAuthorization,
      true,
    );
    const mcpDraft = JSON.parse(
      (
        await rpc("tools/call", {
          name: "project_create",
          arguments: {
            title: "Agent draft",
            script: "A story made through the authenticated agent API.",
          },
        })
      ).body.result.content[0].text,
    );
    assert.equal(
      (await req(`/projects/${mcpDraft.id}`, "GET", null, outsider.cookie))
        .status,
      404,
    );
    await req(`/projects/${mcpDraft.id}`, "DELETE", null, cookie);
    assert.equal((await rpc("unknown-method")).body.error.code, -32601);
    assert.equal(
      (
        await rpc("tools/call", {
          name: "project_get",
          arguments: { id: "missing" },
        })
      ).body.result.isError,
      true,
    );
    assert.equal(
      (
        await rpc("tools/call", {
          name: "project_create",
          arguments: { script: "bad", userId: outsider.body.user.id },
        })
      ).body.error.code,
      -32602,
    );
    await req(`/keys/${key.id}`, "DELETE", null, cookie);
    assert.equal((await rpc("tools/list")).status, 401);
    assert.equal(
      (await req("/projects", "GET", null, null, key.key)).status,
      401,
    );
    const script = (
      await req("/scripts", "POST", { topic: "the ocean" }, cookie)
    ).body;
    assert.equal(script.source, "starter");
    assert.ok(script.content.includes("the ocean"));
    assert.equal(
      (await req("/history", "GET", null, cookie)).body.filter((e) =>
        e.label.includes("cancelled"),
      ).length,
      1,
    );
    // Simulate a persisted render reservation left behind by an unexpected shutdown.
    await stop();
    const db = new DatabaseSync(path.join(dataDir, "studio.sqlite"));
    const row = JSON.parse(
      db.prepare("SELECT data FROM projects WHERE id=?").get(id).data,
    );
    db.exec("BEGIN");
    db.prepare("UPDATE users SET credits=credits-4 WHERE id=?").run(
      account.body.user.id,
    );
    db.prepare("UPDATE projects SET data=? WHERE id=?").run(
      JSON.stringify({ ...row, status: "running", reserved: 4 }),
      id,
    );
    db.exec("COMMIT");
    db.close();
    await start();
    const recovered = (await req(`/projects/${id}`, "GET", null, cookie)).body;
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.reserved, 0);
    assert.equal(
      (await req("/me", "GET", null, cookie)).body.user.credits,
      firstBalance - 4,
    );
    assert.equal((await req("/projects", "GET", null, cookie)).body.length, 1);
    const audioProject = await req(
      "/projects",
      "POST",
      {
        title: "Uploaded narration",
        audioId: audio.id,
        captions: false,
        musicId: null,
        background: "ocean",
      },
      cookie,
    );
    assert.equal(audioProject.status, 201);
    assert.equal(
      (
        await req(
          `/projects/${audioProject.body.id}/render`,
          "POST",
          {},
          cookie,
        )
      ).status,
      202,
    );
    const audioRender = await completed(audioProject.body.id);
    assert.ok(Math.abs(audioRender.duration - audio.duration) < 0.1);
    await req("/auth/logout", "POST", {}, cookie);
    assert.equal((await req("/projects", "GET", null, cookie)).status, 401);
  },
);
