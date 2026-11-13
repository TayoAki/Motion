import React, { useEffect, useState } from "react";
import { ArrowRight, Pause, Play, Sparkles } from "lucide-react";

async function api(route, method = "GET", body) {
  const response = await fetch(`/api/series${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Autopilot could not complete this request.");
  return data;
}
export default function AutopilotSeries({ user, notify }) {
  const [data, setData] = useState(null),
    [name, setName] = useState("My story series"),
    [topics, setTopics] = useState(""),
    [nextAt, setNextAt] = useState(""),
    [intervalDays, setIntervalDays] = useState(1),
    [aspect, setAspect] = useState("16:9"),
    [background, setBackground] = useState("mountains"),
    [voice, setVoice] = useState("slt"),
    [privacy, setPrivacy] = useState("private"),
    [confirmed, setConfirmed] = useState(false),
    [kids, setKids] = useState(false),
    [synthetic, setSynthetic] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    api("")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!user) return;
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [user?.id]);
  async function act(route, method, body) {
    setBusy(true);
    setError("");
    try {
      const result = await api(route, method, body);
      await load();
      return result;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function create(e) {
    e.preventDefault();
    const result = await act("", "POST", {
      name,
      topics: topics.split("\n"),
      nextAt: new Date(nextAt).toISOString(),
      intervalDays,
      settings: {
        aspect,
        background,
        voice,
        captions: true,
        graphics: true,
        music: false,
        privacy,
      },
      madeForKids: kids,
      synthetic,
      confirmed,
    });
    if (result) {
      setTopics("");
      setConfirmed(false);
      notify("Autopilot series created. Future runs are in your calendar.");
    }
  }
  if (!user) return null;
  return (
    <section className="panel integration-publish">
      <span className="soft-pill">AUTOPILOT</span>
      <h2>A new story, on schedule</h2>
      <p className="modal-description">
        Queue topics once. Autopilot writes each script, generates a video, uses
        your credits, and schedules it on your connected channel. The server
        must stay running.
      </p>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {!data?.configured && (
        <div className="info-note">
          Recurring generation needs a server-side OpenRouter key and configured
          Google OAuth. Connect your channel above before starting a series.
        </div>
      )}
      <details>
        <summary>Create a recurring series</summary>
        <form className="auth-form" onSubmit={create}>
          <label>
            Series name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Topics, one per line
            <textarea
              required
              rows={5}
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              placeholder={
                "Why mountains grow\nHow glaciers shape valleys\nWhat makes the ocean blue"
              }
            />
          </label>
          <div className="integration-columns">
            <label>
              First publishing time (your timezone)
              <input
                type="datetime-local"
                required
                value={nextAt}
                onChange={(e) => setNextAt(e.target.value)}
              />
            </label>
            <label>
              Repeat interval
              <select
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
              >
                <option value={1}>Every 24 hours</option>
                <option value={7}>Every 7 days</option>
              </select>
            </label>
            <label>
              Publication visibility
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value)}
              >
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
            </label>
            <label>
              Format
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
              >
                <option>16:9</option>
                <option>9:16</option>
              </select>
            </label>
            <label>
              Visuals
              <select
                value={background}
                onChange={(e) => setBackground(e.target.value)}
              >
                {[
                  "mountains",
                  "ocean",
                  "forest",
                  "space",
                  "night",
                  "minimal",
                ].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <label>
              Voice
              <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                <option value="slt">Aria</option>
                <option value="rms">Miles</option>
                <option value="awb">Oliver</option>
                <option value="kal">Alex</option>
              </select>
            </label>
          </div>
          <p className="footnote">
            Choose at least 15 minutes from now. Preparation begins up to 30
            minutes before each publishing time. Intervals are measured in UTC;
            local times may shift with daylight saving.
          </p>
          <label className="integration-check">
            <input
              type="checkbox"
              checked={kids}
              onChange={(e) => setKids(e.target.checked)}
            />
            These videos are made for kids
          </label>
          <label className="integration-check">
            <input
              type="checkbox"
              checked={synthetic}
              onChange={(e) => setSynthetic(e.target.checked)}
            />
            These videos contain realistic altered or synthetic content
          </label>
          <label className="integration-check">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I authorize generation credit use, transfer to Outstand media
            storage (public media URLs retained for up to 60 days), and
            automatic scheduled publishing as {privacy}
            for these topics, and have reviewed their suitability and rights.
          </label>
          <button
            className="button primary"
            disabled={busy || !data?.configured || !confirmed}
          >
            <Sparkles size={16} />
            {busy ? "Creating…" : "Start Autopilot"}
          </button>
        </form>
      </details>
      <div className="integration-list">
        {data?.series.map((s) => (
          <article key={s.id}>
            <div>
              <strong>{s.name}</strong>
              <span>
                {s.active ? "Active" : "Paused or complete"} · {s.topics.length}{" "}
                topics remaining · every{" "}
                {s.intervalDays === 1 ? "24 hours" : "7 days"}
              </span>
              {s.topics.length > 0 && (
                <span>Next: {new Date(s.nextAt).toLocaleString()}</span>
              )}
              {s.error && <p className="error-message">{s.error}</p>}
              <details>
                <summary>Runs & progress</summary>
                {!s.runs.length ? (
                  <p>
                    Preparation starts within 30 minutes of the first publishing
                    time.
                  </p>
                ) : (
                  s.runs.map((r) => (
                    <div className="integration-series-run" key={r.id}>
                      <strong>{r.topic}</strong>
                      <span>
                        {r.status} · {new Date(r.scheduled_at).toLocaleString()}
                      </span>
                      {r.project_id && (
                        <a href={`#project/${r.project_id}`}>
                          Open generated project
                          <ArrowRight size={13} />
                        </a>
                      )}
                      {r.error && <p className="error-message">{r.error}</p>}
                      {r.status === "failed" && (
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() => {
                            const time = window.prompt(
                              "Retry publishing time (ISO date and time, including timezone)",
                              new Date(Date.now() + 3600000).toISOString(),
                            );
                            if (time)
                              act(`/runs/${r.id}/retry`, "POST", {
                                publishAt: time,
                              });
                          }}
                        >
                          Retry this run
                        </button>
                      )}
                    </div>
                  ))
                )}
              </details>
            </div>
            <button
              className="button secondary small"
              disabled={busy || (!s.active && !s.topics.length)}
              onClick={() => act(`/${s.id}`, "PATCH", { active: !s.active })}
            >
              {s.active ? <Pause size={14} /> : <Play size={14} />}{" "}
              {s.active ? "Pause future runs" : "Resume future runs"}
            </button>
          </article>
        ))}
      </div>
      <p className="footnote">
        Pausing affects future runs. A run already being generated or uploaded
        continues. Failures pause future runs; missed publishing times are never
        published immediately. The series stops when it runs out of topics.
      </p>
    </section>
  );
}
