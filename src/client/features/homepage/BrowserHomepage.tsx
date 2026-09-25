import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  Settings2,
  Star,
} from "lucide-react";
import {
  type HomepageData,
  type WorkspaceId,
} from "../../../shared/homepage";
import { apiGet, type SystemSettingsDto } from "../../lib/api";
import type {
  DashboardHomeSummaryDto,
  DashboardResource,
  DashboardUtilitiesSummaryDto,
} from "../../../shared/types";
import { SiteIcon } from "../../components/SiteIcon";
import { backgroundImage } from "./backgrounds";
import { ServiceIcon } from "../../components/ServiceIcon";
import { HealthStrip, StatusIndicator, type HealthItem } from "../../components/HealthStrip";
import { serviceHealth, utilityHealth, utilityPresentation } from "../../lib/healthPresentation";
import { HomepageStart } from "./HomepageStart";
import { ModalSurface } from "../../components/ModalSurface";
import {
  CalendarCard,
  TasksCard,
  MailCard,
  MediaCard,
  StorageCard,
  ReleasesCard,
} from "../dashboard/DashboardLaunchpad";
import { Notes } from "./Notes";
import { HeaderWeather } from "./HeaderWeather";
import { ShortcutMenu, type ShortcutItem } from "./ShortcutMenu";
import { WorkTimesheet } from "./WorkTimesheet";
import { CopyPreview } from "./BookmarkManager";
import { widgetTitles } from "./widgetTitles";
import { useHomepageWorkspace } from "./useHomepageWorkspace";
import {
  useHomepage,
  newHomepageId,
  type HomepageController,
} from "./useHomepage";

