import React, { useEffect, useRef, useState } from "react";
import {
  EmailAction,
  ForgotPassword,
  AccountSecurity,
  BillingPanel,
  PlanPicker,
  PublishStudio,
  PaymentSummary,
  IntegrationStatus,
} from "./Integrations.jsx";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  CreditCard,
  FileText,
  Film,
  FolderOpen,
  Globe2,
  Headphones,
  Image,
  Layers3,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Menu,
  Mic2,
  Monitor,
  MoreHorizontal,
  Mountain,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
  WandSparkles,
  X,
  Youtube,
  Zap,
} from "lucide-react";

const backgrounds = [
  {
    id: "mountains",
    name: "Cinematic",
    tag: "Expansive & inspiring",
    image: "/media/mountains.jpg",
  },
  {
    id: "ocean",
    name: "Ocean",
    tag: "Calm & immersive",
    image: "/media/ocean.jpg",
  },
  {
    id: "forest",
    name: "Nature",
    tag: "Rich & organic",
    image: "/media/forest.jpg",
  },
  {
    id: "space",
    name: "Space",
    tag: "Beyond the ordinary",
    image: "/media/space.jpg",
  },
  {
    id: "night",
    name: "Night sky",
    tag: "A little wonder",
    image: "/media/night.jpg",
  },
  { id: "minimal", name: "Minimal", tag: "Let the story lead", image: "" },
];
const voices = [
  {
    id: "slt",
    name: "Aria",
    kind: "Female · American",
    color: "peach",
    initial: "A",
    description: "Clear & conversational",
  },
  {
    id: "rms",
    name: "Miles",
    kind: "Male · American",
    color: "blue",
    initial: "M",
    description: "Warm & grounded",
  },
  {
    id: "awb",
    name: "Oliver",
    kind: "Male · Scottish",
    color: "green",
    initial: "O",
    description: "Thoughtful & distinctive",
  },
  {
    id: "kal",
    name: "Alex",
    kind: "Male · American",
    color: "purple",
    initial: "A",
    description: "Classic & direct",
  },
];
const sample =
  "Some places make you feel small in the best possible way. High above the clouds, the mountains tell a story that began millions of years ago. Every ridge holds a memory. Every valley offers a new perspective. Out here, the world slows down, and the things that matter become a little clearer. Sometimes, all it takes is a different view.";
