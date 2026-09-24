import {
  AlertTriangle,
  Bookmark,
  Settings2,
  CalendarDays,
  CheckCircle2,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  ExternalLink,
  Film,
  Github,
  Globe2,
  HardDrive,
  Inbox,
  Plus,
  Search,
  Server,
  Snowflake,
  Sun
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  DashboardResource,
  DashboardHomeConfigDto,
  DashboardHomeSummaryDto,
  DashboardUtilitiesConfigDto,
  DashboardUtilitiesSummaryDto,
  ReleaseItemDto,
  WeatherSummaryDto
} from "../../../shared/types";
import { ServiceIcon } from "../../components/ServiceIcon";
import { isBookmark } from "../../lib/bookmarks";
import { apiGet } from "../../lib/api";
import { calendarEventsOnDay, calendarEventStart, upcomingCalendarEvents } from "../../lib/calendar";
import { formatBytes, greetingFor, relativeTime, statusFor } from "../../lib/format";
import { serviceTemplates } from "../../lib/serviceCatalog";

export type DashboardMode = "launchpad" | "operations";

export const DASHBOARD_MODE_KEY = "homelab-dashboard-mode";

const searchProviders: Record<DashboardUtilitiesConfigDto["searchEngine"], { label: string; url: string }> = {
  duckduckgo: { label: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  google: { label: "Google", url: "https://www.google.com/search?q=" },
  brave: { label: "Brave", url: "https://search.brave.com/search?q=" },
  kagi: { label: "Kagi", url: "https://kagi.com/search?q=" },
  startpage: { label: "Startpage", url: "https://www.startpage.com/sp/search?query=" }
};

function scoreResource(resource: DashboardResource, query: string): number {
  const needle = query.trim().toLowerCase();
  const name = resource.name.toLowerCase();
  const haystack = [resource.name, resource.description, resource.url, resource.host, resource.kind]
    .join(" ")
    .toLowerCase();
  if (name === needle) return 500;
  if (name.startsWith(needle)) return 400 + (resource.favorite ? 40 : 0);
  if (name.includes(needle)) return 300 + (resource.favorite ? 40 : 0);
  if (haystack.includes(needle)) return 200 + (resource.favorite ? 40 : 0);
  return 0;
}

function UniversalSearch({
  resources,
  searchEngine,
  onLaunch
}: {
  resources: DashboardResource[];
  searchEngine: DashboardUtilitiesConfigDto["searchEngine"];
  onLaunch: (resource: DashboardResource) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const provider = searchProviders[searchEngine];
  const matches = useMemo(
    () => query.trim()
      ? resources
          .map((resource) => ({ resource, score: scoreResource(resource, query) }))
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score || left.resource.name.localeCompare(right.resource.name))
          .slice(0, 6)
          .map((item) => item.resource)
      : [],
    [query, resources]
  );
  const resultCount = matches.length + (query.trim() ? 1 : 0);

  useEffect(() => setActive(0), [query]);

  function webSearch() {
    const needle = query.trim();
    if (!needle) return;
    window.open(`${provider.url}${encodeURIComponent(needle)}`, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  function select(index: number) {
    const resource = matches[index];
    if (resource) {
      onLaunch(resource);
      setOpen(false);
      return;
    }
    webSearch();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => Math.min(Math.max(0, resultCount - 1), current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && query.trim()) {
      event.preventDefault();
      select(active);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="universal-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <label className="universal-search-field">
        <Search size={20} />
        <input
          value={query}
          placeholder="Search your bookmarks, services, or the web…"
          aria-label="Open a service or search the web"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && Boolean(query.trim())}
          aria-controls={open && query.trim() ? "home-search-results" : undefined}
          aria-activedescendant={open && query.trim() ? `home-search-result-${active}` : undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd>↵</kbd>
      </label>

      {open && query.trim() ? (
        <div id="home-search-results" className="universal-search-results" role="listbox" aria-label="Launchpad search results">
          {matches.map((resource, index) => (
            <button
              key={resource.id}
              id={`home-search-result-${index}`}
              className={active === index ? "active" : ""}
              type="button"
              role="option"
              aria-selected={active === index}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(index)}
            >
              <ServiceIcon resource={resource} size={28} />
              <span>
                <strong>{resource.name}</strong>
                <small>{resource.description ?? resource.url ?? resource.host ?? resource.kind}</small>
              </span>
              {isBookmark(resource) ? <Bookmark size={14} aria-label="Bookmark" /> : <i className={`svc-dot dot-${statusFor(resource)}`} aria-label={statusFor(resource)} />}
            </button>
          ))}
          <button
            id={`home-search-result-${matches.length}`}
            className={`universal-web-result ${active === matches.length ? "active" : ""}`}
            type="button"
            role="option"
            aria-selected={active === matches.length}
            onMouseEnter={() => setActive(matches.length)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={webSearch}
          >
            <span className="search-provider-icon"><Globe2 size={17} /></span>
            <span>
              <strong>Search {provider.label}</strong>
              <small>{query.trim()}</small>
            </span>
            <ExternalLink size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WeatherIcon({ data }: { data: WeatherSummaryDto }) {
  const code = data.weatherCode;
  if ([95, 96, 99].includes(code)) return <CloudLightning size={22} />;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return <Snowflake size={22} />;
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return <CloudRain size={22} />;
  if (code === 0) return data.isDay ? <Sun size={22} /> : <CloudSun size={22} />;
  return <Cloud size={22} />;
}

export function ReleasesCard({ releases, stale, error }: { releases: ReleaseItemDto[]; stale: boolean; error: string | null }) {
  return (
    <article className="launchpad-utility-card releases-card">
      <header>
        <span className="utility-card-icon"><Github size={20} /></span>
        <span><strong>Software releases</strong><small>{releases.length} recent updates</small></span>
      </header>
      <div className="release-list">
        {releases.map((release) => (
          <a key={`${release.repository}-${release.tag}`} href={release.url} target="_blank" rel="noreferrer">
            <span><strong>{release.repository}</strong><small>{release.name}</small></span>
            <span><b>{release.tag}</b><small>{relativeTime(release.publishedAt)}</small></span>
          </a>
        ))}
      </div>
      {(stale || error) ? <p className="utility-note">{error ?? "Showing cached release data."}</p> : null}
    </article>
  );
}

function ResultNotice({ label, error }: { label: string; error: string | null }) {
  return (
    <article className="home-module home-module-message" role="status">
      <AlertTriangle size={18} />
      <span><strong>{label}</strong><small>{error ?? "Not configured yet."}</small></span>
    </article>
  );
}

const googleEventColors = ["#7986cb", "#33b679", "#8e24aa", "#e67c73", "#f6c026", "#f5511d", "#039be5", "#616161", "#3f51b5", "#0b8043", "#d60000"];

function calendarColor(colorId: string | null): string {
  const index = colorId ? Number(colorId) - 1 : -1;
  return Number.isInteger(index) && index >= 0 && index < googleEventColors.length ? googleEventColors[index] : "var(--accent)";
}

export function CalendarCard({ summary, now }: { summary: DashboardHomeSummaryDto["agenda"]; now: Date }) {
  if (summary.state !== "ready" || !summary.data) return <ResultNotice label="Calendar unavailable" error={summary.error} />;
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const events = summary.data.events;
  const agenda = upcomingCalendarEvents(events, now).slice(0, 5);
  return (
    <article className="home-module home-calendar-card">
      <header className="home-module-header">
        <span><CalendarDays size={18} /><strong>{now.toLocaleDateString([], { month: "long", year: "numeric" })}</strong></span>
        {summary.stale ? <small>Cached</small> : <small>{agenda.length} next</small>}
      </header>
      <div className="compact-calendar" aria-label={`Calendar for ${now.toLocaleDateString([], { month: "long", year: "numeric" })}`}>
        {Array.from({ length: 7 }, (_, index) => <small key={index}>{["S", "M", "T", "W", "T", "F", "S"][index]}</small>)}
        {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const date = new Date(year, month, day);
          const dayEvents = calendarEventsOnDay(events, date);
          const today = day === now.getDate();
          const label = `${date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}${dayEvents.length ? ` · ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ""}`;
          return <time key={key} dateTime={key} className={today ? "today" : ""} aria-current={today ? "date" : undefined} aria-label={label}>{day}{dayEvents.length ? <i aria-hidden="true" style={{ background: calendarColor(dayEvents[0].color) }} /> : null}</time>;
        })}
      </div>
      <div className="agenda-list">
        {agenda.length === 0 ? <p className="home-empty">Nothing else on the calendar.</p> : agenda.map((event) => {
          const start = calendarEventStart(event);
          const content = <><time dateTime={event.start} style={{ color: calendarColor(event.color) }}>{event.allDay ? "All day" : start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><span><strong>{event.title}</strong><small>{start.toLocaleDateString([], { weekday: "short", day: "numeric" })} · {event.calendarName}</small></span></>;
          const key = `${event.calendarName}:${event.id}`;
          return event.url ? <a tabIndex={0} key={key} href={event.url} target="_blank" rel="noreferrer">{content}</a> : <div key={key}>{content}</div>;
        })}
      </div>
      {summary.error ? <p className="utility-note">{summary.error}</p> : null}
    </article>
  );
}

export function TasksCard({ summary }: { summary: DashboardHomeSummaryDto["tasks"] }) {
  if (summary.state !== "ready" || !summary.data) return <ResultNotice label="Todoist unavailable" error={summary.error} />;
  return (
    <article className="home-module home-tasks-card">
      <header className="home-module-header">
        <span><CheckCircle2 size={18} /><strong>Today</strong></span>
        <a href="https://app.todoist.com/app/today" target="_blank" rel="noreferrer">Todoist <ExternalLink size={12} /></a>
      </header>
      <div className="home-task-list">
        {summary.data.length === 0 ? <p className="home-empty">You’re clear for today.</p> : summary.data.map((task) => (
          <a key={task.id} href={task.url} target="_blank" rel="noreferrer">
            <i className={`task-priority p${task.priority}`} />
            <span><strong>{task.content}</strong><small>{task.overdue ? "Overdue" : task.dueAt ? new Date(task.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Today"}{task.projectName ? ` · ${task.projectName}` : ""}</small></span>
            <ExternalLink size={12} />
          </a>
        ))}
      </div>
      {(summary.stale || summary.error) ? <p className="utility-note">{summary.error ?? "Showing cached tasks."}</p> : null}
    </article>
  );
}

export function MailCard({ summary }: { summary: DashboardHomeSummaryDto["mail"] }) {
  if (summary.state !== "ready" || !summary.data) return <ResultNotice label="Gmail unavailable" error={summary.error} />;
  return (
    <article className="home-module home-mail-card">
      <span className="mail-icon"><Inbox size={19} /></span>
      <span><strong>{summary.data.inboxUnread}</strong><small>unread in Inbox</small></span>
      <div><a href={summary.data.inboxUrl} target="_blank" rel="noreferrer">Inbox</a><a href={summary.data.composeUrl} target="_blank" rel="noreferrer">Compose</a></div>
      {(summary.stale || summary.error) ? <p className="utility-note" role="status">{summary.stale ? "Showing cached mail count." : ""}{summary.error ? ` ${summary.error}` : ""}</p> : null}
    </article>
  );
}

export function CompactWeatherCard({ data, stale }: { data: WeatherSummaryDto; stale: boolean }) {
  const degree = data.units === "metric" ? "°C" : "°F";
  return (
    <article className="home-module compact-weather-card">
      <span className="utility-card-icon"><WeatherIcon data={data} /></span>
      <span><strong>{Math.round(data.temperature)}{degree}</strong><small>{data.condition} · {data.location.name}</small></span>
      <small>{stale ? "Cached forecast" : `Feels ${Math.round(data.apparentTemperature ?? data.temperature)}°`}</small>
      <div className="hp-forecast">{(data.days ?? []).slice(0,3).map(day => <div key={day.date}><strong>{new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "short" })}</strong><span>{day.condition}</span><small>{Math.round(day.high)}° / {Math.round(day.low)}°</small>{day.precipitationChance !== null && <small>{day.precipitationChance}% rain</small>}</div>)}</div>
      <p className="weather-attribution">Weather by <a tabIndex={0} href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a tabIndex={0} href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Rounded and summarized.</p>
    </article>
  );
}

type MediaTab = "recentlyAdded" | "upcoming" | "trending";

export function MediaCard({ summary }: { summary: DashboardHomeSummaryDto["media"] }) {
  const [tab, setTab] = useState<MediaTab>("recentlyAdded");
  if (summary.state !== "ready" || !summary.data) return <ResultNotice label="Media unavailable" error={summary.error} />;
  const items = summary.data[tab];
  const labels: Record<MediaTab, string> = { recentlyAdded: "Recently added", upcoming: "Upcoming", trending: "Trending" };
  const tabs = Object.keys(labels) as MediaTab[];

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, current: MediaTab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabs.indexOf(current);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setTab(next);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[nextIndex]?.focus();
  }

  return (
    <article className="home-module home-media-card">
      <header className="home-module-header media-header">
        <span><Film size={18} /><strong>Media</strong></span>
        <div className="media-tabs" role="tablist" aria-label="Movie shelf">
          {tabs.map((key) => (
            <button
              key={key}
              id={`media-tab-${key}`}
              type="button"
              role="tab"
              aria-controls="media-tabpanel"
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
              onKeyDown={(event) => moveTab(event, key)}
            >
              {labels[key]}
            </button>
          ))}
        </div>
      </header>
      <div id="media-tabpanel" className="poster-shelf" role="tabpanel" aria-labelledby={`media-tab-${tab}`}>
        {items.length === 0 ? <p className="home-empty">No movies to show from this source.</p> : items.map((item) => {
          const content = <><span className="poster-art">{item.posterUrl ? <img src={item.posterUrl} alt={`${item.title} poster`} loading="lazy" /> : <Film size={26} />}</span><strong>{item.title}</strong><small>{item.releaseDate ? new Date(`${item.releaseDate.slice(0, 10)}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" }) : item.year ?? item.source}</small></>;
          return item.externalUrl ? <a key={item.id} href={item.externalUrl} target="_blank" rel="noreferrer">{content}</a> : <div key={item.id}>{content}</div>;
        })}
      </div>
      {(summary.stale || summary.error) ? <p className="utility-note">{summary.error ?? "Showing cached media."}</p> : null}
    </article>
  );
}

export function StorageCard({ summary }: { summary: DashboardHomeSummaryDto["storage"] }) {
  if (summary.state !== "ready" || !summary.data) return <ResultNotice label="Storage unavailable" error={summary.error} />;
  const data = summary.data;
  const level = data.usedPercent >= 90 || !["ONLINE", "HEALTHY"].includes(data.health.toUpperCase()) ? "critical" : data.usedPercent >= 80 ? "warning" : "healthy";
  return (
    <article className={`home-module home-storage-card storage-${level}`}>
      <header className="home-module-header"><span><HardDrive size={18} /><strong>{data.name}</strong></span><small>{data.health}</small></header>
      <div className="storage-capacity"><strong>{data.usedPercent}%</strong><small>used</small></div>
      <div className="storage-bar" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.usedPercent}><i style={{ width: `${Math.min(100, data.usedPercent)}%` }} /></div>
      <div className="storage-facts"><span><small>Used</small><strong>{formatBytes(data.usedBytes)}</strong></span><span><small>Free</small><strong>{formatBytes(data.freeBytes)}</strong></span></div>
      <p>{data.datasetName ?? data.poolName} · {data.change24hBytes == null ? "building 24h trend" : `${data.change24hBytes >= 0 ? "+" : "−"}${formatBytes(Math.abs(data.change24hBytes))} in 24h`}</p>
      {(summary.stale || summary.error) ? <p className="utility-note" role="status">{summary.stale ? "Showing cached storage data." : ""}{summary.error ? ` ${summary.error}` : ""}</p> : null}
    </article>
  );
}

export function DashboardModeSwitch({
  mode,
  onChange
}: {
  mode: DashboardMode;
  onChange: (mode: DashboardMode) => void;
}) {
  return (
    <div className="dashboard-mode-switch segmented-control" role="group" aria-label="Dashboard view">
      <button className={mode === "launchpad" ? "active" : ""} type="button" onClick={() => onChange("launchpad")}>
        Launchpad
      </button>
      <button className={mode === "operations" ? "active" : ""} type="button" onClick={() => onChange("operations")}>
        Operations
      </button>
    </div>
  );
}

export function DashboardLaunchpad({
  now,
  username,
  resources,
  totals,
  favorites,
  offlineResources,
  utilityConfig,
  homeConfig,
  serviceDirectory,
  bookmarkLibrary,
  mode,
  onModeChange,
  onLaunch,
  onInspect,
  onOpenSettings,
  onAddService,
  onAddTemplate
}: {
  now: Date;
  username: string;
  resources: DashboardResource[];
  totals: { online: number; offline: number; unknown: number };
  favorites: DashboardResource[];
  offlineResources: DashboardResource[];
  utilityConfig: DashboardUtilitiesConfigDto;
  homeConfig: DashboardHomeConfigDto;
  serviceDirectory: ReactNode;
  bookmarkLibrary: ReactNode;
  mode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
  onLaunch: (resource: DashboardResource) => void;
  onInspect: (resource: DashboardResource) => void;
  onOpenSettings: () => void;
  onAddService: () => void;
  onAddTemplate: (templateId: string) => void;
}) {
  const [utilities, setUtilities] = useState<DashboardUtilitiesSummaryDto | null>(null);
  const [utilityError, setUtilityError] = useState<string | null>(null);
  const [home, setHome] = useState<DashboardHomeSummaryDto | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const hasConfiguredUtilities = utilityConfig.weather.enabled || utilityConfig.releases.enabled;
  const hasHomeModules = homeConfig.agendaEnabled || homeConfig.tasksEnabled || homeConfig.mailEnabled || homeConfig.mediaEnabled || homeConfig.storageEnabled;

  useEffect(() => {
    if (!hasConfiguredUtilities) {
      setUtilities(null);
      setUtilityError(null);
      return;
    }
    let active = true;
    setUtilityError(null);
    apiGet<DashboardUtilitiesSummaryDto>("/api/utilities/summary")
      .then((summary) => {
        if (active) setUtilities(summary);
      })
      .catch((error) => {
        if (active) setUtilityError(error instanceof Error ? error.message : "Launchpad utilities are unavailable");
      });
    return () => {
      active = false;
    };
  }, [hasConfiguredUtilities, utilityConfig.weather, utilityConfig.releases]);

  useEffect(() => {
    if (!hasHomeModules) {
      setHome(null);
      setHomeError(null);
      return;
    }
    let active = true;
    setHomeError(null);
    const load = () => {
      apiGet<DashboardHomeSummaryDto>("/api/home/summary")
        .then((summary) => {
          if (!active) return;
          setHome(summary);
          setHomeError(null);
        })
        .catch((error) => { if (active) setHomeError(error instanceof Error ? error.message : "Daily context is unavailable"); });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hasHomeModules, homeConfig]);

  const todayColumns = Number(homeConfig.agendaEnabled) + Number(homeConfig.tasksEnabled) + Number(homeConfig.mailEnabled || utilityConfig.weather.enabled);
  const dateLine = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <header className="launchpad-hero">
        <div className="launchpad-heading">
          <span>{greetingFor(now)}{username ? `, ${username}` : ""}</span>
          <h2>Your day, one place</h2>
          <p>{dateLine} · {resources.length} saved place{resources.length === 1 ? "" : "s"}</p>
        </div>
        <div className="launchpad-hero-actions">
          <div className="launchpad-clock" aria-label={`Current time ${clock}`}>{clock}</div>
          <DashboardModeSwitch mode={mode} onChange={onModeChange} />
        </div>
      </header>

      <div className="home-search-row">
        <UniversalSearch resources={resources} searchEngine={utilityConfig.searchEngine} onLaunch={onLaunch} />
        <button className="icon-text-button home-customize" type="button" onClick={onOpenSettings}><Settings2 size={16} /> Customize home</button>
      </div>
      {!utilityConfig.weather.enabled ? <button className="home-weather-invite" type="button" onClick={onOpenSettings}><CloudSun size={20} /><span>Add your local weather <small>Choose a city in Settings</small></span><Plus size={16} /></button> : null}

      {favorites.length > 0 ? (
        <section className="launchpad-favorites" aria-label="Favorites">
          <div className="launchpad-section-heading"><h3>Favorites</h3><small>Quick access</small></div>
          <div className="favorites-strip">
            {favorites.map((resource) => (
              <button
                key={resource.id}
                className="favorite-tile"
                type="button"
                onClick={() => resource.url ? onLaunch(resource) : onInspect(resource)}
              >
                <ServiceIcon resource={resource} size={30} />
                <span>{resource.name}</span>
                {isBookmark(resource) ? <Bookmark size={13} /> : <i className={`svc-dot dot-${statusFor(resource)}`} />}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {bookmarkLibrary}

      {(homeConfig.agendaEnabled || homeConfig.tasksEnabled || homeConfig.mailEnabled || utilityConfig.weather.enabled) ? (
        <section className="launchpad-cockpit-section" aria-labelledby="today-heading">
          <div className="launchpad-section-heading"><h3 id="today-heading">Today</h3><small>Your day at a glance</small></div>
          {!home && hasHomeModules && !homeError ? <div className="home-loading" role="status">Loading today’s context…</div> : null}
          {homeError ? <ResultNotice label="Daily context unavailable" error={homeError} /> : null}
          <div className="today-grid" style={{ gridTemplateColumns: `repeat(${todayColumns}, minmax(0, 1fr))` }}>
            {homeConfig.agendaEnabled && home ? <CalendarCard summary={home.agenda} now={now} /> : null}
            {homeConfig.tasksEnabled && home ? <TasksCard summary={home.tasks} /> : null}
            {(homeConfig.mailEnabled || utilityConfig.weather.enabled) ? <div className="today-context-stack">
              {utilityConfig.weather.enabled && !utilities && !utilityError ? <div className="home-loading" role="status">Loading weather…</div> : null}
              {utilityConfig.weather.enabled && utilityError ? <ResultNotice label="Weather unavailable" error={utilityError} /> : null}
              {utilityConfig.weather.enabled && utilities?.weather.state === "ready" && utilities.weather.data ? <CompactWeatherCard data={utilities.weather.data} stale={utilities.weather.stale} /> : null}
              {utilityConfig.weather.enabled && utilities?.weather.state === "error" ? <ResultNotice label="Weather unavailable" error={utilities.weather.error} /> : null}
              {homeConfig.mailEnabled && home ? <MailCard summary={home.mail} /> : null}
            </div> : null}
          </div>
        </section>
      ) : null}

      {(homeConfig.mediaEnabled || homeConfig.storageEnabled) ? (
        <section className="launchpad-cockpit-section" aria-labelledby="media-heading">
          <div className="launchpad-section-heading"><h3 id="media-heading">Media &amp; storage</h3><small>What’s new and how much room is left</small></div>
          {!home && !homeError ? <div className="home-loading" role="status">Loading media and storage…</div> : null}
          {homeError ? <ResultNotice label="Media and storage unavailable" error={homeError} /> : null}
          {home ? (
            <div className={`media-storage-grid ${homeConfig.mediaEnabled && homeConfig.storageEnabled ? "" : "single-module"}`}>
              {homeConfig.mediaEnabled ? <MediaCard summary={home.media} /> : null}
              {homeConfig.storageEnabled ? <StorageCard summary={home.storage} /> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="launchpad-status-line" aria-label="Service health summary">
        <span><i className="svc-dot dot-online" /> {totals.online} online</span>
        {totals.offline > 0 ? <span className="status-line-danger"><i className="svc-dot dot-offline" /> {totals.offline} offline</span> : null}
        {totals.unknown > 0 ? <span><i className="svc-dot dot-unknown" /> {totals.unknown} unknown</span> : null}
        {resources.some((resource) => resource.monitoringMode !== "disabled") && totals.online === resources.filter((resource) => resource.monitoringMode !== "disabled").length ? <strong>Everything looks reachable</strong> : null}
      </div>

      {offlineResources.length > 0 ? (
        <section className="attention-strip launchpad-attention" aria-label="Services needing attention">
          <span className="attention-label"><AlertTriangle size={15} /> {offlineResources.length} down</span>
          <div className="attention-chips">
            {offlineResources.map((resource) => (
              <button key={resource.id} type="button" onClick={() => onInspect(resource)}>{resource.name}</button>
            ))}
          </div>
        </section>
      ) : null}

      {resources.length === 0 ? (
        <section className="launchpad-onboarding">
          <div className="onboarding-copy">
            <span className="onboarding-icon"><Server size={24} /></span>
            <div>
              <span>Start your Launchpad</span>
              <h3>Add the services you use most</h3>
              <p>Pick a template to prefill the details, or add any website, server, VM, or app manually.</p>
            </div>
            <button className="primary-button" type="button" onClick={onAddService}><Plus size={15} /> Add custom service</button>
          </div>
          <div className="onboarding-template-grid">
            {serviceTemplates.slice(0, 8).map((template) => (
              <button key={template.id} type="button" onClick={() => onAddTemplate(template.id)}>
                <ServiceIcon
                  resource={{
                    name: template.name,
                    url: template.url,
                    icon: template.icon,
                    color: template.color
                  }}
                  size={30}
                />
                <span><strong>{template.name}</strong><small>{template.groupHint}</small></span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className={`launchpad-layout ${utilityConfig.releases.enabled ? "has-utilities" : ""}`}>
          <div className="launchpad-services">{serviceDirectory}</div>
          <aside className="launchpad-utilities" aria-label="Launchpad utilities">
            {hasConfiguredUtilities && !utilities && !utilityError ? (
              <article className="launchpad-utility-card utility-loading-card" role="status">
                <CloudSun size={20} /><span><strong>Loading utilities</strong><small>Services remain ready to use.</small></span>
              </article>
            ) : null}
            {utilities?.releases.state === "ready" && utilities.releases.data ? (
              <ReleasesCard releases={utilities.releases.data} stale={utilities.releases.stale} error={utilities.releases.error} />
            ) : null}
            {utilities?.releases.state === "error" ? (
              <article className="launchpad-utility-card utility-error-card">
                <Github size={20} /><span><strong>Releases unavailable</strong><small>{utilities.releases.error}</small></span>
              </article>
            ) : null}
            {utilityError ? (
              <article className="launchpad-utility-card utility-error-card">
                <AlertTriangle size={20} /><span><strong>Utilities unavailable</strong><small>{utilityError}</small></span>
              </article>
            ) : null}
            {!hasConfiguredUtilities && !hasHomeModules ? (
              <button className="utility-setup-card" type="button" onClick={onOpenSettings}>
                <Plus size={18} />
                <span><strong>Add Launchpad context</strong><small>Calendar, tasks, media, storage, and weather</small></span>
              </button>
            ) : null}
          </aside>
        </div>
      )}
    </>
  );
}