export function BrowserHomepage({
  username,
  now,
  settings,
  onOperations,
  onSettings,
  services,
  serviceDirectory,
  onInspectService,
}: {
  username: string;
  now: Date;
  settings: SystemSettingsDto;
  onOperations: () => void;
  onSettings: (section?: "homepage" | "bookmarks" | "integrations" | "services") => void;
  services: DashboardResource[];
  serviceDirectory: ReactNode;
  onInspectService: (resource: DashboardResource) => void;
}) {
  const home = useHomepage();
  const [workspace, setWorkspace] = useHomepageWorkspace();
  const [utilities, setUtilities] =
    useState<DashboardUtilitiesSummaryDto | null>(null);
  const [context, setContext] = useState<DashboardHomeSummaryDto | null>(null);
  const [weatherError, setWeatherError] = useState("");
  const [contextError, setContextError] = useState("");
  const snapshot = home.snapshot;
  const layout =
    snapshot?.data.workspaces[workspace].layout;
  const weatherEnabled = Boolean(
    layout?.widgets.some((w) => w.id === "weather" && w.enabled),
  );
  const releasesEnabled = Boolean(
    layout?.widgets.some((w) => w.id === "releases" && w.enabled),
  );
  const contextEnabled = Boolean(
    layout?.widgets.some(
      (w) =>
        ["agenda", "tasks", "mail", "media", "storage"].includes(w.id) &&
        w.enabled,
    ),
  );
  useEffect(() => {
    let active = true;
    let loading = false;
    const load = async () => {
      if (document.hidden || loading) return;
      loading = true;
      await Promise.allSettled([
        (weatherEnabled && settings.dashboardUtilities.weather.enabled) ||
        (releasesEnabled && settings.dashboardUtilities.releases.enabled)
          ? apiGet<DashboardUtilitiesSummaryDto>("/api/utilities/summary")
              .then((v) => {
                if (active) {
                  setUtilities(v);
                  setWeatherError("");
                }
              })
              .catch((e) => {
                if (active) setWeatherError(e.message);
              })
          : Promise.resolve(),
        contextEnabled
          ? apiGet<DashboardHomeSummaryDto>("/api/home/summary")
              .then((v) => {
                if (active) {
                  setContext(v);
                  setContextError("");
                }
              })
              .catch((e) => {
                if (active) setContextError(e.message);
              })
          : Promise.resolve(),
      ]);
      loading = false;
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [weatherEnabled, releasesEnabled, contextEnabled, settings]);
  if (!snapshot || !layout)
    return (
      <section className="hp-card">
        <p role="status">{home.error ?? "Loading your homepage…"}</p>
        <button onClick={() => void home.refresh()}>Retry</button>
        <button onClick={onOperations}>Operations</button>
      </section>
    );
  const favorites = snapshot.bookmarks.filter(
    (b) => b.workspaceId === workspace && b.favorite && !b.deletedAt,
  );
  const favoriteItems: ShortcutItem[] = [
    { id: "chatgpt", label: "ChatGPT", href: "https://chatgpt.com/", icon: <SiteIcon name="ChatGPT" url="https://chatgpt.com/" size={28} /> },
    ...favorites.map(b => ({ id: `bookmark-${b.id}`, label: b.name, href: b.url, icon: <SiteIcon name={b.name} url={b.url} size={28} /> })),
    ...(workspace === "home" ? services.filter(s => s.favorite).map(s => ({ id: `service-${s.id}`, label: s.name, href: s.url || undefined,
      icon: <ServiceIcon resource={s} size={28} />, onSelect: () => onInspectService(s) })) : []),
  ];
  const background = backgroundImage(layout.background);
  const enabledWidgets = layout.widgets.filter(widget => widget.enabled);
  const contentWidgets = enabledWidgets.filter(widget => !["bookmarks", "favorites", "weather"].includes(widget.id));
  if (workspace === "home") contentWidgets.sort((a, b) => Number(b.id === "services") - Number(a.id === "services"));
  const statusItems: HealthItem[] = [serviceHealth(services, onInspectService)];
  const disabled = { state: "disabled", data: null, stale: false, error: null, fetchedAt: null } as const;
  const contextConfigured = { agenda: settings.dashboardHome.agendaEnabled, tasks: settings.dashboardHome.tasksEnabled,
    mail: settings.dashboardHome.mailEnabled, media: settings.dashboardHome.mediaEnabled, storage: settings.dashboardHome.storageEnabled };
  const weatherConfigured = settings.dashboardUtilities.weather.enabled && Boolean(settings.dashboardUtilities.weather.location);
  for (const widget of enabledWidgets) {
    if (widget.id === "weather" || widget.id === "releases") {
      const configured = settings.dashboardUtilities[widget.id].enabled && (widget.id !== "weather" || settings.dashboardUtilities.weather.location);
      statusItems.push(utilityHealth(widget.id, widgetTitles[widget.id], configured ? utilities?.[widget.id] : disabled, configured ? weatherError : "", () => onSettings("integrations")));
    } else if (["agenda", "tasks", "mail", "media", "storage"].includes(widget.id)) {
      const id = widget.id as keyof DashboardHomeSummaryDto;
      statusItems.push(utilityHealth(id, widgetTitles[id], contextConfigured[id] ? context?.[id] : disabled, contextConfigured[id] ? contextError : "", () => onSettings("integrations")));
    }
  }
  function moduleState(title: string, result: Parameters<typeof utilityPresentation>[0], fetchError = "") {
    const state = utilityPresentation(result, fetchError);
    return <section className="hp-card module-state"><h3>{title}</h3><StatusIndicator tone={state.tone}>{state.label}</StatusIndicator>
      {state.tone !== "loading" && <button type="button" onClick={() => onSettings("integrations")}>Integration settings</button>}
    </section>;
  }
  function contextBlock(id: keyof DashboardHomeSummaryDto, render: (summary: DashboardHomeSummaryDto) => ReactNode) {
    const result = contextConfigured[id] ? context?.[id] : disabled;
    if (!context || result?.data == null) return moduleState(widgetTitles[id], result, contextConfigured[id] ? contextError : "");
    const summary = contextError ? { ...context, [id]: { ...result, stale: true, error: contextError } } : context;
    return render(summary);
  }
  const blocks: Record<string, ReactNode> = {
    services: (
      <section className="hp-card launchpad-services" aria-label="Services">
        <div className="hp-card-title"><h3>Services</h3><button aria-label="Manage services" title="Manage services" onClick={() => onSettings("services")}><Settings2 size={16} /></button></div>
        {serviceDirectory}
      </section>
    ),
    releases: settings.dashboardUtilities.releases.enabled && utilities?.releases?.data ? (
      <section className="hp-card launchpad-utilities"><ReleasesCard releases={utilities.releases.data}
        stale={utilities.releases.stale || Boolean(weatherError)} error={utilities.releases.error} /></section>
    ) : moduleState("Software releases", settings.dashboardUtilities.releases.enabled ? utilities?.releases : disabled, settings.dashboardUtilities.releases.enabled ? weatherError : ""),
    notes: <Notes key={workspace} home={home} workspace={workspace} />,
    prompts: (
      <PromptLibrary key={workspace} home={home} workspace={workspace} />
    ),
    reading: (
      <section className="hp-card">
        <h3>Reading list</h3>
        <div className="hp-reading">
          {snapshot.bookmarks
            .filter(
              (b) =>
                b.workspaceId === workspace &&
                !b.deletedAt &&
                ["unread", "reading"].includes(b.readingState),
            )
            .map((b) => (
              <a
                key={b.id}
                href={b.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {b.name}
                <small>{b.readingState}</small>
              </a>
            ))}
        </div>
        <p className="muted-copy">
          Set a bookmark’s reading state in its editor.
        </p>
      </section>
    ),
    timer: <FocusTimer />,
    agenda: contextBlock("agenda", value => <CalendarCard summary={value.agenda} now={now} />),
    tasks: contextBlock("tasks", value => <TasksCard summary={value.tasks} />),
    mail: contextBlock("mail", value => <MailCard summary={value.mail} />),
    media: contextBlock("media", value => <MediaCard summary={value.media} />),
    storage: contextBlock("storage", value => <StorageCard summary={value.storage} />),
  };
  return (
    <div
      className={`browser-home hp-accent-${layout.accent} hp-bg-${layout.background.split(":")[0]} hp-spacing-${layout.spacing}`}
      style={{ backgroundImage: background } as CSSProperties}
    >
      <header className="hp-header">
        <div>
          <span className="hp-eyebrow">
            {now.toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
          <h2>
            {workspace === "work" ? "Room to focus." : "Your day, one place."}
          </h2>
          <p>
            {workspace === "work"
              ? "Your work, links, and ideas — together."
              : `Welcome${username ? `, ${username}` : ""}. Make yourself at home.`}
          </p>
        </div>
        <div className="hp-header-tools">
          <button className="hp-customize-button" onClick={() => onSettings("homepage")}><Settings2 size={15} /> Customize {workspace}</button>
          <div className="hp-header-glance">
          {weatherEnabled && <HeaderWeather key={workspace} weather={utilities?.weather} configured={weatherConfigured} error={weatherError} onSettings={() => onSettings("integrations")} />}
          {layout.clock !== "hidden" && (
            <time>
              {now.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          )}
          </div>
          <nav className="segmented-control" aria-label="Dashboard view">
            <button
              aria-pressed={workspace === "home"}
              className={workspace === "home" ? "active" : ""}
              onClick={() => {
                setWorkspace("home");
              }}
            >
              Home
            </button>
            <button
              aria-pressed={workspace === "work"}
              className={workspace === "work" ? "active" : ""}
              onClick={() => {
                setWorkspace("work");
              }}
            >
              Work
            </button>
            <button onClick={onOperations}>Operations</button>
          </nav>
        </div>
      </header>
      <HealthStrip items={statusItems} />
      <HomepageStart home={home} workspace={workspace} onWorkspace={setWorkspace} onCustomize={() => onSettings("homepage")} onManage={() => onSettings("bookmarks")} favorites={enabledWidgets.some(w => w.id === "favorites") ? <ShortcutMenu key={workspace} label="Favorites" icon={<Star size={17} aria-hidden="true" />} items={favoriteItems} /> : null} />
      {home.busy && <p className="hp-sync" role="status">Saving…</p>}
      {home.error && (
        <div className="hp-notice" role="alert">
          {home.error}{" "}
          <button onClick={() => void home.refresh()}>Reload saved data</button>
          <small>
            Open drafts are preserved. Review them before resubmitting.
          </small>
        </div>
      )}
      {workspace === "work" && <WorkTimesheet home={home} now={now} />}
      <div className="hp-grid">
        {contentWidgets.map((w) => (
            <div key={`${workspace}-${w.id}`} id={`widget-${w.id}`} className={`hp-widget hp-widget-${w.id} ${w.size === "wide" || (workspace === "home" && w.id === "services") ? "hp-wide" : ""}`}>
              {w.presentation === "dropdown" && !(workspace === "home" && w.id === "services") ? <details className="hp-widget-dropdown">
                <summary><ChevronRight size={16} /><span>{widgetTitles[w.id]}</span></summary>
                <div className="hp-dropdown-content">{blocks[w.id]}</div>
              </details> : blocks[w.id]}
            </div>
          ))}
      </div>
    </div>
  );
}
function PromptLibrary({
  home,
  workspace,
}: {
  home: HomepageController;
  workspace: WorkspaceId;
}) {
  const [draft, setDraft] = useState<{
    id: string;
    title: string;
    text: string;
    data: HomepageData;
    revision: number;
  } | null>(null);
  const [copy, setCopy] = useState<string | null>(null);
  const [error, setError] = useState("");
  return (
    <section className="hp-card">
      <div className="hp-card-title">
        <h3>Prompt library</h3>
        <button
          onClick={() =>
            setDraft({
              id: newHomepageId(),
              title: "",
              text: "",
              data: structuredClone(home.snapshot!.data),
              revision: home.snapshot!.revision,
            })
          }
        >
          Add prompt
        </button>
      </div>
      <p className="muted-copy">
        Copy a prompt and use it with your existing ChatGPT account.
      </p>
      {home
        .snapshot!.data.prompts.filter((p) => p.workspaceId === workspace)
        .map((p) => (
          <div className="hp-prompt" key={p.id}>
            <strong>{p.title}</strong>
            <div className="hp-actions">
              <button
                onClick={(event) => {
                  event.currentTarget.focus();
                  setCopy(p.text);
                }}
              >
                Copy
              </button>
              <button
                onClick={() =>
                  setDraft({
                    ...p,
                    data: structuredClone(home.snapshot!.data),
                    revision: home.snapshot!.revision,
                  })
                }
              >
                Edit
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm(`Delete prompt “${p.title}”?`)) return;
                  try {
                    await home.saveData(
                      {
                        ...home.snapshot!.data,
                        prompts: home.snapshot!.data.prompts.filter(
                          (x) => x.id !== p.id,
                        ),
                      },
                      home.snapshot!.revision,
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Delete failed");
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      {error && <p role="alert">{error}</p>}
      {draft && (
        <ModalSurface
          ariaLabel="Edit prompt"
          backdropClassName="modal-backdrop"
          className="hp-modal"
          onClose={() => setDraft(null)}
        >
          <h2>Prompt</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const prompts = draft.data.prompts.filter(
                  (p) => p.id !== draft.id,
                );
                prompts.push({
                  id: draft.id,
                  title: draft.title,
                  text: draft.text,
                  workspaceId: workspace,
                });
                await home.saveData({ ...draft.data, prompts }, draft.revision);
                setDraft(null);
                setError("");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not save");
              }
            }}
          >
            <label>
              Title
              <input
                required
                maxLength={160}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              Prompt text
              <textarea
                required
                maxLength={20_000}
                rows={10}
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
            </label>
            <p role="alert">{error}</p>
            <div className="hp-actions">
              <button disabled={home.busy}>Save prompt</button>
              <button type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
              {draft.revision !== home.snapshot!.revision && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      data: structuredClone(home.snapshot!.data),
                      revision: home.snapshot!.revision,
                    })
                  }
                >
                  Keep draft against latest version
                </button>
              )}
            </div>
          </form>
        </ModalSurface>
      )}
      {copy !== null && (
        <CopyPreview text={copy} onClose={() => setCopy(null)} />
      )}
    </section>
  );
}
function FocusTimer() {
  const [until, setUntil] = useState<number | null>(() => {
    const n = Number(localStorage.getItem("homepage-focus-until"));
    return Number.isFinite(n) && n > Date.now() ? n : null;
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (until) localStorage.setItem("homepage-focus-until", String(until));
    else localStorage.removeItem("homepage-focus-until");
  }, [until]);
  const remaining = until
    ? Math.max(0, Math.ceil((until - now) / 1000))
    : 25 * 60;
  return (
    <section className="hp-card">
      <h3>Focus timer</h3>
      <div className="hp-timer">
        {String(Math.floor(remaining / 60)).padStart(2, "0")}:
        {String(remaining % 60).padStart(2, "0")}
      </div>
      {until && remaining === 0 && (
        <p role="status">Session complete. Take a break.</p>
      )}
      <p className="muted-copy">
        A little space for one thing. This timer stays on this browser.
      </p>
      <div className="hp-actions">
        <button onClick={() => setUntil(Date.now() + 25 * 60_000)}>
          Start 25 minutes
        </button>
        <button disabled={!until} onClick={() => setUntil(null)}>
          Reset
        </button>
      </div>
    </section>
  );
}