const initialForm = {
  title: "",
  script: "",
  voice: "slt",
  background: "mountains",
  aspect: "16:9",
  captions: true,
  graphics: true,
  music: false,
  musicVolume: 0.08,
  audioId: null,
  musicId: null,
};
const iconSize = 18;
const currentRoute = () =>
  window.location.hash.replace(/^#\/?/, "").split("?")[0] || "create";
async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body:
      options.body && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
const duration = (n) => {
  const seconds = Math.max(0, Math.round(n || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const navigate = (route) => {
  window.location.hash = "/" + route;
};
function Logo({ light = false }) {
  return (
    <div className={`logo ${light ? "light" : ""}`}>
      <span className="logo-symbol">
        <Zap size={22} fill="currentColor" strokeWidth={1} />
      </span>
      <span>
        go<span className="logo-weight">motion</span>
        <span className="logo-period">.</span>
      </span>
    </div>
  );
}
function Spinner() {
  return <LoaderCircle size={18} className="spin" />;
}
function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function SectionTitle({ number, title, children }) {
  return (
    <div className="section-title">
      <span className="section-number">{number}</span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
function Modal({ title, children, close, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    node?.focus();
    const listener = (e) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const els = [
          ...node.querySelectorAll(
            'button,input,textarea,select,a[href],[tabindex="0"]',
          ),
        ].filter((el) => !el.disabled);
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      previous?.focus();
      document.removeEventListener("keydown", listener);
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(currentRoute());
  const [user, setUser] = useState(null),
    [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState(null),
    [modal, setModal] = useState(null);
  const [emailDelivery, setEmailDelivery] = useState(null);
  const [projects, setProjects] = useState([]),
    [health, setHealth] = useState({});
  const [toast, setToast] = useState(null),
    [mobile, setMobile] = useState(false);
  const [form, setForm] = useState(() => {
    try {
      return {
        ...initialForm,
        ...JSON.parse(localStorage.getItem("motion-draft") || "{}"),
        audioId: null,
        musicId: null,
      };
    } catch {
      return initialForm;
    }
  });
  const [inputMode, setInputMode] = useState("script"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [topic, setTopic] = useState(""),
    [audioName, setAudioName] = useState("");
  const [audioDuration, setAudioDuration] = useState(0),
    [previewVoice, setPreviewVoice] = useState(null);
  const voicePlayer = useRef(null);
  const notify = (message) => setToast(message);
  const update = (key, value) => {
    setError("");
    setForm((f) => ({ ...f, [key]: value }));
  };
  const refresh = async () => {
    const me = await api("/me");
    setUser(me.user);
    if (me.user) setProjects(await api("/projects"));
    else setProjects([]);
  };
  useEffect(() => {
    const listener = () => {
      setRoute(currentRoute());
      setMobile(false);
      setError("");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", listener);
    api("/health")
      .then(setHealth)
      .catch(() => {});
    refresh()
      .catch(() => {})
      .finally(() => setAuthReady(true));
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    localStorage.setItem(
      "motion-draft",
      JSON.stringify({ ...form, audioId: null, musicId: null }),
    );
  }, [form]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      if (projects.some((p) => ["running", "queued"].includes(p.status)))
        refresh().catch(() => {});
    }, 1800);
    return () => clearInterval(interval);
  }, [user?.id, projects]);
  const requireUser = () => {
    if (!user) {
      setAuthMode("signup");
      return false;
    }
    return true;
  };
  const words = form.script.trim().split(/\s+/).filter(Boolean).length;
  const seconds = form.audioId ? audioDuration : Math.max(3, words / 2.25);
  const cost = Math.max(1, Math.ceil(seconds / 15));
  const selectedBackground = backgrounds.find((b) => b.id === form.background);
  const selectedVoice = voices.find((v) => v.id === form.voice);
  async function create(render = true) {
    if (!requireUser()) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        ...form,
        audioId: inputMode === "audio" ? form.audioId : null,
      };
      if (inputMode === "audio" && !form.audioId)
        throw new Error("Upload narration before creating your video.");
      const p = await api("/projects", { method: "POST", body });
      if (render) {
        try {
          await api(`/projects/${p.id}/render`, { method: "POST", body: {} });
        } catch (e) {
          await refresh();
          navigate(`project/${p.id}`);
          notify(e.message);
          return;
        }
      }
      await refresh();
      navigate(`project/${p.id}`);
      if (!render) notify("Draft saved. Pick it up whenever you are ready.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadAudio(event, kind) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file || !requireUser()) return;
    if (file.size > 100 * 1024 * 1024)
      return setError("The upload limit is 100 MB.");
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api(`/uploads/${kind}`, { method: "POST", body });
      update(kind === "music" ? "musicId" : "audioId", result.id);
      if (kind === "narration") {
        setAudioName(result.name);
        setAudioDuration(result.duration);
      } else notify(`Music uploaded: ${result.name}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function generateScript() {
    if (!requireUser()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/scripts", { method: "POST", body: { topic } });
      setForm((f) => ({
        ...f,
        title: topic.slice(0, 100),
        script: result.content,
      }));
      setInputMode("script");
      notify(
        result.source === "ai"
          ? "Your AI script is ready."
          : "Starter draft created. Edit and fact-check it before generating.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function playVoice(id) {
    if (!requireUser()) return;
    if (voicePlayer.current) voicePlayer.current.pause();
    if (previewVoice === id) {
      setPreviewVoice(null);
      return;
    }
    const audio = new Audio(`/api/voices/${id}`);
    voicePlayer.current = audio;
    setPreviewVoice(id);
    audio.onended = () => setPreviewVoice(null);
    audio.onerror = () => {
      notify("Voice preview is unavailable. Please retry.");
      setPreviewVoice(null);
    };
    audio.play().catch(() => {
      setPreviewVoice(null);
      notify("Voice preview could not play.");
    });
  }
  const pageName =
    {
      create: "Create a video",
      projects: "My projects",
      scripts: "Script studio",
      thumbnails: "Thumbnail studio",
      autopilot: "YouTube publishing",
      api: "API & integrations",
      history: "Credit history",
      settings: "Account settings",
    }[route] || (route.startsWith("project/") ? "Video editor" : "Studio");
  return (
    <>
      {route === "home" ? (
        <Landing
          enter={() => navigate("create")}
          signup={() => setAuthMode("signup")}
        />
      ) : (
        <div className="app-shell">
          {mobile && (
            <button
              className="sidebar-overlay"
              aria-label="Close navigation"
              onClick={() => setMobile(false)}
            />
          )}
          <aside className={`sidebar ${mobile ? "open" : ""}`}>
            <a href="#/home" className="logo-link" aria-label="GoMotion home">
              <Logo />
            </a>
            <button
              className="workspace"
              onClick={() =>
                user ? navigate("settings") : setAuthMode("signup")
              }
            >
              <span className="workspace-icon">
                {user?.name?.[0]?.toUpperCase() || "P"}
              </span>
              <span>
                <strong>Personal workspace</strong>
                <small>{user ? "Local studio" : "Your creative space"}</small>
              </span>
              <ChevronDown size={14} />
            </button>
            <div className="nav-label">WORKSPACE</div>
            <nav>
              {[
                ["create", Plus, "Create a video"],
                ["projects", FolderOpen, "My projects"],
              ].map(([r, Icon, label]) => (
                <a
                  href={`#/${r}`}
                  key={r}
                  className={`nav-item ${route === r ? "active" : ""}`}
                >
                  <Icon size={iconSize} />
                  {label}
                  {r === "projects" && projects.length > 0 && (
                    <span className="nav-count">{projects.length}</span>
                  )}
                </a>
              ))}
              <div className="nav-label tools-label">CREATIVE TOOLS</div>
              {[
                ["scripts", FileText, "Script studio"],
                ["thumbnails", Image, "Thumbnails"],
                ["autopilot", Youtube, "Publish & schedule"],
                ["api", Code2, "API & integrations"],
              ].map(([r, Icon, label]) => (
                <a
                  href={`#/${r}`}
                  key={r}
                  className={`nav-item ${route === r ? "active" : ""}`}
                >
                  <Icon size={iconSize} />
                  {label}
                  {r === "autopilot" && <span className="new-tag">NEW</span>}
                </a>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <button
                className="tutorial-card"
                onClick={() => setModal("tutorial")}
              >
                <span className="tutorial-icon">
                  <Play size={16} fill="currentColor" />
                </span>
                <strong>A little inspiration?</strong>
                <span>
                  Make your first video <ArrowRight size={13} />
                </span>
              </button>
              <a
                href="#/history"
                className={`nav-item ${route === "history" ? "active" : ""}`}
              >
                <Clock3 size={18} />
                Credit history
              </a>
              <button className="nav-item" onClick={() => setModal("help")}>
                <CircleHelp size={18} />
                Help & resources
                <ArrowRight size={13} className="push-right" />
              </button>
              <div className="credit-box">
                <div>
                  <span>
                    <Zap size={14} fill="currentColor" />
                    Local credits
                  </span>
                  <strong>
                    {user?.credits ?? "300"}
                    <small> / 300</small>
                  </strong>
                </div>
                <div className="credit-track">
                  <span
                    style={{
                      width: `${Math.min(100, (user?.credits ?? 300) / 3)}%`,
                    }}
                  />
                </div>
                <button onClick={() => setModal("plans")}>
                  {user ? "View plans" : "Start creating for free"}
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </aside>
          <div className="main-shell">
            <header className="topbar">
              <div className="breadcrumbs">
                <button
                  className="mobile-menu icon-button"
                  aria-label="Open navigation"
                  onClick={() => setMobile(true)}
                >
                  <Menu size={20} />
                </button>
                <span>Workspace</span>
                <ChevronRight size={13} />
                <strong>{pageName}</strong>
              </div>
              <div className="header-actions">
                <span className="local-status">
                  <span />
                  Local studio
                </span>
                <button
                  className="icon-button help-top"
                  aria-label="Help"
                  onClick={() => setModal("help")}
                >
                  <CircleHelp size={19} />
                </button>
                <span className="header-divider" />
                {user ? (
                  <button
                    className="profile-button"
                    onClick={() => navigate("settings")}
                    aria-label="Account settings"
                  >
                    {user.name?.[0]?.toUpperCase()}
                  </button>
                ) : (
                  <button
                    className="small-button"
                    onClick={() => setAuthMode("login")}
                  >
                    Sign in <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </header>
            <main className={`page ${route === "create" ? "create-page" : ""}`}>
              {route === "create" && (
                <>
                  <div className="page-intro">
                    <div>
                      <div className="eyebrow">
                        <span />
                        LET’S MAKE SOMETHING GREAT
                      </div>
                      <h1>
                        Your next story starts here<span>.</span>
                      </h1>
                      <p>
                        From a simple idea to a video worth watching. Make it
                        yours.
                      </p>
                    </div>
                    <button
                      className="button secondary tutorial-button"
                      onClick={() => setModal("tutorial")}
                    >
                      <Play size={15} />
                      Quick walkthrough
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="creation-steps">
                    <span className="current">
                      <b>1</b>Your story
                    </span>
                    <span className="step-line" />
                    <span>
                      <b>2</b>Make it yours
                    </span>
                    <span className="step-line" />
                    <span>
                      <b>3</b>Bring it to life
                    </span>
                    <div className="autosave">
                      <span />
                      Draft autosaved
                    </div>
                  </div>
                  <div className="create-grid">
                    <div className="create-form">
                      <section className="panel story-panel">
                        <SectionTitle number="01" title="Start with your story">
                          <span className="required-tag">THE GOOD PART</span>
                        </SectionTitle>
                        <p className="section-description">
                          You bring the idea. We’ll help you bring it to life.
                        </p>
                        <div className="input-tabs">
                          {[
                            ["script", FileText, "Paste a script"],
                            ["ai", Sparkles, "Write with AI"],
                            ["audio", Mic2, "Upload audio"],
                          ].map(([id, Icon, label]) => (
                            <button
                              key={id}
                              className={inputMode === id ? "selected" : ""}
                              onClick={() => {
                                setInputMode(id);
                                setError("");
                              }}
                            >
                              <Icon size={15} />
                              {label}
                            </button>
                          ))}
                        </div>
                        {inputMode === "ai" ? (
                          <div className="ai-input">
                            <label htmlFor="topic">
                              What’s your video about?
                            </label>
                            <textarea
                              id="topic"
                              value={topic}
                              onChange={(e) => setTopic(e.target.value)}
                              placeholder="e.g. Why the ocean is still Earth's greatest mystery"
                              maxLength={300}
                            />
                            <div className="info-note">
                              <Sparkles size={16} />
                              {health.scriptAI
                                ? "AI writes a first draft. You make it your own."
                                : "Local mode creates an editable starter. Connect an AI provider for original scripts."}
                            </div>
                            <button
                              className="button primary"
                              onClick={generateScript}
                              disabled={busy || topic.trim().length < 3}
                            >
                              {busy ? <Spinner /> : <WandSparkles size={17} />}{" "}
                              {health.scriptAI
                                ? "Write my script"
                                : "Create a starter draft"}
                            </button>
                          </div>
                        ) : (
                          <>
                            <label
                              className="field-label"
                              htmlFor="video-title"
                            >
                              Video title <span>optional</span>
                            </label>
                            <input
                              id="video-title"
                              className="title-input"
                              placeholder="Give your story a name…"
                              value={form.title}
                              onChange={(e) => update("title", e.target.value)}
                              maxLength={100}
                            />
                            {inputMode === "audio" && (
                              <label
                                className={`upload-zone ${form.audioId ? "uploaded" : ""}`}
                              >
                                <input
                                  type="file"
                                  accept=".mp3,.wav,.m4a,.ogg"
                                  onChange={(e) => uploadAudio(e, "narration")}
                                  disabled={busy}
                                />
                                <span className="upload-icon">
                                  {busy ? (
                                    <Spinner />
                                  ) : form.audioId ? (
                                    <Check size={24} />
                                  ) : (
                                    <Upload size={23} />
                                  )}
                                </span>
                                <strong>
                                  {form.audioId
                                    ? audioName
                                    : "Drop in your narration"}
                                </strong>
                                <span>
                                  {form.audioId
                                    ? `${duration(audioDuration)} · Ready to bring to life`
                                    : "Choose MP3, WAV, M4A, or OGG · up to 100 MB / 10 min"}
                                </span>
                              </label>
                            )}
                            <div className="script-area">
                              <textarea
                                id="script"
                                aria-label={
                                  inputMode === "audio"
                                    ? "Optional transcript for captions"
                                    : "Video script"
                                }
                                placeholder={
                                  inputMode === "audio"
                                    ? "Optional: paste a transcript to add approximate captions…"
                                    : "Every great video starts with a story.\n\nPaste your script here, or let your imagination take the lead…"
                                }
                                value={form.script}
                                onChange={(e) =>
                                  update("script", e.target.value)
                                }
                                maxLength={8000}
                                className={
                                  inputMode === "audio" ? "short-textarea" : ""
                                }
                              />
                              <div className="script-footer">
                                <span>
                                  {words.toLocaleString()} words <i />{" "}
                                  {form.script.length.toLocaleString()} / 8,000
                                  characters
                                </span>
                                <span>
                                  <Clock3 size={13} />
                                  {duration(seconds)} estimated
                                </span>
                              </div>
                            </div>
                            <div className="sample-row">
                              <span>
                                <Sparkles size={14} />
                                Need a starting point?
                              </span>
                              <button
                                onClick={() => {
                                  setForm((f) => ({
                                    ...f,
                                    title: "A different perspective",
                                    script: sample,
                                    background: "mountains",
                                  }));
                                  setInputMode("script");
                                }}
                              >
                                Try a sample script <ArrowRight size={13} />
                              </button>
                            </div>
                          </>
                        )}
                      </section>
                      <section className="panel">
                        <SectionTitle number="02" title="Find your voice">
                          <span className="soft-pill">
                            <Globe2 size={12} />
                            English
                          </span>
                        </SectionTitle>
                        <p className="section-description">
                          A voice that feels right for your story. Listen and
                          pick your favorite.
                        </p>
                        <div className="voice-grid">
                          {voices.map((v) => (
                            <div
                              className={`voice-card ${form.voice === v.id ? "selected" : ""}`}
                              key={v.id}
                            >
                              <button
                                className="voice-select"
                                onClick={() => update("voice", v.id)}
                                aria-label={`Select ${v.name}`}
                                aria-pressed={form.voice === v.id}
                              >
                                <span className={`voice-avatar ${v.color}`}>
                                  {v.initial}
                                  <AudioLines size={12} />
                                </span>
                                <span className="voice-details">
                                  <strong>{v.name}</strong>
                                  <small>{v.kind}</small>
                                </span>
                                <span
                                  className={`radio ${form.voice === v.id ? "checked" : ""}`}
                                />
                              </button>
                              <div className="voice-bottom">
                                <span>{v.description}</span>
                                <button
                                  aria-label={`Preview ${v.name}`}
                                  onClick={() => playVoice(v.id)}
                                >
                                  {previewVoice === v.id ? (
                                    <Pause size={12} />
                                  ) : (
                                    <Play size={12} fill="currentColor" />
                                  )}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="footnote">
                          <Headphones size={13} />
                          Local synthesized voices. Upload your own narration
                          for studio-quality speech.
                        </p>
                      </section>
                      <section className="panel">
                        <SectionTitle number="03" title="Set the scene" />
                        <p className="section-description">
                          Choose a visual world. You can change each scene in
                          the editor.
                        </p>
                        <div className="background-grid">
                          {backgrounds.map((b) => (
                            <button
                              key={b.id}
                              className={`background-option ${form.background === b.id ? "selected" : ""}`}
                              aria-pressed={form.background === b.id}
                              onClick={() => update("background", b.id)}
                            >
                              <div
                                className={`background-image ${b.id === "minimal" ? "minimal" : ""}`}
                                style={{
                                  backgroundImage: b.image
                                    ? `url(${b.image})`
                                    : undefined,
                                }}
                              >
                                {b.id === "minimal" && <Layers3 size={25} />}
                                <span className="background-check">
                                  <Check size={11} />
                                </span>
                                {b.id === "mountains" && (
                                  <span className="popular-label">POPULAR</span>
                                )}
                              </div>
                              <strong>{b.name}</strong>
                              <small>{b.tag}</small>
                            </button>
                          ))}
                        </div>
                        <div className="option-row aspect-row">
                          <div>
                            <Monitor size={19} />
                            <span>
                              <strong>The right frame</strong>
                              <small>Made for where your story goes next</small>
                            </span>
                          </div>
                          <div className="segmented">
                            <button
                              className={form.aspect === "16:9" ? "active" : ""}
                              onClick={() => update("aspect", "16:9")}
                            >
                              <span className="ratio-icon landscape" />
                              16:9
                            </button>
                            <button
                              className={form.aspect === "9:16" ? "active" : ""}
                              onClick={() => update("aspect", "9:16")}
                            >
                              <span className="ratio-icon portrait" />
                              9:16
                            </button>
                          </div>
                        </div>
                      </section>
                      <section className="panel finishing-panel">
                        <SectionTitle
                          number="04"
                          title="The finishing touches"
                        />
                        <p className="section-description">
                          Small details. A whole different feeling.
                        </p>
                        {[
                          [
                            Subtitles,
                            "captions",
                            "Scene captions",
                            "Readable captions, timed approximately to your narration",
                          ],
                          [
                            Sparkles,
                            "graphics",
                            "Title overlay",
                            "A polished opening title to introduce your story",
                          ],
                          [
                            Music2,
                            "music",
                            "Background sound",
                            "A gentle ambient soundbed, or your own music",
                          ],
                        ].map(([Icon, key, title, desc]) => (
                          <React.Fragment key={key}>
                            <div className="option-row">
                              <div>
                                <span className={`option-icon ${key}`}>
                                  <Icon size={18} />
                                </span>
                                <span>
                                  <strong>{title}</strong>
                                  <small>{desc}</small>
                                </span>
                              </div>
                              <Toggle
                                checked={form[key]}
                                label={title}
                                onChange={(v) => update(key, v)}
                              />
                            </div>
                            {key === "music" && form.music && (
                              <div className="music-options">
                                <label>
                                  Volume{" "}
                                  <input
                                    type="range"
                                    min="0"
                                    max="0.3"
                                    step="0.01"
                                    value={form.musicVolume}
                                    onChange={(e) =>
                                      update(
                                        "musicVolume",
                                        Number(e.target.value),
                                      )
                                    }
                                  />
                                  <span>
                                    {Math.round(form.musicVolume * 100)}%
                                  </span>
                                </label>
                                <label className="button secondary small upload-music">
                                  <Upload size={13} />
                                  {form.musicId
                                    ? "Replace music"
                                    : "Upload your own"}
                                  <input
                                    type="file"
                                    accept="audio/*"
                                    onChange={(e) => uploadAudio(e, "music")}
                                  />
                                </label>
                              </div>
                            )}
                          </React.Fragment>
                        ))}
                      </section>
                    </div>
                    <aside className="preview-column">
                      <div className="preview-sticky">
                        <section className="panel preview-panel">
                          <div className="preview-heading">
                            <span>
                              <Film size={14} />
                              THE BIG PICTURE
                            </span>
                            <span className="soft-pill">1080p HD</span>
                          </div>
                          <div
                            className={`video-preview ${form.aspect === "9:16" ? "portrait-preview" : ""}`}
                            style={{
                              backgroundImage: selectedBackground.image
                                ? `linear-gradient(0deg,rgba(8,17,35,.7),transparent 80%),url(${selectedBackground.image})`
                                : undefined,
                            }}
                          >
                            <span className="preview-tag">
                              <span />
                              STYLE PREVIEW
                            </span>
                            <div className="preview-story">
                              <span>A STORY BY YOU</span>
                              <strong>
                                {form.title || "Something\nextraordinary."}
                              </strong>
                              <div className="preview-line" />
                            </div>
                            <div className="preview-bottom">
                              <span>
                                {form.aspect} <i /> 1080p
                              </span>
                              <span>
                                <AudioLines size={13} /> {duration(seconds)}
                              </span>
                            </div>
                          </div>
                          <div className="preview-caption">
                            <span className="preview-caption-dot" />
                            <p>
                              Your idea. Your voice.
                              <br />
                              <strong>All the pieces, coming together.</strong>
                            </p>
                          </div>
                          <div className="summary-list">
                            <div>
                              <span>
                                <Mic2 size={15} />
                                Narration
                              </span>
                              <strong>
                                {inputMode === "audio" && form.audioId
                                  ? "Your own audio"
                                  : selectedVoice.name}
                                <small>
                                  {inputMode === "audio" && form.audioId
                                    ? ""
                                    : " · Local"}
                                </small>
                              </strong>
                            </div>
                            <div>
                              <span>
                                <Image size={15} />
                                Visual style
                              </span>
                              <strong>{selectedBackground.name}</strong>
                            </div>
                            <div>
                              <span>
                                <Subtitles size={15} />
                                Captions
                              </span>
                              <strong>
                                {form.captions ? "On" : "Off"}
                                <span
                                  className={`tiny-dot ${form.captions ? "green" : ""}`}
                                />
                              </strong>
                            </div>
                            <div>
                              <span>
                                <Music2 size={15} />
                                Background sound
                              </span>
                              <strong>
                                {form.music
                                  ? form.musicId
                                    ? "Your music"
                                    : "Ambient"
                                  : "Off"}
                              </strong>
                            </div>
                          </div>
                          <div className="estimate">
                            <div>
                              <span>Estimated length</span>
                              <strong>
                                {duration(seconds)} <small>min</small>
                              </strong>
                            </div>
                            <div>
                              <span>Generation cost</span>
                              <strong>
                                <Zap size={15} fill="currentColor" />
                                {cost} <small>credits</small>
                              </strong>
                            </div>
                          </div>
                        </section>
                        <div className="tip-card">
                          <span>
                            <Sparkles size={18} />
                          </span>
                          <div>
                            <strong>A little tip, a better video</strong>
                            <p>
                              Write the way you speak. Short sentences and a
                              strong opening make all the difference.
                            </p>
                          </div>
                        </div>
                        <div className="private-note">
                          <ShieldCheck size={14} />
                          Your drafts stay in your workspace.
                        </div>
                      </div>
                    </aside>
                  </div>
                  <div className="generate-bar">
                    <div className="generate-info">
                      <span className="generate-symbol">
                        <WandSparkles size={20} />
                      </span>
                      <div>
                        <strong>Ready when you are.</strong>
                        <span>
                          Your story is one click away from becoming a video.
                        </span>
                      </div>
                    </div>
                    <div className="generate-actions">
                      <button
                        className="button secondary save-draft"
                        disabled={busy}
                        onClick={() => create(false)}
                      >
                        Save draft
                      </button>
                      <div className="generate-cost">
                        <strong>
                          <Zap size={14} fill="currentColor" />
                          {cost} credits
                        </strong>
                        <small>1080p · MP4</small>
                      </div>
                      <button
                        className="button primary generate-button"
                        disabled={busy}
                        onClick={() => create(true)}
                      >
                        {busy ? <Spinner /> : <Sparkles size={17} />}Generate
                        video
                        <ArrowRight size={17} />
                      </button>
                    </div>
                  </div>
                  {error && (
                    <div className="floating-error" role="alert">
                      <CircleHelp size={17} />
                      {error}
                      <button
                        aria-label="Dismiss error"
                        onClick={() => setError("")}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </>
              )}
              {route === "projects" && (
                <Projects
                  projects={projects}
                  user={user}
                  signin={() => setAuthMode("signup")}
                  refresh={refresh}
                  notify={notify}
                  useTemplate={(b) => {
                    setForm({
                      ...initialForm,
                      title: b.title,
                      script: b.script,
                      background: b.background,
                    });
                    navigate("create");
                  }}
                />
              )}
              {route.startsWith("project/") && (
                <Editor
                  id={route.split("/")[1]}
                  user={user}
                  requireUser={requireUser}
                  refresh={refresh}
                  notify={notify}
                />
              )}
              {route === "scripts" && (
                <ScriptStudio
                  user={user}
                  requireUser={requireUser}
                  health={health}
                  notify={notify}
                  useScript={(s) => {
                    setForm((f) => ({
                      ...f,
                      title: s.title,
                      script: s.content,
                    }));
                    setInputMode("script");
                    navigate("create");
                  }}
                />
              )}
              {route === "thumbnails" && <ThumbnailStudio notify={notify} />}
              {route === "autopilot" && (
                <PublishStudio
                  user={user}
                  projects={projects}
                  requireUser={requireUser}
                  notify={notify}
                />
              )}
              {(route.startsWith("verify/") || route.startsWith("reset/")) && (
                <EmailAction
                  token={route.split("/")[1]}
                  reset={route.startsWith("reset/")}
                  refresh={refresh}
                  signin={() => {
                    navigate("settings");
                    setAuthMode("login");
                  }}
                />
              )}
              {route === "api" && (
                <ApiStudio
                  user={user}
                  requireUser={requireUser}
                  notify={notify}
                />
              )}
              {route === "history" && (
                <History user={user} signin={() => setAuthMode("login")} />
              )}
              {route === "settings" && (
                <Settings
                  user={user}
                  refresh={refresh}
                  signin={() => setAuthMode("login")}
                  notify={notify}
                  showPlans={() => setModal("plans")}
                  onSignedOut={() => {
                    setForm(initialForm);
                    setAudioName("");
                    setAudioDuration(0);
                    localStorage.removeItem("motion-draft");
                  }}
                />
              )}
              {![
                "create",
                "projects",
                "scripts",
                "thumbnails",
                "autopilot",
                "api",
                "history",
                "settings",
              ].includes(route) &&
                !route.startsWith("project/") &&
                !route.startsWith("verify/") &&
                !route.startsWith("reset/") && (
                  <EmptyState
                    icon={Film}
                    title="Let’s get you back to creating"
                    description="This page could not be found."
                    action="Open studio"
                    onClick={() => navigate("create")}
                  />
                )}
            </main>
            {route !== "create" && (
              <footer className="app-footer">
                <span>Made for your next great story.</span>
                <span>
                  GoMotion Studio <i /> Local edition
                </span>
              </footer>
            )}
          </div>
        </div>
      )}
      {authMode && (
        <Auth
          mode={authMode}
          setMode={setAuthMode}
          close={() => setAuthMode(null)}
          onSuccess={async (result) => {
            await refresh();
            setAuthMode(null);
            setEmailDelivery(result.delivery || null);
            notify("You’re in. Let’s make something great.");
          }}
        />
      )}
      {emailDelivery && (
        <Modal title="Check your inbox" close={() => setEmailDelivery(null)}>
          <p>{emailDelivery.message}</p>
          {emailDelivery.previewURL && (
            <a
              className="button primary"
              href={emailDelivery.previewURL}
              onClick={() => setEmailDelivery(null)}
            >
              Open development email preview
            </a>
          )}
        </Modal>
      )}
      {modal === "plans" && (
        <Modal
          title="Room for bigger stories."
          close={() => setModal(null)}
          wide
        >
          <PlanPicker
            user={user}
            close={() => setModal(null)}
            signin={() => setAuthMode("login")}
            notify={notify}
          />
        </Modal>
      )}
      {modal === "tutorial" && (
        <Modal title="Your idea → your next video" close={() => setModal(null)}>
          <div className="tutorial-cover">
            <div className="tutorial-play">
              <WandSparkles size={34} />
            </div>
            <strong>
              Big stories.
              <br />A simple process.
            </strong>
          </div>
          <div className="walkthrough">
            {[
              [
                "01",
                "Tell your story",
                "Paste a script, create a starter, or upload your narration.",
              ],
              [
                "02",
                "Make it feel like you",
                "Choose a voice, visual world, captions, and sound.",
              ],
              [
                "03",
                "Bring it to life",
                "Generate a real MP4, review every scene, edit, and download.",
              ],
            ].map(([n, t, d]) => (
              <div key={n}>
                <span>{n}</span>
                <div>
                  <strong>{t}</strong>
                  <p>{d}</p>
                </div>
              </div>
            ))}
          </div>
          <button
            className="button primary full"
            onClick={() => {
              setModal(null);
              navigate("create");
            }}
          >
            Let’s make a video
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="A little help goes a long way"
          close={() => setModal(null)}
        >
          <p className="modal-description">
            This local studio creates narrated videos using your script, curated
            image backgrounds, and FFmpeg.
          </p>
          <div className="help-items">
            <button onClick={() => setModal("tutorial")}>
              <BookOpen size={20} />
              <span>
                <strong>Your first video</strong>
                <small>A three-step walkthrough</small>
              </span>
              <ArrowRight size={17} />
            </button>
            <a
              href="https://ffmpeg.org/documentation.html"
              target="_blank"
              rel="noreferrer"
            >
              <Film size={20} />
              <span>
                <strong>Rendering documentation</strong>
                <small>About the open-source video engine</small>
              </span>
              <ArrowRight size={17} />
            </a>
            <button
              onClick={() => {
                setModal(null);
                navigate("api");
              }}
            >
              <Code2 size={20} />
              <span>
                <strong>Build your own workflow</strong>
                <small>API access and integration details</small>
              </span>
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="info-note">
            Local mode includes 300 test credits. Payments, email verification,
            and YouTube publishing require external services. No real charges
            are made.
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}

function Auth({ mode, setMode, close, onSuccess }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const signup = mode === "signup";
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(`/auth/${signup ? "signup" : "login"}`, {
        method: "POST",
        body: { email, password, name },
      });
      await onSuccess(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (mode === "forgot")
    return (
      <Modal title="Reset your password" close={close}>
        <ForgotPassword close={() => setMode("login")} />
      </Modal>
    );
  return (
    <Modal
      title={
        signup ? "Your next chapter starts here." : "Welcome back, storyteller."
      }
      close={close}
    >
      <div className="auth-mark">
        <Logo />
      </div>
      <p className="modal-description">
        {signup
          ? "Create your local workspace. Bring your first story to life with 300 test credits."
          : "Your stories are right where you left them."}
      </p>
      <form className="auth-form" onSubmit={submit}>
        {signup && (
          <label>
            Your name
            <input
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What should we call you?"
              maxLength={80}
            />
          </label>
        )}
        <label>
          Email address
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            maxLength={254}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete={signup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </label>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? <Spinner /> : null}
          {signup ? "Create my workspace" : "Log in"}
          <ArrowRight size={17} />
        </button>
      </form>
      {!signup && (
        <button className="text-button" onClick={() => setMode("forgot")}>
          Forgot your password?
        </button>
      )}
      <p className="auth-switch">
        {signup ? "Already part of the story?" : "New around here?"}{" "}
        <button
          onClick={() => {
            setMode(signup ? "login" : "signup");
            setError("");
          }}
        >
          {signup ? "Log in" : "Create an account"}
        </button>
      </p>
      <p className="footnote center">
        Passwords are hashed securely. Recovery links are single-use and expire
        after one hour.
      </p>
    </Modal>
  );
}
function EmptyState({ icon: Icon, title, description, action, onClick }) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={32} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && (
        <button className="button primary" onClick={onClick}>
          {action}
          <ArrowRight size={17} />
        </button>
      )}
    </div>
  );
}
function PageIntro({ eyebrow, title, description, children }) {
  return (
    <div className="page-intro">
      <div>
        <div className="eyebrow">
          <span />
          {eyebrow || "YOUR CREATIVE WORKSPACE"}
        </div>
        <h1>
          {title}
          <span>.</span>
        </h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
const templates = [
  {
    title: "A different perspective",
    label: "TRAVEL & DISCOVERY",
    background: "mountains",
    script: sample,
  },
  {
    title: "Beneath the surface",
    label: "NATURE & SCIENCE",
    background: "ocean",
    script:
      "Look out at the ocean. Beneath the waves is a world that still holds countless mysteries. Sunlight fades as the water deepens, and familiar landscapes give way to the unexpected. Each new discovery reminds us how much there is left to learn. The next great adventure might be closer than we think, just below the surface.",
  },
  {
    title: "A moment of quiet",
    label: "MINDFULNESS",
    background: "forest",
    script:
      "Take a breath. Let the noise of the day fall away for a moment. Among the trees, there is no rush to be anywhere else. Notice the light moving through the leaves. Listen to the world around you. A small moment of quiet can change the way the whole day feels.",
  },
];
function Projects({ projects, user, signin, refresh, notify, useTemplate }) {
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [deleting, setDeleting] = useState(null);
  const visible = projects.filter(
    (p) =>
      (filter === "all" ||
        (filter === "ready"
          ? p.status === "succeeded"
          : p.status === "draft")) &&
      p.title.toLowerCase().includes(search.toLowerCase()),
  );
  async function remove(p) {
    try {
      await api(`/projects/${p.id}`, { method: "DELETE" });
      await refresh();
      notify("Project deleted.");
      setDeleting(null);
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <>
      <PageIntro
        title="A home for your stories"
        description="Your ideas, works in progress, and next big things — all in one place."
      >
        <button className="button primary" onClick={() => navigate("create")}>
          <Plus size={18} />
          New video
        </button>
      </PageIntro>
      <div className="library-toolbar">
        <div className="filter-tabs">
          {[
            ["all", "All videos"],
            ["ready", "Ready to watch"],
            ["draft", "Drafts"],
          ].map(([id, name]) => (
            <button
              className={filter === id ? "active" : ""}
              key={id}
              onClick={() => setFilter(id)}
            >
              {name}
              {id === "all" && <span>{projects.length}</span>}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            placeholder="Find a story…"
            aria-label="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {!user ? (
        <EmptyState
          icon={FolderOpen}
          title="Your stories deserve a home"
          description="Create a workspace to save, edit, and return to your videos."
          action="Create my workspace"
          onClick={signin}
        />
      ) : visible.length ? (
        <div className="project-grid">
          {visible.map((p) => (
            <article className="project-card" key={p.id}>
              <button
                className="project-cover"
                onClick={() => navigate(`project/${p.id}`)}
                style={{
                  backgroundImage: `url(${p.poster ? `/api/projects/${p.id}/poster?v=${p.updated}` : backgrounds.find((b) => b.id === p.background)?.image})`,
                }}
              >
                <span className={`status-badge ${p.status}`}>
                  <span />
                  {
                    {
                      draft: "Draft",
                      queued: "Queued",
                      running: "Creating",
                      succeeded: "Ready",
                      failed: "Needs attention",
                      cancelled: "Cancelled",
                    }[p.status]
                  }
                </span>
                <span className="project-play">
                  <Play size={21} fill="currentColor" />
                </span>
                <span className="project-time">
                  {duration(p.duration || p.script.split(/\s+/).length / 2.25)}
                </span>
                {["running", "queued"].includes(p.status) && (
                  <span className="project-progress">
                    <span style={{ width: `${p.progress}%` }} />
                  </span>
                )}
              </button>
              <div className="project-details">
                <button
                  className="text-button"
                  onClick={() => navigate(`project/${p.id}`)}
                >
                  <h3>{p.title}</h3>
                </button>
                <div>
                  <span>
                    {new Date(p.created).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    <i /> {p.aspect}
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${p.title}`}
                    onClick={() => setDeleting(p)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Film}
          title={
            search || filter !== "all"
              ? "No stories here yet"
              : "Your first great story is waiting"
          }
          description={
            search
              ? "Try a different title."
              : "Turn an idea into something worth watching."
          }
          action="Create a video"
          onClick={() => navigate("create")}
        />
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">A SPARK TO GET YOU STARTED</span>
          <h2>Some stories are waiting to be told.</h2>
        </div>
        <span className="subtle">Start with a template. Make it your own.</span>
      </div>
      <div className="template-grid">
        {templates.map((t) => (
          <button
            className="template-card"
            key={t.title}
            onClick={() => useTemplate(t)}
            style={{
              backgroundImage: `linear-gradient(0deg,rgba(4,13,27,.85),transparent),url(${backgrounds.find((b) => b.id === t.background).image})`,
            }}
          >
            <span className="template-label">{t.label}</span>
            <div>
              <h3>{t.title}</h3>
              <span>
                Make this story yours <ArrowRight size={16} />
              </span>
            </div>
          </button>
        ))}
      </div>
      {deleting && (
        <Modal title="Delete this story?" close={() => setDeleting(null)}>
          <p className="modal-description">
            “{deleting.title}” will be removed from your workspace. This cannot
            be undone.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setDeleting(null)}
            >
              Keep it
            </button>
            <button className="button danger" onClick={() => remove(deleting)}>
              Delete project
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Editor({ id, user, requireUser, refresh, notify }) {
  const [p, setP] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [scene, setScene] = useState(0),
    [replace, setReplace] = useState(false);
  const player = useRef(null);
  useEffect(() => {
    if (!user) return;
    setP(null);
    setDirty(false);
    api(`/projects/${id}`)
      .then(setP)
      .catch((e) => setError(e.message));
  }, [id, user?.id]);
  useEffect(() => {
    if (!p || !["running", "queued"].includes(p.status)) return;
    const timer = setInterval(
      () =>
        api(`/projects/${id}`)
          .then(setP)
          .catch((e) => setError(e.message)),
      1400,
    );
    return () => clearInterval(timer);
  }, [p?.status, id]);
  function edit(key, value) {
    setP((v) => ({ ...v, [key]: value }));
    setDirty(true);
  }
  async function saveChanges() {
    const result = await api(`/projects/${id}`, { method: "PATCH", body: p });
    setP(result);
    setDirty(false);
    return result;
  }
  async function action(render) {
    setBusy(true);
    setError("");
    try {
      if (dirty) await saveChanges();
      if (render) {
        const v = await api(`/projects/${id}/render`, {
          method: "POST",
          body: {},
        });
        setP(v);
      } else notify("Your changes are saved.");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    try {
      setP(await api(`/projects/${id}/cancel`, { method: "POST", body: {} }));
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  if (!user)
    return (
      <EmptyState
        icon={Film}
        title="Your story is waiting"
        description="Sign in to open this project."
        action="Sign in"
        onClick={requireUser}
      />
    );
  if (!p)
    return error ? (
      <EmptyState
        icon={CircleHelp}
        title="We couldn’t open this story"
        description={error}
        action="My projects"
        onClick={() => navigate("projects")}
      />
    ) : (
      <div className="loading-state">
        <Spinner />
        Opening your story…
      </div>
    );
  const running = ["queued", "running"].includes(p.status);
  const selected = p.scenes[scene] || p.scenes[0];
  return (
    <>
      <div className="editor-top">
        <div>
          <button className="back-link" onClick={() => navigate("projects")}>
            <ArrowLeft size={14} />
            My projects
          </button>
          <input
            aria-label="Project title"
            className="editor-title"
            value={p.title}
            maxLength={100}
            onChange={(e) => edit("title", e.target.value)}
            disabled={running}
          />
          <div className="editor-meta">
            <span className={`status-badge ${p.status}`}>
              {p.status === "succeeded" ? "Ready to watch" : p.status}
            </span>
            <span>
              {p.aspect} <i /> 1080p <i />{" "}
              {duration(p.duration || p.script.split(/\s+/).length / 2.25)}
            </span>
            {dirty && <span className="unsaved">Unsaved changes</span>}
          </div>
        </div>
        <div className="editor-buttons">
          <button
            className="button secondary"
            onClick={() => action(false)}
            disabled={busy || running || !dirty}
          >
            {busy ? <Spinner /> : <Check size={16} />}Save
          </button>
          {p.file && !dirty && !p.dirty && !running ? (
            <a
              className="button primary"
              href={`/api/projects/${p.id}/download`}
            >
              <ArrowDownToLine size={16} />
              Download MP4
            </a>
          ) : (
            <button
              className="button primary"
              disabled={busy || running}
              onClick={() => action(true)}
            >
              {busy ? <Spinner /> : <Sparkles size={16} />}{" "}
              {p.file ? "Update export · 4 credits" : "Generate video"}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {p.status === "failed" && (
        <div className="error-message" role="alert">
          {p.error}
        </div>
      )}
      {running ? (
        <div className="render-progress-card">
          <div className="render-orbit">
            <Film size={40} />
            <span />
            <span />
          </div>
          <span className="eyebrow">A LITTLE MAGIC IN THE MAKING</span>
          <h2>Your story is coming to life.</h2>
          <p>{p.stage}</p>
          <div className="render-track">
            <span style={{ width: `${p.progress}%` }} />
          </div>
          <div className="render-progress-label">
            <span>
              {p.status === "queued"
                ? "Your place in the queue is saved"
                : "Rendering your actual video"}
            </span>
            <strong>{p.progress}%</strong>
          </div>
          <div className="render-stages">
            {["Narration", "Scenes", "Captions & sound", "Final touches"].map(
              (s, i) => (
                <span
                  key={s}
                  className={p.progress >= [8, 15, 82, 98][i] ? "done" : ""}
                >
                  {p.progress >= [15, 82, 98, 100][i] ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <span className="stage-dot" />
                  )}
                  {s}
                </span>
              ),
            )}
          </div>
          <button className="text-button cancel-render" onClick={cancel}>
            Cancel generation & return credits
          </button>
          <p className="footnote center">
            You can leave this page. Your project will keep rendering.
          </p>
        </div>
      ) : (
        <div className="editor-grid">
          <div>
            <div
              className={`editor-player ${p.aspect === "9:16" ? "vertical" : ""}`}
            >
              {p.file ? (
                <video
                  ref={player}
                  key={p.file}
                  controls
                  playsInline
                  preload="metadata"
                  poster={`/api/projects/${p.id}/poster?v=${p.updated}`}
                  src={`/api/projects/${p.id}/video?v=${p.file}`}
                />
              ) : (
                <div
                  className="draft-preview"
                  style={{
                    backgroundImage: `linear-gradient(0deg,rgba(4,12,26,.7),transparent),url(${backgrounds.find((b) => b.id === (selected?.background || p.background))?.image})`,
                  }}
                >
                  <span>DRAFT PREVIEW</span>
                  <h2>{p.title}</h2>
                  <button
                    className="button white"
                    onClick={() => action(true)}
                    disabled={busy}
                  >
                    <Sparkles size={17} />
                    Bring it to life
                  </button>
                </div>
              )}
            </div>
            {p.file && (dirty || p.dirty) && (
              <div className="info-note">
                <CircleHelp size={16} />
                The preview shows your last render. Save and update your export
                to see edits.
              </div>
            )}
            <section className="panel scene-panel">
              <div className="section-title">
                <h2>Your story, scene by scene</h2>
                <span className="soft-pill">{p.scenes.length} scenes</span>
              </div>
              <p className="section-description">
                Select a scene to edit its narration or change its visual.
              </p>
              <div className="scene-timeline">
                {p.scenes.map((s, i) => (
                  <button
                    key={i}
                    className={`scene-tile ${scene === i ? "selected" : ""}`}
                    onClick={() => {
                      setScene(i);
                      if (player.current && s.start)
                        player.current.currentTime = s.start;
                    }}
                  >
                    <div
                      style={{
                        backgroundImage: `url(${backgrounds.find((b) => b.id === s.background)?.image})`,
                      }}
                    >
                      <span>{String(i + 1).padStart(2, "0")}</span>
                    </div>
                    <small>
                      {duration(s.start)} — {duration(s.end)}
                    </small>
                  </button>
                ))}
              </div>
              <div className="selected-scene">
                <div>
                  <strong>Scene {scene + 1}</strong>
                  <button
                    className="button secondary small"
                    onClick={() => setReplace(true)}
                  >
                    <Image size={14} />
                    Replace visual
                  </button>
                </div>
                <textarea
                  aria-label="Scene narration"
                  value={selected?.text || ""}
                  maxLength={1200}
                  onChange={(e) =>
                    edit(
                      "scenes",
                      p.scenes.map((s, i) =>
                        i === scene ? { ...s, text: e.target.value } : s,
                      ),
                    )
                  }
                />
                <p className="footnote">
                  {p.audioId
                    ? "Your uploaded audio stays unchanged. Text adjusts approximate captions."
                    : "Changes update the narration in your next export."}
                </p>
              </div>
            </section>
          </div>
          <aside className="panel editor-settings">
            <h2>Make it yours</h2>
            <p className="section-description">
              One last pass. A few small details.
            </p>
            <label>
              Narrator
              <select
                value={p.voice}
                disabled={!!p.audioId}
                onChange={(e) => edit("voice", e.target.value)}
              >
                {voices.map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.name} · {v.kind}
                  </option>
                ))}
              </select>
            </label>
            {[
              [Subtitles, "captions", "Scene captions"],
              [Sparkles, "graphics", "Title overlay"],
              [Music2, "music", "Background sound"],
            ].map(([Icon, key, label]) => (
              <div className="editor-option" key={key}>
                <span>
                  <Icon size={17} />
                  {label}
                </span>
                <Toggle
                  checked={p[key]}
                  label={label}
                  onChange={(v) => edit(key, v)}
                />
              </div>
            ))}
            {p.music && (
              <label>
                Background volume{" "}
                <input
                  type="range"
                  min="0"
                  max="0.3"
                  step="0.01"
                  value={p.musicVolume}
                  onChange={(e) => edit("musicVolume", Number(e.target.value))}
                />
              </label>
            )}
            <label>
              Video format
              <select
                value={p.aspect}
                onChange={(e) => edit("aspect", e.target.value)}
              >
                <option>16:9</option>
                <option>9:16</option>
              </select>
            </label>
            <div className="export-details">
              <strong>
                <ShieldCheck size={15} />
                Export details
              </strong>
              <div>
                <span>Resolution</span>
                <b>1080p HD</b>
              </div>
              <div>
                <span>File format</span>
                <b>MP4 · H.264</b>
              </div>
              <div>
                <span>Renders</span>
                <b>{p.exports || 0}</b>
              </div>
              <a href={`/api/projects/${p.id}/manifest`}>
                <ArrowDownToLine size={14} />
                Download project manifest
              </a>
            </div>
            {p.file && (
              <div className="publish-note">
                <Youtube size={21} />
                <strong>Next stop: your audience.</strong>
                <p>
                  Upload this export to your channel or schedule its release.
                </p>
                <a href="#autopilot">
                  Publish & schedule <ArrowRight size={14} />
                </a>
              </div>
            )}
          </aside>
        </div>
      )}
      {replace && (
        <Modal
          title={`A new world for scene ${scene + 1}`}
          close={() => setReplace(false)}
        >
          <p className="modal-description">
            Your narration stays in place. Give this scene a different feeling.
          </p>
          <div className="background-grid modal-backgrounds">
            {backgrounds.map((b) => (
              <button
                key={b.id}
                className={`background-option ${selected?.background === b.id ? "selected" : ""}`}
                onClick={() => {
                  edit(
                    "scenes",
                    p.scenes.map((s, i) =>
                      i === scene ? { ...s, background: b.id } : s,
                    ),
                  );
                  setReplace(false);
                }}
              >
                <div
                  className="background-image"
                  style={{ backgroundImage: `url(${b.image})` }}
                />
                <strong>{b.name}</strong>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function ScriptStudio({ user, requireUser, health, notify, useScript }) {
  const [scripts, setScripts] = useState([]),
    [topic, setTopic] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [active, setActive] = useState(null);
  useEffect(() => {
    if (user)
      api("/scripts")
        .then(setScripts)
        .catch((e) => setError(e.message));
  }, [user?.id]);
  async function generate(e) {
    e.preventDefault();
    if (!requireUser()) return;
    setBusy(true);
    setError("");
    try {
      const s = await api("/scripts", { method: "POST", body: { topic } });
      setScripts((all) => [s, ...all]);
      setActive(s);
      notify(
        s.source === "ai"
          ? "Your script is ready."
          : "Starter draft ready — personalize and fact-check it.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageIntro
        eyebrow="FROM A SPARK TO A STORY"
        title="Good videos start with good words"
        description="Find the opening line. Build the story. Make them want to keep watching."
      />
      <div className="tool-grid">
        <section className="panel tool-form">
          <div className="tool-icon">
            <FileText size={26} />
          </div>
          <h2>What are we talking about?</h2>
          <p className="section-description">
            A topic, a question, an idea you can’t stop thinking about.
          </p>
          <form onSubmit={generate}>
            <label className="field-label" htmlFor="script-topic">
              Your video idea
            </label>
            <textarea
              id="script-topic"
              placeholder="e.g. The quiet beauty of getting lost in nature"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={300}
              required
              minLength={3}
            />
            <div className="info-note">
              <Sparkles size={16} />
              {health.scriptAI
                ? "An AI provider is connected. Your draft is generated from your idea."
                : "Starter mode is active. Add a server-side OpenRouter key for AI-written scripts."}
            </div>
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? <Spinner /> : <WandSparkles size={17} />}{" "}
              {health.scriptAI ? "Write my script" : "Create a starter draft"}
            </button>
          </form>
          <div className="writing-tip">
            <strong>Think like a storyteller.</strong>
            <p>
              Start with a question. Add a little curiosity. End with something
              worth remembering.
            </p>
          </div>
        </section>
        <section className="panel script-result">
          {active ? (
            <>
              <div className="section-title">
                <h2>{active.title}</h2>
                <button
                  className="icon-button"
                  aria-label="Copy script"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(active.content)
                      .then(() => notify("Script copied."))
                      .catch(() => notify("Copy unavailable in this browser."))
                  }
                >
                  <Copy size={17} />
                </button>
              </div>
              <textarea
                aria-label="Edit script draft"
                value={active.content}
                onChange={(e) =>
                  setActive({ ...active, content: e.target.value })
                }
              />
              <div className="result-footer">
                <span>{active.content.split(/\s+/).length} words</span>
                <button
                  className="button primary"
                  onClick={() => useScript(active)}
                >
                  Make this a video
                  <ArrowRight size={17} />
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="The blank page is just the beginning"
              description="Give us an idea. Your next story starts right here."
            />
          )}
        </section>
      </div>
      {scripts.length > 0 && (
        <>
          <div className="section-heading">
            <h2>Ideas worth coming back to</h2>
            <span className="subtle">Your saved first drafts</span>
          </div>
          <div className="saved-scripts">
            {scripts.map((s) => (
              <button
                className="panel saved-script"
                key={s.id}
                onClick={() => setActive(s)}
              >
                <span>
                  <FileText size={19} />
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.content.slice(0, 110)}…</p>
                </div>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function ThumbnailStudio({ notify }) {
  const [title, setTitle] = useState("A DIFFERENT\nPERSPECTIVE"),
    [bg, setBg] = useState("mountains"),
    [color, setColor] = useState("#ffffff"),
    [busy, setBusy] = useState(false);
  const canvas = useRef(null);
  useEffect(() => {
    const c = canvas.current,
      ctx = c.getContext("2d"),
      image = new window.Image();
    let cancelled = false;
    image.onload = () => {
      if (cancelled) return;
      const scale = Math.max(c.width / image.width, c.height / image.height);
      ctx.drawImage(
        image,
        (c.width - image.width * scale) / 2,
        (c.height - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
      const g = ctx.createLinearGradient(0, 0, 0, 720);
      g.addColorStop(0, "rgba(5,10,24,.1)");
      g.addColorStop(1, "rgba(5,10,24,.8)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1280, 720);
      ctx.font = "800 88px Arial";
      ctx.fillStyle = color;
      ctx.shadowColor = "#00000080";
      ctx.shadowBlur = 18;
      const lines = [];
      for (const paragraph of title.split("\n")) {
        let line = "";
        for (const word of paragraph.split(" ")) {
          if (ctx.measureText(line + " " + word).width > 1080) {
            lines.push(line);
            line = word;
          } else line += (line ? " " : "") + word;
        }
        lines.push(line);
      }
      lines
        .slice(0, 5)
        .forEach((line, i) =>
          ctx.fillText(
            line,
            80,
            535 - (Math.min(lines.length, 5) - 1) * 98 + i * 98,
          ),
        );
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      ctx.font = "500 20px Arial";
      ctx.fillText("A STORY WORTH WATCHING", 85, 625);
    };
    image.src = backgrounds.find((b) => b.id === bg).image;
    return () => {
      cancelled = true;
    };
  }, [title, bg, color]);
  function download() {
    setBusy(true);
    canvas.current.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = "my-story-thumbnail.png";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        notify("Thumbnail downloaded.");
      }
      setBusy(false);
    }, "image/png");
  }
  return (
    <>
      <PageIntro
        eyebrow="MAKE THE FIRST IMPRESSION COUNT"
        title="Give your story a cover"
        description="A compelling frame. A few good words. A reason to press play."
      />
      <div className="thumbnail-layout">
        <section className="panel">
          <div className="tool-icon">
            <Image size={26} />
          </div>
          <h2>Make them curious.</h2>
          <label className="field-label" htmlFor="thumbnail-title">
            Headline
          </label>
          <textarea
            id="thumbnail-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
          />
          <label className="field-label">Your backdrop</label>
          <div className="thumbnail-bgs">
            {backgrounds
              .filter((b) => b.image)
              .map((b) => (
                <button
                  key={b.id}
                  aria-label={b.name}
                  aria-pressed={bg === b.id}
                  className={bg === b.id ? "selected" : ""}
                  onClick={() => setBg(b.id)}
                  style={{ backgroundImage: `url(${b.image})` }}
                >
                  {bg === b.id && <Check size={16} />}
                </button>
              ))}
          </div>
          <label className="color-label">
            Headline color
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <button
            className="button primary full"
            onClick={download}
            disabled={busy}
          >
            {busy ? <Spinner /> : <ArrowDownToLine size={17} />}Download
            thumbnail
          </button>
          <p className="footnote center">
            1280 × 720 PNG · Rendered in your browser
          </p>
        </section>
        <div className="thumbnail-preview">
          <div className="canvas-shell">
            <canvas ref={canvas} width="1280" height="720" />
          </div>
          <div className="thumbnail-meta">
            <span>
              <Monitor size={15} />
              YouTube-ready · 16:9
            </span>
            <span>100% yours to customize</span>
          </div>
          <div className="tip-card">
            <Sparkles size={20} />
            <div>
              <strong>Less text. More curiosity.</strong>
              <p>
                A short, intriguing headline is easier to read on every screen.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
function ApiStudio({ user, requireUser, notify }) {
  const [keys, setKeys] = useState([]),
    [newKey, setNewKey] = useState(""),
    [busy, setBusy] = useState(false),
    [label, setLabel] = useState("My workflow");
  useEffect(() => {
    if (user)
      api("/keys")
        .then(setKeys)
        .catch((e) => notify(e.message));
  }, [user?.id]);
  async function add() {
    if (!requireUser()) return;
    setBusy(true);
    try {
      const k = await api("/keys", { method: "POST", body: { label } });
      setNewKey(k.key);
      setKeys(await api("/keys"));
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id) {
    try {
      await api(`/keys/${id}`, { method: "DELETE" });
      setKeys(await api("/keys"));
      setNewKey("");
      notify("API key revoked.");
    } catch (e) {
      notify(e.message);
    }
  }
  const example = `curl "${window.location.origin}/api/projects" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"A new perspective",\n       "script":"Your story starts with a single idea.",\n       "background":"mountains"}'`;
  return (
    <>
      <PageIntro
        eyebrow="MAKE THE STUDIO PART OF YOUR FLOW"
        title="Your ideas. Your workflow"
        description="Create projects, start renders, and collect the results from your own tools."
      />
      <div className="tool-grid">
        <section className="panel">
          <div className="tool-icon">
            <Code2 size={26} />
          </div>
          <h2>A key to your workspace</h2>
          <p className="section-description">
            Keys can access your projects and generation credits. Keep them
            private.
          </p>
          <label className="field-label" htmlFor="key-label">
            Key name
          </label>
          <input
            id="key-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
          />
          <button className="button primary" onClick={add} disabled={busy}>
            {busy ? <Spinner /> : <Plus size={17} />}Create API key
          </button>
          {newKey && (
            <div className="key-reveal">
              <strong>Copy this key now. It is shown only once.</strong>
              <code>{newKey}</code>
              <button
                className="button secondary small"
                onClick={() =>
                  navigator.clipboard
                    .writeText(newKey)
                    .then(() => notify("API key copied."))
                    .catch(() => notify("Select and copy the key manually."))
                }
              >
                <Copy size={14} />
                Copy key
              </button>
            </div>
          )}
          <div className="key-list">
            {keys.map((k) => (
              <div key={k.id}>
                <span>
                  <strong>{k.label}</strong>
                  <small>
                    Created {new Date(k.created).toLocaleDateString()}
                  </small>
                </span>
                <button
                  className="icon-button"
                  aria-label={`Revoke ${k.label}`}
                  onClick={() => revoke(k.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
        <section className="panel api-example">
          <span className="soft-pill">
            <span className="tiny-dot green" />
            REST API · Available locally
          </span>
          <h2>From idea to API call.</h2>
          <pre>{example}</pre>
          <div className="endpoint-list">
            {[
              ["POST", "/api/projects", "Create a project"],
              ["POST", "/api/projects/:id/render", "Queue a real render"],
              ["GET", "/api/projects/:id", "Poll status and progress"],
              [
                "GET",
                "/api/projects/:id/download",
                "Download the finished MP4",
              ],
              ["POST", "/api/projects/:id/cancel", "Cancel and return credits"],
            ].map(([m, r, d]) => (
              <div key={r}>
                <span>{m}</span>
                <code>{r}</code>
                <small>{d}</small>
              </div>
            ))}
          </div>
          <p className="footnote">
            MCP is available at <code>{window.location.origin}/api/mcp</code>{" "}
            using stateless Streamable HTTP and the same bearer API key. It
            supports project creation, rendering, status, cancellation, exports,
            and credit history.
          </p>
        </section>
      </div>
      {user && <IntegrationStatus notify={notify} />}
    </>
  );
}
function History({ user, signin }) {
  const [items, setItems] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (user)
      api("/history")
        .then(setItems)
        .catch((e) => setError(e.message));
  }, [user?.credits, user?.id]);
  return (
    <>
      <PageIntro
        title="Every story, accounted for"
        description="A clear view of what you’ve created and the credits that made it happen."
      />
      {!user ? (
        <EmptyState
          icon={CreditCard}
          title="Your workspace, at a glance"
          description="Log in to see your balance and generation history."
          action="Log in"
          onClick={signin}
        />
      ) : (
        <>
          <div className="stat-grid">
            <div className="panel stat">
              <span className="stat-icon">
                <Zap size={23} />
              </span>
              <div>
                <span>Available credits</span>
                <strong>{user.credits}</strong>
              </div>
            </div>
            <div className="panel stat">
              <span className="stat-icon green">
                <Film size={23} />
              </span>
              <div>
                <span>Generation credits used</span>
                <strong>
                  {
                    -items
                      .filter((i) => i.amount < 0)
                      .reduce((s, i) => s + i.amount, 0)
                  }
                </strong>
              </div>
            </div>
            <div className="panel stat">
              <span className="stat-icon purple">
                <ShieldCheck size={23} />
              </span>
              <div>
                <span>Real charges made</span>
                <PaymentSummary user={user} />
              </div>
            </div>
          </div>
          {error && <div className="error-message">{error}</div>}
          <section className="panel history-panel">
            <div className="section-title">
              <h2>Your activity</h2>
              <span className="soft-pill">{items.length} transactions</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th>Date</th>
                    <th>Credits</th>
                    <th>Project</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span
                          className={`ledger-icon ${item.amount > 0 ? "positive" : ""}`}
                        >
                          {item.amount > 0 ? (
                            <Plus size={14} />
                          ) : (
                            <Film size={14} />
                          )}
                        </span>
                        {item.label}
                      </td>
                      <td>
                        {new Date(item.created).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className={item.amount > 0 ? "positive-text" : ""}>
                        {item.amount > 0 ? "+" : ""}
                        {item.amount}
                      </td>
                      <td>
                        {item.project_id ? (
                          <button
                            className="text-button blue-text"
                            onClick={() =>
                              navigate(`project/${item.project_id}`)
                            }
                          >
                            Open project <ArrowRight size={12} />
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <p className="footnote">
            Starter credits are free. Subscription allowances appear only after
            a signed Stripe paid-invoice event. Payment receipts are available
            in Account settings.
          </p>
        </>
      )}
    </>
  );
}
function Settings({ user, refresh, signin, notify, showPlans, onSignedOut }) {
  const [name, setName] = useState(user?.name || ""),
    [busy, setBusy] = useState(false);
  useEffect(() => setName(user?.name || ""), [user?.name]);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/me", { method: "PATCH", body: { name } });
      await refresh();
      notify("Profile updated.");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", body: {} });
      onSignedOut();
      await refresh();
      navigate("create");
      notify("You’re signed out. See you for the next story.");
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <>
      <PageIntro
        title="A space that feels like you"
        description="The small details that make this workspace yours."
      />
      {!user ? (
        <EmptyState
          icon={Settings2}
          title="Make yourself at home"
          description="Sign in to manage your local profile."
          action="Log in"
          onClick={signin}
        />
      ) : (
        <div className="settings-grid">
          <section className="panel">
            <h2>Your profile</h2>
            <form className="auth-form" onSubmit={save}>
              <label>
                Display name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={80}
                />
              </label>
              <label>
                Email address
                <input value={user.email} disabled />
              </label>
              <button className="button primary" disabled={busy}>
                {busy ? <Spinner /> : <Check size={16} />}Save changes
              </button>
            </form>
          </section>
          <BillingPanel user={user} showPlans={showPlans} notify={notify} />
          <AccountSecurity user={user} refresh={refresh} notify={notify} />
          <section className="panel signout-panel">
            <div>
              <h2>Until the next story.</h2>
              <p>Sign out of this browser. Your saved projects will be here.</p>
            </div>
            <button className="button secondary" onClick={logout}>
              <LogOut size={16} />
              Sign out
            </button>
          </section>
        </div>
      )}
    </>
  );
}
function Landing({ enter, signup }) {
  return (
    <div className="landing">
      <nav>
        <Logo />
        <div>
          <a
            href="#how-it-works"
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById("how-it-works")
                .scrollIntoView({ behavior: "smooth" });
            }}
          >
            How it works
          </a>
          <a href="#/create">Open studio</a>
          <button className="button primary small" onClick={signup}>
            Start your story
            <ArrowRight size={15} />
          </button>
        </div>
      </nav>
      <main>
        <span className="landing-pill">
          <Sparkles size={14} />A little idea. A whole new story.
        </span>
        <h1>
          One idea.
          <br />
          <span>So many possibilities.</span>
        </h1>
        <p>
          You have a story to tell. Bring it to life with narration, beautiful
          visuals, captions, and a little motion.
        </p>
        <button className="button primary landing-cta" onClick={enter}>
          Make my first video
          <Sparkles size={19} />
        </button>
        <span className="landing-note">
          300 local test credits <i /> No payment required
        </span>
        <div className="landing-collage">
          {templates.map((t, i) => (
            <div
              className={`collage-card collage-${i}`}
              key={t.title}
              style={{
                backgroundImage: `linear-gradient(0deg,rgba(4,12,26,.75),transparent),url(${backgrounds.find((b) => b.id === t.background).image})`,
              }}
            >
              <span>{t.label}</span>
              <strong>{t.title}</strong>
              <button onClick={enter} aria-label={`Create ${t.title}`}>
                <Play size={20} fill="currentColor" />
              </button>
            </div>
          ))}
        </div>
        <section id="how-it-works" className="landing-how">
          <span className="eyebrow">LESS FRICTION. MORE CREATION.</span>
          <h2>It starts with you.</h2>
          <div>
            {[
              [
                FileText,
                "Tell your story",
                "Paste a script, start from an idea, or upload your own narration.",
              ],
              [
                WandSparkles,
                "Make it yours",
                "Find the right voice, the right visual world, the right feeling.",
              ],
              [
                Film,
                "Bring it to life",
                "Generate, refine, and download a real, ready-to-share MP4.",
              ],
            ].map(([Icon, title, desc], i) => (
              <article key={title}>
                <span>0{i + 1}</span>
                <Icon size={26} />
                <h3>{title}</h3>
                <p>{desc}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer>
        <Logo />
        <span>
          An independent local implementation inspired by the GoMotion journey.
        </span>
        <a href="#/create">
          Your next story
          <ArrowRight size={14} />
        </a>
      </footer>
    </div>
  );
}
