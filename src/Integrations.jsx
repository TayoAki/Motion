import React, { useEffect, useState } from "react";
import AutopilotSeries from "./AutopilotSeries.jsx";
import {
  ArrowRight,
  Check,
  CreditCard,
  ExternalLink,
  Mail,
  RefreshCw,
  ShieldCheck,
  Youtube,
} from "lucide-react";

async function api(route, options = {}) {
  const response = await fetch(`/api${route}`, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "The request could not be completed.");
  return data;
}
const money = (amount, currency = "usd") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    amount / 100,
  );
const date = (value) => new Date(value).toLocaleString();
function PreviewLink({ result }) {
  return result ? (
    <div className="info-note integration-message" role="status">
      <span>{result.message}</span>
      {result.previewURL && (
        <a href={result.previewURL}>
          Open development email preview <ArrowRight size={14} />
        </a>
      )}
    </div>
  ) : null;
}
export function EmailAction({ token, reset, refresh, signin }) {
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (reset && password !== confirmation)
        throw new Error("The passwords do not match.");
      const result = await api(
        `/auth/${reset ? "reset-password" : "verify-email"}`,
        { method: "POST", body: { token, ...(reset ? { password } : {}) } },
      );
      setMessage(result.message);
      setDone(true);
      await refresh();
      // The secret stays in component state only until the action completes.
      window.history.replaceState(null, "", "#settings");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel integration-action">
      <ShieldCheck size={32} />
      <h1>{reset ? "Choose a new password" : "Confirm your email address"}</h1>
      <p>
        {reset
          ? "This will sign out every session and revoke existing API keys."
          : "Confirm that you requested this email address. Links can only be used once."}
      </p>
      {!done && (
        <form className="auth-form" onSubmit={submit}>
          {reset && (
            <>
              <label>
                New password
                <input
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            </>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Working…" : reset ? "Reset password" : "Confirm email"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {done && (
        <button className="button secondary" onClick={signin}>
          Continue to sign in <ArrowRight size={16} />
        </button>
      )}
    </section>
  );
}
export function ForgotPassword({ close }) {
  const [email, setEmail] = useState(""),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(
        await api("/auth/forgot-password", { method: "POST", body: { email } }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="modal-description">
        We’ll send a single-use recovery link to your account email.
      </p>
      <form className="auth-form" onSubmit={submit}>
        <label>
          Email address
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <PreviewLink result={result} />
      <button className="text-button" onClick={close}>
        Back to sign in
      </button>
    </>
  );
}
export function AccountSecurity({ user, refresh, notify }) {
  const [emailStatus, setEmailStatus] = useState({}),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [newEmail, setNewEmail] = useState(""),
    [emailPassword, setEmailPassword] = useState("");
  useEffect(() => {
    api("/auth/email-status")
      .then(setEmailStatus)
      .catch((e) => notify(e.message));
  }, []);
  async function act(route, body, clear) {
    setBusy(true);
    try {
      const result = await api(`/auth/${route}`, { method: "POST", body });
      setResult(result);
      clear?.();
      await refresh();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel integration-security">
      <span className="soft-pill">ACCOUNT SECURITY</span>
      <h2>Email & password</h2>
      <div className="integration-toolbar">
        <span>
          {user.emailVerified ? "Email verified" : "Email not yet verified"}
        </span>
        {!user.emailVerified && (
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() => act("resend-verification", {})}
          >
            <Mail size={15} />
            Send verification link
          </button>
        )}
      </div>
      {!emailStatus.configured && (
        <p className="footnote">
          {emailStatus.preview
            ? "Development previews are enabled on this local machine. No emails will be sent."
            : "Sending verification or recovery mail requires RESEND_API_KEY and MAIL_FROM on the server."}
        </p>
      )}
      <PreviewLink result={result} />
      <details>
        <summary>Change password</summary>
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              "change-password",
              { currentPassword, password: newPassword },
              () => {
                setCurrentPassword("");
                setNewPassword("");
              },
            );
          }}
        >
          <label>
            Current password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              maxLength={128}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              maxLength={128}
            />
          </label>
          <button className="button secondary" disabled={busy}>
            Change password
          </button>
        </form>
      </details>
      <details>
        <summary>Change email address</summary>
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              "change-email",
              { email: newEmail, password: emailPassword },
              () => setEmailPassword(""),
            );
          }}
        >
          <label>
            New email
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </label>
          <label>
            Current password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              maxLength={128}
            />
          </label>
          <p className="footnote">
            Your email changes after you confirm the link sent to the new
            address. Confirmation signs out all browser sessions.
          </p>
          <button className="button secondary" disabled={busy}>
            Send confirmation
          </button>
        </form>
      </details>
    </section>
  );
}
export function BillingPanel({ user, showPlans, notify }) {
  const [billing, setBilling] = useState(null),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/billing")
      .then(setBilling)
      .catch((e) => notify(e.message));
  useEffect(() => {
    load();
  }, [user?.credits]);
  async function portal() {
    setBusy(true);
    try {
      window.location.assign(
        (await api("/billing/portal", { method: "POST", body: {} })).url,
      );
    } catch (e) {
      notify(e.message);
      setBusy(false);
    }
  }
  const returned = new URLSearchParams(window.location.hash.split("?")[1]).get(
    "checkout",
  );
  return (
    <section className="panel integration-billing">
      <span className="soft-pill">YOUR PLAN</span>
      <h2>
        {billing?.account?.plan?.replaceAll("_", " ") || "Starter workspace"}
      </h2>
      <p>
        {billing?.account?.status && billing.account.status !== "none"
          ? `Subscription ${billing.account.status}.`
          : "300 starter credits. Real rendering. No subscription required to try it."}
      </p>
      <div className="setting-balance">
        <CreditCard size={21} />
        <strong>{user.credits}</strong>
        <span>credits remaining</span>
      </div>
      {returned === "success" && (
        <div className="info-note">
          Checkout returned successfully. Credits appear after Stripe confirms
          the paid invoice.{" "}
          <button className="text-button" onClick={load}>
            Refresh billing
          </button>
        </div>
      )}
      {returned === "cancelled" && (
        <div className="info-note">
          Checkout was cancelled. No new allowance has been added.
        </div>
      )}
      {billing?.account?.cancel_at_period_end === 1 && (
        <p>
          Subscription ends {date(billing.account.period_end * 1000)}. Your
          remaining credits stay available.
        </p>
      )}
      <div className="integration-toolbar">
        <button className="button primary" onClick={showPlans}>
          Choose a plan
          <ArrowRight size={16} />
        </button>
        {billing?.account && billing.account.status !== "none" && (
          <button className="button secondary" disabled={busy} onClick={portal}>
            Manage or cancel subscription
            <ExternalLink size={15} />
          </button>
        )}
      </div>
      {!billing?.configured && (
        <p className="footnote">
          Billing is implemented. Set the Stripe keys, webhook secret, and price
          IDs on the server to activate checkout.
        </p>
      )}
      {!!billing?.payments?.length && (
        <>
          <h3>Payment receipts</h3>
          <div className="integration-list">
            {billing.payments.map((p) => (
              <div key={p.invoice}>
                <span>
                  {date(p.created * 1000)} · {p.credits.toLocaleString()}{" "}
                  credits
                </span>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {money(p.amount, p.currency)} · Receipt
                    <ExternalLink size={14} />
                  </a>
                ) : (
                  <strong>{money(p.amount, p.currency)}</strong>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
export function PlanPicker({ user, close, signin, notify }) {
  const [yearly, setYearly] = useState(false),
    [catalog, setCatalog] = useState(null),
    [busy, setBusy] = useState("");
  useEffect(() => {
    api("/billing/plans")
      .then(setCatalog)
      .catch((e) => notify(e.message));
  }, []);
  async function checkout(plan) {
    if (!user) {
      close();
      signin();
      return;
    }
    setBusy(plan.key);
    try {
      window.location.assign(
        (
          await api("/billing/checkout", {
            method: "POST",
            body: { plan: plan.key },
          })
        ).url,
      );
    } catch (e) {
      notify(e.message);
      setBusy("");
    }
  }
  return (
    <>
      <p className="modal-description">
        Choose a recurring credit allowance. Checkout, invoices, and
        cancellation are handled by Stripe.
      </p>
      <label className="integration-check">
        <input
          type="checkbox"
          checked={yearly}
          onChange={(e) => setYearly(e.target.checked)}
        />
        Annual billing · full annual allowance on each paid annual invoice
      </label>
      {!catalog && <p role="status">Loading plans…</p>}
      <div className="plan-grid">
        {catalog?.plans
          .filter((p) => p.period === (yearly ? "yearly" : "monthly"))
          .map((p, i) => (
            <div className={`plan ${i === 1 ? "featured" : ""}`} key={p.key}>
              <h3>{p.name}</h3>
              <div className="plan-price">
                {money(p.amount, p.currency)}
                <span>/{yearly ? "year" : "month"}</span>
              </div>
              <strong className="plan-credits">
                {p.credits.toLocaleString()} credits /{" "}
                {yearly ? "year" : "month"}
              </strong>
              <button
                className="button primary full"
                disabled={!!busy || !p.enabled}
                onClick={() => checkout(p)}
              >
                {busy === p.key
                  ? "Opening Stripe…"
                  : !p.enabled
                    ? "Server setup required"
                    : user
                      ? `Choose ${p.name}`
                      : "Sign in to choose"}
              </button>
              {[
                "Narrated 1080p MP4s",
                "Landscape & portrait",
                "Scene editing & captions",
                "YouTube upload & scheduling",
              ].map((f) => (
                <span className="plan-feature" key={f}>
                  <Check size={14} />
                  {f}
                </span>
              ))}
            </div>
          ))}
      </div>
      {catalog && !catalog.configured && (
        <div className="info-note">
          Checkout is disabled until the server has Stripe credentials, a
          signing secret, and configured recurring prices. Displayed prices are
          setup defaults. Configured plans show the actual Stripe price.
        </div>
      )}
      <p className="footnote">
        Credits are granted once per paid billing period. Cancelling stops
        future renewals. Existing subscribers can change plans in the billing
        portal; the new allowance begins with the next renewal invoice.
      </p>
    </>
  );
}
export function PublishStudio({ user, projects, requireUser, notify }) {
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [projectId, setProjectId] = useState(""),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [privacy, setPrivacy] = useState("private"),
    [publishAt, setPublishAt] = useState(""),
    [kids, setKids] = useState(false),
    [synthetic, setSynthetic] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const load = () =>
    api("/youtube")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!user) {
      setData(null);
      return;
    }
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [user?.id]);
  const notice = new URLSearchParams(window.location.hash.split("?")[1]);
  async function act(route, body, method = "POST") {
    if (!requireUser()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/youtube${route}`, { method, body });
      if (result.url && route === "/connect")
        window.location.assign(result.url);
      else {
        await load();
        notify(result.message || "Publishing updated.");
      }
      return result;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    const result = await act("/publish", {
      projectId,
      title,
      description,
      privacy,
      publishAt: publishAt ? new Date(publishAt).toISOString() : null,
      madeForKids: kids,
      synthetic,
      confirmed,
    });
    if (result) setConfirmed(false);
  }
  const ready = projects.filter((p) => p.status === "succeeded" && !p.dirty);
  return (
    <>
      <div className="page-intro">
        <span className="eyebrow">CREATE. CONNECT. PUBLISH.</span>
        <h1>Your channel, in a rhythm</h1>
        <p>
          Upload a finished export now or choose a time for YouTube to publish
          it.
        </p>
      </div>
      {(error || notice.get("error")) && (
        <div className="error-message" role="alert">
          {error || notice.get("error")}
        </div>
      )}
      {notice.get("connected") && data?.channel && (
        <div className="info-note">
          Channel connected: {data.channel.title}.
        </div>
      )}
      <section className="panel integration-channel">
        <div>
          <Youtube size={32} />
          <h2>{data?.channel?.title || "Connect your YouTube channel"}</h2>
          <p>
            {data?.channel
              ? "Your access tokens are encrypted on the server. Disconnecting leaves existing YouTube videos and schedules in place."
              : "Grant access through Google. Your password is never shared with this app."}
          </p>
        </div>
        {!user ? (
          <button className="button primary" onClick={requireUser}>
            Sign in to connect
          </button>
        ) : (
          <button
            className="button secondary"
            disabled={busy || !data?.configured}
            onClick={() =>
              data?.channel
                ? window.confirm(
                    "Disconnect YouTube? Existing videos and schedules will remain on YouTube.",
                  ) && act("/connection", undefined, "DELETE")
                : act("/connect", {})
            }
          >
            {data?.channel ? "Disconnect channel" : "Connect with Google"}
          </button>
        )}
        {user && !data?.configured && (
          <div className="info-note">
            Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and
            TOKEN_ENCRYPTION_KEY. Add this exact OAuth callback in Google Cloud:{" "}
            <code>{data?.callbackURL || "Loading…"}</code>
          </div>
        )}
      </section>
      {data?.channel && (
        <section className="panel integration-publish">
          <h2>Publish an exported video</h2>
          {!ready.length ? (
            <p>
              Generate a video and export its latest changes first.{" "}
              <a href="#create">
                Create a video <ArrowRight size={14} />
              </a>
            </p>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <label>
                Video
                <select
                  required
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setTitle(
                      ready.find((p) => p.id === e.target.value)?.title || "",
                    );
                    setConfirmed(false);
                  }}
                >
                  <option value="">Choose an exported project</option>
                  {ready.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                YouTube title
                <input
                  required
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Description
                <textarea
                  maxLength={5000}
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <div className="integration-columns">
                <label>
                  Visibility
                  <select
                    value={privacy}
                    onChange={(e) => setPrivacy(e.target.value)}
                    disabled={!!publishAt}
                  >
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <label>
                  Publish time (your timezone, optional)
                  <input
                    type="datetime-local"
                    value={publishAt}
                    onChange={(e) => setPublishAt(e.target.value)}
                  />
                </label>
              </div>
              <p className="footnote">
                Scheduled videos stay private until YouTube publishes them.
                Choose at least ten minutes from now. Unverified Google API
                projects may be restricted to private uploads.
              </p>
              <label className="integration-check">
                <input
                  type="checkbox"
                  checked={kids}
                  onChange={(e) => setKids(e.target.checked)}
                />
                This video is made for kids
              </label>
              <label className="integration-check">
                <input
                  type="checkbox"
                  checked={synthetic}
                  onChange={(e) => setSynthetic(e.target.checked)}
                />
                This video contains realistic altered or synthetic content
              </label>
              <label className="integration-check">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I own the rights to this video and confirm these publishing
                choices.
              </label>
              <button className="button primary" disabled={busy || !confirmed}>
                {busy
                  ? "Queueing…"
                  : publishAt
                    ? "Upload & schedule on YouTube"
                    : "Upload to YouTube"}
                <Youtube size={17} />
              </button>
            </form>
          )}
        </section>
      )}
      {user && (
        <section className="panel integration-publications">
          <div className="integration-toolbar">
            <h2>Content calendar & uploads</h2>
            <button className="button ghost small" onClick={load}>
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
          {!data?.publications?.length ? (
            <p>Your uploads and scheduled videos will appear here.</p>
          ) : (
            <div className="integration-list">
              {data.publications.map((p) => (
                <article key={p.id}>
                  <div>
                    <strong>{p.title}</strong>
                    <span>
                      {p.status} · {p.privacy}
                      {p.publishAt ? ` · ${date(p.publishAt)}` : ""}
                    </span>
                    {["queued", "uploading", "finishing"].includes(
                      p.status,
                    ) && <progress value={p.progress} max={100} />}{" "}
                    {p.error && <p className="error-message">{p.error}</p>}
                  </div>
                  <div className="integration-toolbar">
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noreferrer">
                        Open on YouTube
                        <ExternalLink size={14} />
                      </a>
                    )}
                    {p.status === "failed" && (
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() => act(`/publications/${p.id}/retry`, {})}
                      >
                        Resume upload
                      </button>
                    )}
                    {p.status === "scheduled" && (
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() =>
                          window.confirm(
                            "Remove this scheduled time and keep the video private?",
                          ) && act(`/publications/${p.id}/cancel-schedule`, {})
                        }
                      >
                        Cancel schedule
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      <AutopilotSeries user={user} notify={notify} />
    </>
  );
}
export function PaymentSummary({ user }) {
  const [payments, setPayments] = useState([]);
  useEffect(() => {
    if (user)
      api("/billing")
        .then((r) => setPayments(r.payments))
        .catch(() => {});
  }, [user?.id, user?.credits]);
  const totals = Object.entries(
    payments.reduce((all, p) => {
      all[p.currency] = (all[p.currency] || 0) + p.amount;
      return all;
    }, {}),
  );
  return (
    <strong>
      {totals.length
        ? totals.map(([currency, total]) => money(total, currency)).join(" + ")
        : "$0.00"}
      <small>Confirmed invoices</small>
    </strong>
  );
}
export function IntegrationStatus({ notify }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api("/integrations")
      .then(setData)
      .catch((e) => notify(e.message));
  }, []);
  return (
    <section className="panel integration-publish">
      <span className="soft-pill">SERVICE CONNECTIONS</span>
      <h2>Ready for your provider accounts</h2>
      <p className="modal-description">
        Credentials stay on the server. Configured services become available in
        the corresponding studio tools.
      </p>
      {!data ? (
        <p>Loading server configuration…</p>
      ) : (
        <div className="integration-list">
          {data.integrations.map((i) => (
            <div key={i.id}>
              <strong>{i.name}</strong>
              <span>
                {i.configured ? "Configured" : `Needs ${i.missing.join(", ")}`}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="footnote">
        Configuration checks indicate that values are present, not that a
        provider has approved the account or domain. YouTube also needs a
        connected channel.
      </p>
    </section>
  );
}
