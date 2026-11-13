import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

test(
  "Outstand tenant connection, real media transfer, safe retries, visibility, cancellation, delivery outcomes, and Autopilot",
  { timeout: 120000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "motion-outstand-"));
    const accounts = new Map(),
      authRequests = new Map(),
      posts = new Map(),
      replays = new Map();
    const calls = {
      uploads: 0,
      puts: 0,
      creates: 0,
      createAttempts: 0,
      activations: 0,
      deletes: 0,
      google: 0,
    };
    let loseCreate = true,
      loseActivation = true,
      subscriptionMissing = false,
      invalidUpload = false;
    const json = (res, body, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const mock = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks),
          raw = bytes.toString(),
          url = new URL(req.url, "http://localhost");
        if (url.pathname.startsWith("/api.outstand.so/")) {
          assert.equal(req.headers.authorization, "Bearer mock-outstand-only");
          if (subscriptionMissing)
            return json(
              res,
              { success: false, error: "secret provider internals" },
              402,
            );
        }
        if (/googleapis/.test(url.pathname)) {
          calls.google++;
          return json(res, {}, 500);
        }
        if (
          url.pathname ===
          "/api.outstand.so/v1/social-networks/youtube/auth-url"
        ) {
          const body = JSON.parse(raw);
          assert.equal(body.force_account_selection, true);
          authRequests.set(body.tenant_id, body);
          const id = `Opaque_${body.tenant_id}`;
          accounts.set(id, {
            id,
            network: "youtube",
            tenant_id: body.tenant_id,
            isActive: 1,
            nickname: "Verified test channel",
            network_unique_id: `UC_${body.tenant_id}`,
          });
          return json(res, {
            success: true,
            data: {
              auth_url: `https://www.outstand.so/app/api/socials/youtube/mock-org?redirect_uri=${encodeURIComponent(body.redirect_uri)}`,
            },
          });
        }
        if (url.pathname === "/api.outstand.so/v1/social-accounts") {
          // Deliberately ignore API-side filters: the application must verify tenant and id too.
          assert.equal(url.searchParams.get("includeTokens"), "false");
          return json(res, {
            success: true,
            data: [...accounts.values()],
            total: accounts.size,
          });
        }
        if (
          url.pathname.startsWith("/api.outstand.so/v1/social-accounts/") &&
          req.method === "DELETE"
        ) {
          accounts.delete(decodeURIComponent(url.pathname.split("/").pop()));
          return json(res, { success: true });
        }
        if (url.pathname === "/api.outstand.so/v1/media/upload") {
          assert.equal(JSON.parse(raw).content_type, "video/mp4");
          const id = `media_${++calls.uploads}`;
          return json(res, {
            success: true,
            data: {
              id,
              upload_url: invalidUpload
                ? "http://127.0.0.1/private"
                : `https://test.r2.cloudflarestorage.com/${id}?signed=test`,
              expires_in: 3600,
            },
          });
        }
        if (url.pathname.startsWith("/test.r2.cloudflarestorage.com/")) {
          assert.equal(req.method, "PUT");
          assert.equal(req.headers.authorization, undefined);
          assert.equal(req.headers["content-type"], "video/mp4");
          assert.ok(bytes.length > 10000);
          calls.puts++;
          return json(res, {});
        }
        if (
          /^\/api.outstand.so\/v1\/media\/[^/]+\/confirm$/.test(url.pathname)
        ) {
          const id = url.pathname.split("/").at(-2);
          assert.ok(JSON.parse(raw).size > 10000);
          return json(res, {
            success: true,
            data: {
              id,
              status: "active",
              url: `https://media.outstand.so/test/${id}.mp4`,
            },
          });
        }
        if (
          url.pathname === "/api.outstand.so/v1/posts" &&
          req.method === "POST"
        ) {
          calls.createAttempts++;
          const key = req.headers["idempotency-key"];
          assert.ok(key);
          if (replays.has(key)) {
            const saved = replays.get(key);
            assert.equal(
              saved.raw,
              raw,
              "idempotent retries must use identical bytes",
            );
            if (holdReplay) {
              replayEntered();
              await new Promise((resolve) => (releaseReplay = resolve));
              if (res.destroyed) return;
            }
            return json(res, { success: true, post: posts.get(saved.id) });
          }
          const body = JSON.parse(raw);
          assert.equal(body.isDraft, true);
          assert.equal(body.accounts.length, 1);
          assert.ok(accounts.has(body.accounts[0]));
          assert.ok(
            body.containers[0].media[0].url.startsWith(
              "https://media.outstand.so/",
            ),
          );
          assert.equal(body.networkOverrideConfiguration, undefined);
          const id = `post_${++calls.creates}`,
            post = {
              id,
              isDraft: true,
              publishedAt: null,
              scheduledAt: body.scheduledAt || null,
              socialAccounts: [
                {
                  id: body.accounts[0],
                  network: "youtube",
                  status: "pending",
                  platformPostId: null,
                },
              ],
              request: body,
            };
          posts.set(id, post);
          replays.set(key, { id, raw });
          if (loseCreate) {
            loseCreate = false;
            return res.destroy();
          }
          return json(res, { success: true, post });
        }
        if (url.pathname.startsWith("/api.outstand.so/v1/posts/")) {
          const id = decodeURIComponent(url.pathname.split("/").pop()),
            post = posts.get(id);
          if (!post) return json(res, { success: false }, 404);
          if (req.method === "GET") return json(res, { success: true, post });
          if (req.method === "DELETE") {
            calls.deletes++;
            posts.delete(id);
            return json(res, { success: true });
          }
          if (req.method === "PATCH") {
            assert.equal(post.publishedAt, null);
            const body = JSON.parse(raw);
            post.isDraft = body.isDraft;
            post.scheduledAt = body.scheduledAt || post.scheduledAt;
            calls.activations++;
            if (loseActivation) {
              loseActivation = false;
              return res.destroy();
            }
            return json(res, {
              success: true,
              scheduled: true,
              rescheduled: true,
              post,
            });
          }
        }
        if (url.pathname === "/openrouter.ai/api/v1/chat/completions")
          return json(res, {
            choices: [
              {
                message: {
                  content:
                    "Mountains grow through forces deep beneath the surface. Every valley has a remarkable story.",
                },
              },
            ],
          });
        return json(
          res,
          { error: `Unexpected mock path: ${url.pathname}` },
          404,
        );
      } catch (error) {
        return json(res, { error: error.message }, 500);
      }
    });
    mock.listen(0, "127.0.0.1");
    await once(mock, "listening");
    const finder = createServer();
    finder.listen(0, "127.0.0.1");
    await once(finder, "listening");
    const port = finder.address().port;
    await new Promise((r) => finder.close(r));
    let holdReplay = false,
      replayEntered,
      releaseReplay;
    const replayReached = new Promise((resolve) => (replayEntered = resolve));
    let configuredKey = "mock-outstand-only";
    let server,
      logs = "";
    async function start() {
      server = spawn(process.execPath, ["server/index.js"], {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATA_DIR: dataDir,
          PORT: String(port),
          APP_URL: `http://127.0.0.1:${port}`,
          MOTION_TEST_PROVIDER_ORIGIN: `http://127.0.0.1:${mock.address().port}`,
          OUTSTAND_API_KEY: configuredKey,
          OPENROUTER_API_KEY: "mock-ai-only",
          GOOGLE_CLIENT_ID: "",
          GOOGLE_CLIENT_SECRET: "",
          TOKEN_ENCRYPTION_KEY: "",
          REQUIRE_EMAIL_VERIFICATION: "0",
          RESEND_API_KEY: "",
          MAIL_FROM: "",
          DEV_EMAIL_PREVIEW: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.stdout.on("data", (d) => (logs += d));
      server.stderr.on("data", (d) => (logs += d));
      for (let i = 0; i < 150; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error(logs);
    }
    async function stop() {
      if (server && server.exitCode === null) {
        const exited = once(server, "exit");
        server.kill("SIGTERM");
        await exited;
      }
    }
    let sql;
    t.after(async () => {
      releaseReplay?.();
      await stop();
      sql?.close();
      mock.closeAllConnections();
      await new Promise((r) => mock.close(r));
      await rm(dataDir, { recursive: true, force: true });
    });
    await start();
    const base = `http://127.0.0.1:${port}`;
    async function api(route, method = "GET", body, cookie) {
      const response = await fetch(`${base}/api${route}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "manual",
      });
      return {
        status: response.status,
        body: await response.json().catch(() => ({})),
        cookie: response.headers.get("set-cookie")?.split(";")[0],
        location: response.headers.get("location"),
      };
    }
    async function waitFor(route, predicate, cookie) {
      for (let i = 0; i < 300; i++) {
        const result = await api(route, "GET", null, cookie);
        if (predicate(result.body)) return result.body;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(
        `Timed out: ${route}: ${JSON.stringify((await api(route, "GET", null, cookie)).body)} ${logs}`,
      );
    }
    const owner = await api("/auth/signup", "POST", {
        name: "Owner",
        email: "owner@outstand.test",
        password: "owner password",
      }),
      other = await api("/auth/signup", "POST", {
        name: "Other",
        email: "other@outstand.test",
        password: "other password",
      });
    const cookie = owner.cookie,
      uid = owner.body.user.id,
      accountId = `Opaque_${uid}`;
    sql = new DatabaseSync(path.join(dataDir, "studio.sqlite"));
    assert.equal((await api("/health")).body.publishingProvider, "outstand");
    assert.deepEqual(
      (await api("/integrations", "GET", null, cookie)).body.integrations.find(
        (i) => i.id === "youtube",
      ).missing,
      [],
    );
    assert.equal((await api("/youtube/connect", "POST", {})).status, 401);
    async function begin(c = cookie) {
      const response = await api("/youtube/connect", "POST", {}, c);
      assert.equal(response.status, 200);
      return new URL(response.body.url).searchParams.get("redirect_uri");
    }
    function callback(redirect, id = accountId) {
      const url = new URL(redirect);
      url.searchParams.set("success", "true");
      url.searchParams.set("account_id", id);
      url.searchParams.set("username", "untrusted callback name");
      return url.pathname + url.search;
    }
    let redirect = await begin();
    assert.ok(
      (
        await api(callback(redirect).slice(4), "GET", null, other.cookie)
      ).location.includes("error="),
    );
    await begin(other.cookie);
    assert.ok(
      (
        await api(
          callback(redirect, `Opaque_${other.body.user.id}`).slice(4),
          "GET",
          null,
          cookie,
        )
      ).location.includes("error="),
    );
    redirect = await begin();
    assert.ok(
      (
        await api(callback(redirect).slice(4), "GET", null, cookie)
      ).location.includes("connected=1"),
    );
    assert.ok(
      (
        await api(callback(redirect).slice(4), "GET", null, cookie)
      ).location.includes("error="),
    );
    assert.equal(
      (await api("/youtube", "GET", null, cookie)).body.channel.title,
      "Verified test channel",
    );
    const p = await api(
      "/projects",
      "POST",
      {
        title: "Private scheduled story",
        script:
          "Mountains form through forces deep beneath the surface. Their story keeps unfolding.",
        background: "minimal",
      },
      cookie,
    );
    assert.equal(
      (await api(`/projects/${p.body.id}/render`, "POST", {}, cookie)).status,
      202,
    );
    const rendered = await waitFor(
      `/projects/${p.body.id}`,
      (p) => p.status === "succeeded",
      cookie,
    );
    async function readyProject(title) {
      const p = await api(
        "/projects",
        "POST",
        { title, script: rendered.script, background: "minimal" },
        cookie,
      );
      sql
        .prepare("UPDATE projects SET data=? WHERE id=?")
        .run(JSON.stringify({ ...rendered, id: p.body.id, title }), p.body.id);
      return p.body.id;
    }
    const future = () => new Date(Date.now() + 3600000).toISOString();
    async function publish(
      projectId,
      privacy = "private",
      publishAt = future(),
    ) {
      const response = await api(
        "/youtube/publish",
        "POST",
        {
          projectId,
          title: "A useful story",
          privacy,
          publishAt,
          confirmed: true,
          synthetic: true,
        },
        cookie,
      );
      assert.equal(response.status, 202, JSON.stringify(response.body));
      return response.body.id;
    }
    const publication = (id, state) =>
      waitFor(
        "/youtube",
        (r) => r.publications.find((p) => p.id === id)?.status === state,
        cookie,
      ).then((r) => r.publications.find((p) => p.id === id));
    const publicationFile = (id) =>
      sql.prepare("SELECT file FROM publications WHERE id=?").get(id).file;
    async function removed(file) {
      for (let i = 0; i < 150; i++) {
        try {
          await stat(file);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          // Another process can see unlink before the worker resumes to clear
          // SQLite metadata. Wait for both parts of cleanup to be durable.
          if (
            !sql.prepare("SELECT id FROM publications WHERE file=?").get(file)
          )
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail(`Publication copy cleanup did not finish: ${file}`);
    }
    const job = await publish(p.body.id);
    await publication(job, "failed");
    const cancelledCopy = publicationFile(job);
    assert.ok(
      (await stat(cancelledCopy)).size > 10000,
      "recoverable failures retain the copied export",
    );
    assert.equal(calls.creates, 1);
    assert.equal(calls.activations, 0);
    assert.equal(
      (
        await api(
          `/youtube/publications/${job}/retry`,
          "POST",
          {},
          other.cookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (await api(`/youtube/publications/${job}/retry`, "POST", {}, cookie))
        .status,
      202,
    );
    await publication(job, "failed");
    assert.equal(calls.creates, 1);
    assert.equal(calls.activations, 1);
    await api(`/youtube/publications/${job}/retry`, "POST", {}, cookie);
    const scheduled = await publication(job, "scheduled");
    assert.ok(
      (await stat(cancelledCopy)).size > 10000,
      "pending schedules retain their recovery copy",
    );
    assert.equal(scheduled.videoId, null);
    assert.equal(scheduled.privacy, "private");
    assert.equal(calls.creates, 1);
    assert.equal(calls.activations, 1);
    assert.equal(calls.puts, 1);
    assert.equal(
      posts.get(scheduled.postId).request.youtube.privacyStatus,
      "private",
    );
    assert.equal(
      (await api("/youtube/connection", "DELETE", null, cookie)).status,
      409,
    );
    assert.equal(
      (
        await api(
          "/youtube/publish",
          "POST",
          { projectId: p.body.id, privacy: "private", confirmed: true },
          cookie,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await api(
          `/youtube/publications/${job}/cancel-schedule`,
          "POST",
          {},
          cookie,
        )
      ).status,
      200,
    );
    await publication(job, "cancelled");
    await removed(cancelledCopy);
    assert.equal(publicationFile(job), null);
    assert.ok(
      (await stat(path.join(dataDir, rendered.file))).size > 10000,
      "the original export remains available",
    );
    assert.equal(posts.has(scheduled.postId), false);
    const instant = await publish(
      await readyProject("Unlisted immediate"),
      "unlisted",
      null,
    );
    const waiting = await publication(instant, "waiting");
    assert.equal(waiting.videoId, null);
    const immediatePost = posts.get(waiting.postId);
    const publishedCopy = publicationFile(instant);
    assert.equal(immediatePost.request.youtube.privacyStatus, "unlisted");
    function delivered(post) {
      post.publishedAt = new Date().toISOString();
      Object.assign(post.socialAccounts[0], {
        status: "published",
        platformPostId: `Video_${post.id}`,
        publishedAt: post.publishedAt,
      });
    }
    delivered(immediatePost);
    assert.ok(
      (await publication(instant, "published")).url.startsWith(
        "https://www.youtube.com/watch?v=",
      ),
    );
    await removed(publishedCopy);
    assert.equal(publicationFile(instant), null);
    const failed = await publish(
        await readyProject("Quota failure"),
        "public",
        null,
      ),
      pending = await publication(failed, "waiting");
    posts.get(pending.postId).socialAccounts[0].status = "failed";
    posts.get(pending.postId).socialAccounts[0].error =
      "daily_limit_reached: private provider details";
    assert.ok(
      (await publication(failed, "failed")).error.includes(
        "daily_limit_reached",
      ),
    );
    const putsBefore = calls.puts;
    await api(
      `/youtube/publications/${failed}/retry`,
      "POST",
      { publishAt: future() },
      cookie,
    );
    const replaced = await publication(failed, "scheduled");
    assert.notEqual(replaced.postId, pending.postId);
    assert.equal(posts.has(pending.postId), false);
    assert.equal(calls.puts, putsBefore);
    await api(
      `/youtube/publications/${failed}/cancel-schedule`,
      "POST",
      {},
      cookie,
    );
    const balance = (await api("/me", "GET", null, cookie)).body.user.credits;
    loseCreate = true;
    const createsBeforeSeries = calls.creates,
      putsBeforeSeries = calls.puts;
    const series = await api(
      "/series",
      "POST",
      {
        name: "Outstand daily",
        topics: ["Why mountains grow", "How valleys form"],
        intervalDays: 1,
        nextAt: new Date(Date.now() + 25 * 60000).toISOString(),
        settings: { background: "minimal", voice: "slt", privacy: "public" },
        synthetic: true,
        confirmed: true,
      },
      cookie,
    );
    assert.equal(series.status, 201);
    const lostSeries = await waitFor(
      "/series",
      (r) =>
        r.series.find((s) => s.id === series.body.id)?.runs[0]?.status ===
        "failed",
      cookie,
    );
    const lostRun = lostSeries.series.find((s) => s.id === series.body.id)
      .runs[0];
    const savedCreate = sql
      .prepare(
        "SELECT outstand_request,outstand_post_id FROM publications WHERE id=?",
      )
      .get(lostRun.publication_id);
    assert.equal(savedCreate.outstand_post_id, null);
    assert.equal(calls.creates, createsBeforeSeries + 1);
    const requestedTime = future();
    holdReplay = true;
    assert.equal(
      (
        await api(
          `/series/runs/${lostRun.id}/retry`,
          "POST",
          { publishAt: requestedTime },
          cookie,
        )
      ).status,
      200,
    );
    await Promise.race([
      replayReached,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error("Recovery did not replay the original draft request"),
            ),
          3000,
        );
        timer.unref();
      }),
    ]);
    // Crash after the new time is persisted, while the original draft replay is in flight.
    assert.equal(
      sql
        .prepare("SELECT publish_at FROM publications WHERE id=?")
        .get(lostRun.publication_id).publish_at,
      requestedTime,
    );
    await stop();
    holdReplay = false;
    releaseReplay();
    await start();
    const seriesState = await waitFor(
      "/series",
      (r) =>
        r.series.find((s) => s.id === series.body.id)?.runs[0]?.status ===
        "scheduled",
      cookie,
    );
    const run = seriesState.series.find((s) => s.id === series.body.id).runs[0],
      auto = (
        await api("/youtube", "GET", null, cookie)
      ).body.publications.find((p) => p.id === run.publication_id);
    assert.equal(auto.privacy, "public");
    assert.equal(auto.publishAt, requestedTime);
    assert.equal(posts.get(auto.postId).scheduledAt, requestedTime);
    assert.equal(
      posts.get(auto.postId).request.scheduledAt,
      JSON.parse(savedCreate.outstand_request).scheduledAt,
    );
    assert.equal(
      sql
        .prepare("SELECT outstand_request FROM publications WHERE id=?")
        .get(run.publication_id).outstand_request,
      savedCreate.outstand_request,
    );
    assert.equal(
      calls.creates,
      createsBeforeSeries + 1,
      "recovery must reuse the original draft across a restart",
    );
    assert.equal(
      calls.puts,
      putsBeforeSeries + 1,
      "recovery must reuse the uploaded media",
    );
    assert.equal(
      (await api("/me", "GET", null, cookie)).body.user.credits,
      balance - 1,
    );
    posts.get(auto.postId).socialAccounts[0].status = "failed";
    posts.get(auto.postId).socialAccounts[0].error = "quota_unavailable";
    const paused = await waitFor(
      "/series",
      (r) =>
        r.series.find((s) => s.id === series.body.id)?.runs[0]?.status ===
        "failed",
      cookie,
    );
    assert.equal(
      paused.series.find((s) => s.id === series.body.id).active,
      false,
    );
    await api(
      `/series/runs/${run.id}/retry`,
      "POST",
      { publishAt: future() },
      cookie,
    );
    await waitFor(
      "/series",
      (r) =>
        r.series.find((s) => s.id === series.body.id)?.runs[0]?.status ===
        "scheduled",
      cookie,
    );
    const retried = (
      await api("/youtube", "GET", null, cookie)
    ).body.publications.find((p) => p.id === run.publication_id);
    delivered(posts.get(retried.postId));
    await waitFor(
      "/series",
      (r) =>
        r.series.find((s) => s.id === series.body.id)?.runs[0]?.status ===
        "complete",
      cookie,
    );
    assert.equal(
      (await api("/me", "GET", null, cookie)).body.user.credits,
      balance - 1,
      "publication retry must not rerender or charge again",
    );
    invalidUpload = true;
    const bad = await publish(
      await readyProject("Invalid upload host"),
      "private",
      null,
    );
    await publication(bad, "failed");
    invalidUpload = false;
    loseCreate = true;
    const expired = await publish(
      await readyProject("Expired recovery"),
      "private",
      null,
    );
    await publication(expired, "failed");
    sql
      .prepare("UPDATE publications SET outstand_create_at=? WHERE id=?")
      .run(Date.now() - 24 * 3600000, expired);
    const creates = calls.creates;
    assert.equal(
      (await api(`/youtube/publications/${expired}/retry`, "POST", {}, cookie))
        .status,
      409,
    );
    assert.equal(calls.creates, creates);
    const next = await begin();
    sql.prepare("UPDATE outstand_states SET expires=0").run();
    assert.ok(
      (
        await api(callback(next).slice(4), "GET", null, cookie)
      ).location.includes("error="),
    );
    subscriptionMissing = true;
    assert.equal(
      (await api("/youtube/connect", "POST", {}, cookie)).status,
      502,
    );
    subscriptionMissing = false;
    assert.equal(
      (await api("/youtube/connection", "DELETE", null, cookie)).status,
      200,
    );
    await stop();
    // Simulate a crash after terminal state persistence but before file cleanup.
    await copyFile(path.join(dataDir, rendered.file), publishedCopy);
    sql
      .prepare("UPDATE publications SET file=? WHERE id=?")
      .run(publishedCopy, instant);
    // Missing files must also be reconciled after a restart.
    sql
      .prepare("UPDATE publications SET file=? WHERE id=?")
      .run(cancelledCopy, job);
    sql
      .prepare(
        "INSERT INTO publications(id,user_id,project_id,version,title,status,progress,created,updated) VALUES('legacy-google',?,'historic',1,'Old Google job','queued',0,?,?)",
      )
      .run(uid, new Date().toISOString(), new Date().toISOString());
    configuredKey = "";
    await start();
    await removed(publishedCopy);
    await waitFor(
      "/youtube",
      () => publicationFile(instant) === null && publicationFile(job) === null,
      cookie,
    );
    assert.equal(
      (await api("/health")).body.youtube,
      false,
      "cleanup must work without provider credentials",
    );
    assert.ok((await stat(path.join(dataDir, rendered.file))).size > 10000);
    assert.equal(
      (await api("/youtube", "GET", null, cookie)).body.publications.find(
        (p) => p.id === "legacy-google",
      ).status,
      "blocked",
    );
    assert.equal(calls.google, 0);
    assert.equal(
      (await api("/youtube", "GET", null, cookie)).body.channel,
      null,
    );
  },
);
