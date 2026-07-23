import {
  AlertTriangle,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  ExternalLink,
  Github,
  Globe2,
  Plus,
  Search,
  Server,
  Snowflake,
  Sun
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  DashboardResource,
  DashboardUtilitiesConfigDto,
  DashboardUtilitiesSummaryDto,
  ReleaseItemDto,
  WeatherSummaryDto
} from "../../../shared/types";
import { ServiceIcon } from "../../components/ServiceIcon";
import { apiGet } from "../../lib/api";
import { greetingFor, relativeTime, statusFor } from "../../lib/format";
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
    <div className="universal-search">
      <label className="universal-search-field">
        <Search size={20} />
        <input
          value={query}
          placeholder="Open a service or search the web…"
          aria-label="Open a service or search the web"
          autoComplete="off"
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
        <div className="universal-search-results" role="listbox" aria-label="Launchpad search results">
          {matches.map((resource, index) => (
            <button
              key={resource.id}
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
              <i className={`svc-dot dot-${statusFor(resource)}`} aria-label={statusFor(resource)} />
            </button>
          ))}
          <button
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

function WeatherCard({ data, stale, error }: { data: WeatherSummaryDto; stale: boolean; error: string | null }) {
  const degree = data.units === "metric" ? "°C" : "°F";
  return (
    <article className="launchpad-utility-card weather-card">
      <header>
        <span className="utility-card-icon"><WeatherIcon data={data} /></span>
        <span><strong>{data.location.name}</strong><small>{data.condition}</small></span>
        <b>{Math.round(data.temperature)}{degree}</b>
      </header>
      <div className="weather-days">
        {data.days.map((day, index) => (
          <span key={day.date}>
            <small>{index === 0 ? "Today" : new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "short" })}</small>
            <strong>{Math.round(day.high)}° <i>{Math.round(day.low)}°</i></strong>
            <small>{day.precipitationChance == null ? day.condition : `${Math.round(day.precipitationChance)}% rain`}</small>
          </span>
        ))}
      </div>
      {(stale || error) ? <p className="utility-note">{error ?? "Showing cached weather."}</p> : null}
    </article>
  );
}

function ReleasesCard({ releases, stale, error }: { releases: ReleaseItemDto[]; stale: boolean; error: string | null }) {
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
  serviceDirectory,
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
  serviceDirectory: ReactNode;
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
  const hasConfiguredUtilities = utilityConfig.weather.enabled || utilityConfig.releases.enabled;

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

  const dateLine = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <header className="launchpad-hero">
        <div className="launchpad-heading">
          <span>{greetingFor(now)}{username ? `, ${username}` : ""}</span>
          <h2>Your homelab, one click away</h2>
          <p>{dateLine} · {resources.length} service{resources.length === 1 ? "" : "s"}</p>
        </div>
        <div className="launchpad-hero-actions">
          <div className="launchpad-clock" aria-label={`Current time ${clock}`}>{clock}</div>
          <DashboardModeSwitch mode={mode} onChange={onModeChange} />
        </div>
      </header>

      <UniversalSearch resources={resources} searchEngine={utilityConfig.searchEngine} onLaunch={onLaunch} />

      <div className="launchpad-status-line" aria-label="Service health summary">
        <span><i className="svc-dot dot-online" /> {totals.online} online</span>
        {totals.offline > 0 ? <span className="status-line-danger"><i className="svc-dot dot-offline" /> {totals.offline} offline</span> : null}
        {totals.unknown > 0 ? <span><i className="svc-dot dot-unknown" /> {totals.unknown} unknown</span> : null}
        {resources.length > 0 && totals.offline === 0 ? <strong>Everything looks reachable</strong> : null}
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
                <i className={`svc-dot dot-${statusFor(resource)}`} />
              </button>
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
        <div className={`launchpad-layout ${hasConfiguredUtilities ? "has-utilities" : ""}`}>
          <div className="launchpad-services">{serviceDirectory}</div>
          <aside className="launchpad-utilities" aria-label="Launchpad utilities">
            {hasConfiguredUtilities && !utilities && !utilityError ? (
              <article className="launchpad-utility-card utility-loading-card" role="status">
                <CloudSun size={20} /><span><strong>Loading utilities</strong><small>Services remain ready to use.</small></span>
              </article>
            ) : null}
            {utilities?.weather.state === "ready" && utilities.weather.data ? (
              <WeatherCard data={utilities.weather.data} stale={utilities.weather.stale} error={utilities.weather.error} />
            ) : null}
            {utilities?.weather.state === "error" ? (
              <article className="launchpad-utility-card utility-error-card">
                <CloudSun size={20} /><span><strong>Weather unavailable</strong><small>{utilities.weather.error}</small></span>
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
            {!hasConfiguredUtilities ? (
              <button className="utility-setup-card" type="button" onClick={onOpenSettings}>
                <Plus size={18} />
                <span><strong>Add Launchpad context</strong><small>Weather and software releases</small></span>
              </button>
            ) : null}
          </aside>
        </div>
      )}
    </>
  );
}
