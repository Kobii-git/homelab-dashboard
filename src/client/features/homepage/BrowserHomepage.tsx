import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Search,
  Settings2,
} from "lucide-react";
import {
  defaultLayout,
  type HomeLayout,
  type HomepageData,
  type HomepageSnapshot,
  type WorkspaceId,
} from "../../../shared/homepage";
import { apiGet, apiSend, type SystemSettingsDto } from "../../lib/api";
import type {
  DashboardHomeSummaryDto,
  DashboardResource,
  DashboardUtilitiesSummaryDto,
} from "../../../shared/types";
import { statusFor } from "../../lib/format";
import { ModalSurface } from "../../components/ModalSurface";
import {
  CalendarCard,
  TasksCard,
  MailCard,
  MediaCard,
  StorageCard,
  CompactWeatherCard,
  ReleasesCard,
} from "../dashboard/DashboardLaunchpad";
import { BookmarkManager, CopyPreview } from "./BookmarkManager";
import {
  fileBase64,
  useHomepage,
  type HomepageController,
} from "./useHomepage";

const titles: Record<string, string> = {
  favorites: "Favorites",
  bookmarks: "Bookmarks",
  weather: "Weather",
  notes: "Scratchpad",
  prompts: "Prompt library",
  reading: "Reading list",
  timer: "Focus timer",
  agenda: "Calendar",
  tasks: "Tasks",
  mail: "Mail",
  media: "Media",
  storage: "Storage",
  services: "Services",
  releases: "Software releases",
};
export function BrowserHomepage({
  username,
  now,
  settings,
  onOperations,
  onSettings,
  services,
  serviceDirectory,
}: {
  username: string;
  now: Date;
  settings: SystemSettingsDto;
  onOperations: () => void;
  onSettings: () => void;
  services: DashboardResource[];
  serviceDirectory: ReactNode;
}) {
  const home = useHomepage();
  const [workspace, setWorkspace] = useState<WorkspaceId>(() =>
    localStorage.getItem("homepage-workspace") === "work" ? "work" : "home",
  );
  const [customize, setCustomize] = useState<{
    data: HomepageData;
    revision: number;
  } | null>(null);
  const [utilities, setUtilities] =
    useState<DashboardUtilitiesSummaryDto | null>(null);
  const [context, setContext] = useState<DashboardHomeSummaryDto | null>(null);
  const [weatherError, setWeatherError] = useState("");
  const [contextError, setContextError] = useState("");
  const [customError, setCustomError] = useState("");
  const snapshot = home.snapshot;
  const layout =
    customize?.data.workspaces[workspace].layout ??
    snapshot?.data.workspaces[workspace].layout;
  useEffect(
    () => localStorage.setItem("homepage-workspace", workspace),
    [workspace],
  );
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
  const background = layout.background.startsWith("asset:")
    ? `linear-gradient(var(--hp-overlay),var(--hp-overlay)),url(/api/homepage/assets/${layout.background.slice(6)})`
    : undefined;
  const blocks: Record<string, ReactNode> = {
    services: (
      <section className="hp-card launchpad-services" aria-label="Services">
        <h3>Services</h3>
        <div
          className="launchpad-status-line"
          aria-label="Service health summary"
        >
          <span>
            {services.filter((r) => statusFor(r) === "online").length} online
          </span>
          <span>
            {services.filter((r) => statusFor(r) === "unknown").length} unknown
          </span>
          <span>
            {services.filter((r) => statusFor(r) === "offline").length} offline
          </span>
          {services.length > 0 &&
            services.every((r) => statusFor(r) === "online") && (
              <strong>Everything looks reachable</strong>
            )}
        </div>
        {serviceDirectory}
      </section>
    ),
    releases: (
      <section className="hp-card launchpad-utilities">
        {utilities?.releases?.data ? (
          <ReleasesCard
            releases={utilities.releases.data}
            stale={utilities.releases.stale}
            error={utilities.releases.error}
          />
        ) : (
          <p role="status">
            {utilities?.releases?.error ||
              "Configure release repositories in Admin."}
          </p>
        )}
      </section>
    ),
    bookmarks: (
      <BookmarkManager key={workspace} home={home} workspace={workspace} />
    ),
    favorites: (
      <section className="hp-card" aria-label="Favorites">
        <h3>Favorites</h3>
        <div className="hp-favorites">
          {favorites.map((b) => (
            <a
              key={b.id}
              href={b.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="hp-site-icon">
                {b.name.charAt(0).toUpperCase()}
              </span>
              <strong>{b.name}</strong>
            </a>
          ))}
          {workspace === "home" &&
            services
              .filter((s) => s.favorite)
              .map((s) => (
                <a
                  key={s.id}
                  href={s.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="hp-site-icon">{s.name.charAt(0)}</span>
                  <strong>{s.name}</strong>
                </a>
              ))}
        </div>
        {!favorites.length &&
          !(workspace === "home" && services.some((s) => s.favorite)) && (
            <p className="muted-copy">Pin bookmarks to keep them close.</p>
          )}
      </section>
    ),
    notes: <Scratchpad key={workspace} home={home} workspace={workspace} />,
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
    weather: (
      <section className="hp-card" aria-label="Weather">
        <div className="hp-card-title">
          <h3>Weather</h3>
          <button onClick={onSettings}>Location &amp; units</button>
        </div>
        {!settings.dashboardUtilities.weather.enabled ? (
          <p>Choose a city in Admin to show your local forecast.</p>
        ) : (
          <>
            {weatherError && (
              <p role="status">Weather unavailable: {weatherError}</p>
            )}
            {!utilities && !weatherError && (
              <p role="status">Loading weather…</p>
            )}
            {utilities?.weather.data && (
              <CompactWeatherCard
                data={utilities.weather.data}
                stale={utilities.weather.stale || Boolean(weatherError)}
              />
            )}{" "}
            {utilities?.weather.error && (
              <p role="status">
                <strong>Weather unavailable</strong> · {utilities.weather.error}
              </p>
            )}
          </>
        )}
      </section>
    ),
    agenda: context ? (
      <CalendarCard summary={context.agenda} now={now} />
    ) : (
      <p role="status">{contextError || "Loading calendar…"}</p>
    ),
    tasks: context ? (
      <TasksCard summary={context.tasks} />
    ) : (
      <p role="status">{contextError || "Loading tasks…"}</p>
    ),
    mail: context ? (
      <MailCard summary={context.mail} />
    ) : (
      <p role="status">{contextError || "Loading mail…"}</p>
    ),
    media: context ? (
      <MediaCard summary={context.media} />
    ) : (
      <p role="status">{contextError || "Loading media…"}</p>
    ),
    storage: context ? (
      <StorageCard summary={context.storage} />
    ) : (
      <p role="status">{contextError || "Loading storage…"}</p>
    ),
  };
  function updateLayout(next: HomeLayout) {
    if (customize)
      setCustomize({
        ...customize,
        data: {
          ...customize.data,
          workspaces: {
            ...customize.data.workspaces,
            [workspace]: {
              ...customize.data.workspaces[workspace],
              layout: next,
            },
          },
        },
      });
  }
  async function saveLayout() {
    if (!customize) return;
    try {
      await home.saveData(customize.data, customize.revision);
      setCustomize(null);
      setCustomError("");
    } catch (e) {
      setCustomError(e instanceof Error ? e.message : "Could not save layout");
    }
  }
  return (
    <div
      className={`browser-home hp-accent-${layout.accent} hp-bg-${layout.background.split(":")[0]}`}
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
          {layout.clock !== "hidden" && (
            <time>
              {now.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          )}
          <nav className="segmented-control" aria-label="Dashboard view">
            <button
              aria-pressed={workspace === "home"}
              className={workspace === "home" ? "active" : ""}
              onClick={() => {
                setWorkspace("home");
                setCustomize(null);
              }}
            >
              Home
            </button>
            <button
              aria-pressed={workspace === "work"}
              className={workspace === "work" ? "active" : ""}
              onClick={() => {
                setWorkspace("work");
                setCustomize(null);
              }}
            >
              Work
            </button>
            <button onClick={onOperations}>Operations</button>
          </nav>
        </div>
      </header>
      <HomepageSearch home={home} workspace={workspace} />
      <div className="hp-toolbar">
        <span role="status">
          {home.busy
            ? "Saving…"
            : home.error
              ? "Connection or save needs attention"
              : "Shared across your devices"}
        </span>
        <div className="hp-actions">
          <button
            onClick={() => {
              setCustomize({
                data: structuredClone(snapshot.data),
                revision: snapshot.revision,
              });
              setCustomError("");
            }}
          >
            <Settings2 size={16} /> Customize {workspace}
          </button>
          <button onClick={onSettings}>Admin &amp; backups</button>
        </div>
      </div>
      {home.error && (
        <div className="hp-notice" role="alert">
          {home.error}{" "}
          <button onClick={() => void home.refresh()}>Reload saved data</button>
          <small>
            Open drafts are preserved. Review them before resubmitting.
          </small>
        </div>
      )}
      {customize && (
        <section
          className="hp-card hp-customize"
          aria-label="Customize homepage"
        >
          <h3>Make it yours</h3>
          <p>Preview changes below. Save when you are happy with the result.</p>
          <div className="hp-actions">
            <label>
              Accent
              <select
                aria-label="Accent"
                value={layout.accent}
                onChange={(e) =>
                  updateLayout({
                    ...layout,
                    accent: e.target.value as HomeLayout["accent"],
                  })
                }
              >
                {["blue", "green", "violet", "amber"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Background
              <select
                aria-label="Background"
                value={layout.background}
                onChange={(e) =>
                  updateLayout({ ...layout, background: e.target.value })
                }
              >
                <option value="none">Plain</option>
                <option value="dawn">Dawn</option>
                <option value="ocean">Ocean</option>
                {snapshot.assets.map((a, i) => (
                  <option key={a.id} value={`asset:${a.id}`}>
                    Uploaded background {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Clock
              <select
                aria-label="Clock"
                value={layout.clock}
                onChange={(e) =>
                  updateLayout({
                    ...layout,
                    clock: e.target.value as HomeLayout["clock"],
                  })
                }
              >
                <option value="digital">Digital</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
          </div>
          <label className="hp-file">
            Upload PNG background (up to 4 MiB / 4 megapixels)
            <input
              type="file"
              accept="image/png"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  if (file.size > 4 * 1024 * 1024)
                    throw new Error("Choose a PNG under 4 MiB");
                  const result = await apiSend<{
                    id: string;
                    snapshot: HomepageSnapshot;
                  }>("/api/homepage/assets", "POST", {
                    revision: customize.revision,
                    body: await fileBase64(file),
                  });
                  home.setSnapshot(result.snapshot);
                  setCustomize({
                    ...customize,
                    revision: result.snapshot.revision,
                    data: {
                      ...customize.data,
                      workspaces: {
                        ...customize.data.workspaces,
                        [workspace]: {
                          ...customize.data.workspaces[workspace],
                          layout: {
                            ...layout,
                            background: `asset:${result.id}`,
                          },
                        },
                      },
                    },
                  });
                } catch (e) {
                  setCustomError(
                    e instanceof Error ? e.message : "Upload failed",
                  );
                }
              }}
            />
          </label>
          <div className="hp-widget-options">
            {layout.widgets.map((w, i) => (
              <div key={w.id}>
                <label className="hp-check">
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    onChange={(e) =>
                      updateLayout({
                        ...layout,
                        widgets: layout.widgets.map((x) =>
                          x.id === w.id
                            ? { ...x, enabled: e.target.checked }
                            : x,
                        ),
                      })
                    }
                  />
                  {titles[w.id]}
                </label>
                <select
                  aria-label={`${titles[w.id]} width`}
                  value={w.size}
                  onChange={(e) =>
                    updateLayout({
                      ...layout,
                      widgets: layout.widgets.map((x) =>
                        x.id === w.id
                          ? { ...x, size: e.target.value as "normal" | "wide" }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="wide">Wide</option>
                </select>
                {[-1, 1].map((delta) => (
                  <button
                    key={delta}
                    aria-label={`Move ${titles[w.id]} ${delta < 0 ? "up" : "down"}`}
                    disabled={
                      i + delta < 0 || i + delta >= layout.widgets.length
                    }
                    onClick={() => {
                      const widgets = [...layout.widgets];
                      [widgets[i], widgets[i + delta]] = [
                        widgets[i + delta],
                        widgets[i],
                      ];
                      updateLayout({ ...layout, widgets });
                    }}
                  >
                    {delta < 0 ? (
                      <ArrowUp size={14} />
                    ) : (
                      <ArrowDown size={14} />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {snapshot.assets.length > 0 && (
            <details>
              <summary>Remove unused backgrounds</summary>
              {snapshot.assets.map((a, i) => (
                <button
                  key={a.id}
                  disabled={
                    Object.values(snapshot.data.workspaces).some(
                      (w) => w.layout.background === `asset:${a.id}`,
                    ) || layout.background === `asset:${a.id}`
                  }
                  onClick={async () => {
                    try {
                      const next = await home.mutate(
                        `/api/homepage/assets/${a.id}/delete`,
                        { revision: customize.revision },
                      );
                      setCustomize({ ...customize, revision: next.revision });
                    } catch (e) {
                      setCustomError(
                        e instanceof Error ? e.message : "Could not delete",
                      );
                    }
                  }}
                >
                  Remove background {i + 1}
                </button>
              ))}
            </details>
          )}
          <p role="alert">{customError}</p>
          <div className="hp-actions">
            <button
              disabled={home.busy}
              className="primary-button"
              onClick={() => void saveLayout()}
            >
              Save layout
            </button>
            <button onClick={() => setCustomize(null)}>Cancel preview</button>
            <button
              onClick={() => updateLayout(defaultLayout(workspace === "work"))}
            >
              Reset preview
            </button>
            {snapshot.revision !== customize.revision && (
              <button
                onClick={() =>
                  setCustomize({
                    data: {
                      ...snapshot.data,
                      workspaces: {
                        ...snapshot.data.workspaces,
                        [workspace]: {
                          ...snapshot.data.workspaces[workspace],
                          layout,
                        },
                      },
                    },
                    revision: snapshot.revision,
                  })
                }
              >
                Use latest version with this draft
              </button>
            )}
          </div>
        </section>
      )}
      <div className="hp-grid">
        {layout.widgets
          .filter((w) => w.enabled)
          .map((w) => (
            <div key={w.id} className={w.size === "wide" ? "hp-wide" : ""}>
              {blocks[w.id]}
            </div>
          ))}
      </div>
      {!layout.widgets.some((w) => w.id === "weather" && w.enabled) && (
        <button
          className="hp-weather-invite"
          onClick={() =>
            setCustomize({
              data: structuredClone(snapshot.data),
              revision: snapshot.revision,
            })
          }
        >
          Add your local weather and other widgets
        </button>
      )}
    </div>
  );
}
function HomepageSearch({
  home,
  workspace,
}: {
  home: HomepageController;
  workspace: WorkspaceId;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("google");
  const [scope, setScope] = useState("workspace");
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const matches = (home.snapshot?.bookmarks ?? [])
    .filter(
      (b) =>
        !b.deletedAt &&
        (scope === "all" || b.workspaceId === workspace) &&
        query.trim() &&
        [b.name, b.url, b.notes]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase().trim()),
    )
    .slice(0, 8);
  function submit() {
    if (!query.trim()) return;
    if (mode === "google")
      window.open(
        `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`,
        "_blank",
        "noopener,noreferrer",
      );
    else if (active >= 0 && matches[active])
      window.open(matches[active].url, "_blank", "noopener,noreferrer");
    setOpen(mode !== "google");
  }
  return (
    <section className="hp-search" aria-label="Search">
      <div className="hp-actions">
        <div
          className="segmented-control"
          role="group"
          aria-label="Search mode"
        >
          <button
            aria-pressed={mode === "google"}
            onClick={() => {
              setMode("google");
              setActive(-1);
            }}
          >
            Google
          </button>
          <button
            aria-pressed={mode === "bookmarks"}
            onClick={() => {
              setMode("bookmarks");
              setOpen(true);
              setActive(-1);
            }}
          >
            My bookmarks
          </button>
        </div>
        <label>
          Search scope
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setActive(-1);
            }}
          >
            <option value="workspace">This workspace</option>
            <option value="all">All workspaces</option>
          </select>
        </label>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Search size={23} />
        <input
          aria-label={
            mode === "google" ? "Search Google" : "Search my bookmarks"
          }
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && Boolean(query)}
          aria-controls={open && query ? "hp-search-results" : undefined}
          aria-activedescendant={
            open && active >= 0 && matches[active]
              ? `hp-result-${active}`
              : undefined
          }
          placeholder={
            mode === "google"
              ? "Search Google, or find a saved place…"
              : "Search your bookmarks…"
          }
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, matches.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(-1, i - 1));
            }
          }}
        />
        <button type="submit" className="primary-button">
          {mode === "google" ? "Search Google" : "Find bookmarks"}
        </button>
      </form>
      {open && query && (
        <div
          className="hp-suggestions"
          role="listbox"
          id="hp-search-results"
          aria-label="Saved bookmark suggestions"
        >
          {matches.map((b, i) => (
            <div
              role="option"
              aria-selected={active === i}
              id={`hp-result-${i}`}
              key={b.id}
            >
              <a
                href={b.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                {b.name}
                <small>
                  {b.workspaceId} · {b.url}
                </small>
              </a>
            </div>
          ))}
          {!matches.length && (
            <div role="option" aria-selected="false">
              No matching bookmarks
            </div>
          )}
          <p>
            {mode === "google"
              ? "Enter searches Google. Click a saved link to open it."
              : "Use the arrow keys and Enter to open a saved link."}
          </p>
        </div>
      )}
      <a
        className="hp-chatgpt"
        href="https://chatgpt.com/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open ChatGPT <ExternalLink size={15} />
        <small>Your account, in a new tab</small>
      </a>
    </section>
  );
}
function Scratchpad({
  home,
  workspace,
}: {
  home: HomepageController;
  workspace: WorkspaceId;
}) {
  const [draft, setDraft] = useState<{
    text: string;
    data: HomepageData;
    revision: number;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const value = draft?.text ?? home.snapshot!.data.workspaces[workspace].notes;
  async function save() {
    if (!draft) return;
    try {
      await home.saveData(
        {
          ...draft.data,
          workspaces: {
            ...draft.data.workspaces,
            [workspace]: {
              ...draft.data.workspaces[workspace],
              notes: draft.text,
            },
          },
        },
        draft.revision,
      );
      setDraft(null);
      setNotice("Saved");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Save failed");
    }
  }
  return (
    <section className="hp-card">
      <h3>Scratchpad</h3>
      <label className="hp-sr-only" htmlFor="hp-notes">
        Workspace notes
      </label>
      <textarea
        id="hp-notes"
        maxLength={50_000}
        rows={8}
        placeholder="A thought, a reminder, a place to start…"
        value={value}
        onChange={(e) => {
          setDraft({
            ...(draft ?? {
              data: structuredClone(home.snapshot!.data),
              revision: home.snapshot!.revision,
            }),
            text: e.target.value,
          });
          setNotice("Unsaved draft");
        }}
      />
      <div className="hp-actions">
        <button disabled={!draft || home.busy} onClick={() => void save()}>
          Save notes
        </button>
        {draft && (
          <button
            onClick={() => {
              setDraft(null);
              setNotice("");
            }}
          >
            Discard draft
          </button>
        )}
        {draft && draft.revision !== home.snapshot!.revision && (
          <button
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
      <p role="status">{notice}</p>
    </section>
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
              id: crypto.randomUUID(),
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
