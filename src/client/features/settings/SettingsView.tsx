import { DataBackups } from "../homepage/DataBackups";
import { Activity, CalendarDays, Clipboard, CloudSun, Cpu, ExternalLink, Film, Gauge, Github, HardDrive, Inbox, ListTodo, MapPin, PanelsTopLeft, Play, Plus, RefreshCw, Save, Search, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../../components/Primitives";
import { FormErrorBanner, runFormAction } from "../../lib/forms";
import {
  apiGet,
  apiSend,
  type ApiWidgetDto,
  type ApiWidgetSuggestionDto,
  type ApiWidgetTemplateDto,
  type AiBriefingDto,
  type HostMonitorDto,
  type IntegrationSourceDto,
  type RuntimeStatusDto,
  type SchedulerRuntimeDto,
  type SystemSettingsDto,
  type WeatherLocationDto
} from "../../lib/api";
import { formatByteRate, formatPercent, relativeTime } from "../../lib/format";
import { suggestedReleaseRepositories } from "../../lib/serviceCatalog";
import type { DashboardResource } from "../../../shared/types";

type HostMonitorForm = {
  id: string | null;
  name: string;
  baseUrl: string;
  primaryMount: string;
  networkInterface: string;
  enabled: boolean;
};

type ApiWidgetForm = {
  id: string | null;
  name: string;
  templateId: string;
  baseUrl: string;
  endpointPath: string;
  authType: ApiWidgetDto["authType"];
  authHeaderName: string;
  authEnvVar: string;
  authValuePrefix: string;
  tlsVerify: boolean;
  pollIntervalSeconds: string;
  fieldMappings: string;
  enabled: boolean;
  confirmSecretOrigin: boolean;
};

const emptyHostMonitorForm: HostMonitorForm = {
  id: null,
  name: "",
  baseUrl: "",
  primaryMount: "/",
  networkInterface: "",
  enabled: true
};

const emptyApiWidgetForm: ApiWidgetForm = {
  id: null,
  name: "",
  templateId: "custom-json",
  baseUrl: "",
  endpointPath: "/",
  authType: "none",
  authHeaderName: "",
  authEnvVar: "",
  authValuePrefix: "",
  tlsVerify: true,
  pollIntervalSeconds: "300",
  fieldMappings: JSON.stringify([{ label: "Status", path: "status", kind: "text" }], null, 2),
  enabled: true,
  confirmSecretOrigin: false
};

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function formatUptimeSeconds(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function SchedulerRuntimeCard({ label, state }: { label: string; state: SchedulerRuntimeDto }) {
  return (
    <div className={`scheduler-runtime-card ${state.lastError ? "scheduler-error" : state.enabled ? "scheduler-ok" : ""}`}>
      <strong>{label}</strong>
      <span>{state.enabled ? (state.running ? "running" : "ready") : "disabled"}</span>
      <small>last tick {relativeTime(state.lastTickAt)}</small>
      <small>due {state.lastDueCount ?? "—"} · {state.lastDurationMs ?? "—"} ms</small>
      {state.lastError ? <small className="drawer-check-error">{state.lastError}</small> : null}
    </div>
  );
}

export function SettingsView({
  username,
  authSource,
  resources,
  onRefresh,
  systemSettings,
  onSaveSettings,
  onReloadSettings
}: {
  username: string;
  authSource: "env" | "database";
  resources: DashboardResource[];
  onRefresh: () => Promise<void>;
  systemSettings: SystemSettingsDto;
  onSaveSettings: (next: Partial<SystemSettingsDto>) => Promise<void>;
  onReloadSettings: () => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [autoPingIntervalSeconds, setAutoPingIntervalSeconds] = useState(systemSettings.autoPingIntervalSeconds.toString());
  const [utilitySettings, setUtilitySettings] = useState(systemSettings.dashboardUtilities);
  const [homeSettings, setHomeSettings] = useState(systemSettings.dashboardHome);
  const [weatherQuery, setWeatherQuery] = useState("");
  const [weatherLocations, setWeatherLocations] = useState<WeatherLocationDto[]>([]);
  const [weatherSearching, setWeatherSearching] = useState(false);
  const [releaseRepositoryInput, setReleaseRepositoryInput] = useState("");
  const [hostMonitors, setHostMonitors] = useState<HostMonitorDto[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationSourceDto[]>([]);
  const [apiWidgets, setApiWidgets] = useState<ApiWidgetDto[]>([]);
  const [apiWidgetSuggestions, setApiWidgetSuggestions] = useState<ApiWidgetSuggestionDto[]>([]);
  const [apiWidgetTemplates, setApiWidgetTemplates] = useState<ApiWidgetTemplateDto[]>([]);
  const [hostForm, setHostForm] = useState<HostMonitorForm>(emptyHostMonitorForm);
  const [widgetForm, setWidgetForm] = useState<ApiWidgetForm>(emptyApiWidgetForm);
  const [runtime, setRuntime] = useState<RuntimeStatusDto | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [testingHostId, setTestingHostId] = useState<string | null>(null);
  const [testingIntegrationId, setTestingIntegrationId] = useState<string | null>(null);
  const [testingWidgetId, setTestingWidgetId] = useState<string | null>(null);
  const [runningAiBriefing, setRunningAiBriefing] = useState(false);
  const [addingWidgetSuggestionId, setAddingWidgetSuggestionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const keepSettingsDraft = useRef(false);
  useEffect(() => {
    if (keepSettingsDraft.current) { keepSettingsDraft.current = false; return; }
    setAutoPingIntervalSeconds(systemSettings.autoPingIntervalSeconds.toString());
    setUtilitySettings(systemSettings.dashboardUtilities);
    setHomeSettings(systemSettings.dashboardHome);
  }, [systemSettings]);

  const releaseSuggestions = useMemo(
    () => suggestedReleaseRepositories(resources, utilitySettings.releases.repositories),
    [resources, utilitySettings.releases.repositories]
  );

  useEffect(() => {
    void Promise.all([loadHostMonitors(), loadIntegrations(), loadApiWidgets(), loadRuntime()])
      .catch((loadError) => setActionError(loadError instanceof Error ? loadError.message : "Admin data failed to load"));
  }, []);

  async function loadHostMonitors() {
    const monitors = await apiGet<HostMonitorDto[]>("/api/metrics/hosts");
    setHostMonitors(monitors);
  }

  async function loadIntegrations() {
    const sources = await apiGet<IntegrationSourceDto[]>("/api/integrations");
    setIntegrations(sources);
  }

  async function loadApiWidgets() {
    const [widgets, templates, suggestions] = await Promise.all([
      apiGet<ApiWidgetDto[]>("/api/api-widgets"),
      apiGet<ApiWidgetTemplateDto[]>("/api/api-widget-templates"),
      apiGet<ApiWidgetSuggestionDto[]>("/api/api-widget-suggestions")
    ]);
    setApiWidgets(widgets);
    setApiWidgetTemplates(templates);
    setApiWidgetSuggestions(suggestions);
  }

  async function loadRuntime() {
    setRuntimeLoading(true);
    try {
      setRuntime(await apiGet<RuntimeStatusDto>("/api/admin/runtime"));
    } finally {
      setRuntimeLoading(false);
    }
  }

  async function runAiBriefing() {
    setRunningAiBriefing(true);
    await runFormAction(
      async () => {
        await apiSend<AiBriefingDto>("/api/ai/briefing/run", "POST");
        await Promise.all([loadRuntime(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      "AI briefing updated"
    );
    setRunningAiBriefing(false);
  }

  async function copyText(text: string) {
    await navigator.clipboard?.writeText(text);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setActionError("New passwords do not match");
      return;
    }

    await runFormAction(
      async () => {
        await apiSend("/api/auth/password", "POST", {
          currentPassword,
          newPassword
        });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        window.dispatchEvent(new CustomEvent("homelab:session-expired"));
      },
      setActionError,
      setSubmitting,
      "Password updated"
    );
  }

  async function updateSettings(event: FormEvent) {
    event.preventDefault();
    const interval = Number(autoPingIntervalSeconds);

    if (!Number.isInteger(interval) || interval < 15 || interval > 86400) {
      setActionError("Health check interval must be between 15 and 86400 seconds");
      return;
    }

    const payload = { autoPingIntervalSeconds: interval };
    await runFormAction(
      async () => {
        await onSaveSettings(payload);
        setAutoPingIntervalSeconds(payload.autoPingIntervalSeconds.toString());
      },
      setActionError,
      setSubmitting,
      "System settings updated"
    );
  }

  async function searchWeatherLocations() {
    const query = weatherQuery.trim();
    if (query.length < 3) {
      setActionError("Enter at least three characters to search for a weather location");
      return;
    }

    setWeatherSearching(true);
    setActionError(null);
    try {
      setWeatherLocations(
        await apiGet<WeatherLocationDto[]>(`/api/utilities/weather-locations?q=${encodeURIComponent(query)}`)
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Weather location search failed");
    } finally {
      setWeatherSearching(false);
    }
  }

  function selectWeatherLocation(location: WeatherLocationDto) {
    setUtilitySettings((current) => ({
      ...current,
      weather: { ...current.weather, enabled: true, location }
    }));
    setWeatherQuery(location.label);
    setWeatherLocations([]);
  }

  function addReleaseRepository(repository: string) {
    const normalized = repository.trim().toLowerCase();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
      setActionError("Use a public GitHub repository in owner/name format");
      return;
    }
    setUtilitySettings((current) => ({
      ...current,
      releases: {
        enabled: true,
        repositories: [...new Set([...current.releases.repositories, normalized])].slice(0, 12)
      }
    }));
    setReleaseRepositoryInput("");
    setActionError(null);
  }

  function removeReleaseRepository(repository: string) {
    setUtilitySettings((current) => ({
      ...current,
      releases: {
        ...current.releases,
        repositories: current.releases.repositories.filter((item) => item !== repository)
      }
    }));
  }

  async function saveDashboardUtilities(event: FormEvent) {
    event.preventDefault();
    if (utilitySettings.weather.enabled && !utilitySettings.weather.location) {
      setActionError("Choose a weather location before enabling weather");
      return;
    }

    await runFormAction(
      async () => {
        await onSaveSettings({
          dashboardUtilities: utilitySettings
        });
      },
      setActionError,
      setSubmitting,
      "Dashboard utilities updated"
    );
  }

  async function saveDashboardHome(event: FormEvent) {
    event.preventDefault();
    await runFormAction(
      async () => {
        await onSaveSettings({ dashboardHome: homeSettings });
      },
      setActionError,
      setSubmitting,
      "Daily cockpit updated"
    );
  }

  function editHostMonitor(monitor: HostMonitorDto) {
    setHostForm({
      id: monitor.id,
      name: monitor.name,
      baseUrl: monitor.baseUrl,
      primaryMount: monitor.primaryMount,
      networkInterface: monitor.networkInterface ?? "",
      enabled: monitor.enabled
    });
  }

  async function saveHostMonitor(event: FormEvent) {
    event.preventDefault();
    const payload = {
      name: hostForm.name,
      baseUrl: hostForm.baseUrl,
      primaryMount: hostForm.primaryMount || "/",
      networkInterface: hostForm.networkInterface || null,
      enabled: hostForm.enabled
    };

    await runFormAction(
      async () => {
        if (hostForm.id) {
          await apiSend(`/api/metrics/hosts/${hostForm.id}`, "PATCH", payload);
        } else {
          await apiSend("/api/metrics/hosts", "POST", payload);
        }
        setHostForm(emptyHostMonitorForm);
        await Promise.all([loadHostMonitors(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      hostForm.id ? "Host monitor updated" : "Host monitor added"
    );
  }

  async function testHostMonitor(monitor: HostMonitorDto) {
    setTestingHostId(monitor.id);
    await runFormAction(
      async () => {
        await apiSend(`/api/metrics/hosts/${monitor.id}/run`, "POST");
        await Promise.all([loadHostMonitors(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      "Host sample collected"
    );
    setTestingHostId(null);
  }

  async function testIntegration(source: IntegrationSourceDto) {
    setTestingIntegrationId(source.id);
    await runFormAction(
      async () => {
        await apiSend(`/api/integrations/${source.id}/run`, "POST");
        await Promise.all([loadIntegrations(), loadRuntime(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      "Integration sample collected"
    );
    setTestingIntegrationId(null);
  }

  function applyWidgetTemplate(templateId: string) {
    const template = apiWidgetTemplates.find((item) => item.id === templateId);
    setWidgetForm((current) => ({
      ...current,
      templateId,
      name: current.name || template?.name || "",
      endpointPath: template?.endpointPath ?? current.endpointPath,
      authType: template?.authType ?? current.authType,
      authHeaderName: template?.authHeaderName ?? "",
      authEnvVar: current.authEnvVar || template?.authEnvVarHint || "",
      authValuePrefix: template?.authValuePrefix ?? "",
      confirmSecretOrigin: false,
      fieldMappings: JSON.stringify(template?.fieldMappings ?? JSON.parse(emptyApiWidgetForm.fieldMappings), null, 2)
    }));
  }

  async function createSuggestedApiWidget(suggestion: ApiWidgetSuggestionDto) {
    setAddingWidgetSuggestionId(suggestion.id);
    await runFormAction(
      async () => {
        await apiSend("/api/api-widgets", "POST", {
          name: `${suggestion.resourceName} widget`,
          templateId: suggestion.templateId,
          baseUrl: suggestion.baseUrl,
          endpointPath: suggestion.endpointPath,
          authType: suggestion.authType,
          authHeaderName: suggestion.authHeaderName,
          authEnvVar: suggestion.authEnvVarHint,
          authValuePrefix: suggestion.authValuePrefix,
          tlsVerify: true,
          pollIntervalSeconds: 300,
          fieldMappings: suggestion.fieldMappings,
          enabled: true,
          ...(suggestion.authType !== "none"
            ? { confirmSecretOrigin: normalizedOrigin(suggestion.baseUrl) }
            : {})
        });
        await Promise.all([loadApiWidgets(), loadRuntime(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      "API widget imported"
    );
    setAddingWidgetSuggestionId(null);
  }

  function editApiWidget(widget: ApiWidgetDto) {
    setWidgetForm({
      id: widget.id,
      name: widget.name,
      templateId: widget.templateId,
      baseUrl: widget.baseUrl,
      endpointPath: widget.endpointPath,
      authType: widget.authType,
      authHeaderName: widget.authHeaderName ?? "",
      authEnvVar: widget.authEnvVar ?? "",
      authValuePrefix: widget.authValuePrefix ?? "",
      tlsVerify: widget.tlsVerify,
      pollIntervalSeconds: String(widget.pollIntervalSeconds),
      fieldMappings: JSON.stringify(widget.fieldMappings, null, 2),
      enabled: widget.enabled,
      confirmSecretOrigin: false
    });
  }

  async function saveApiWidget(event: FormEvent) {
    event.preventDefault();
    let fieldMappings: unknown;
    try {
      fieldMappings = JSON.parse(widgetForm.fieldMappings);
    } catch {
      setActionError("Field mappings must be valid JSON");
      return;
    }

    const payload = {
      name: widgetForm.name,
      templateId: widgetForm.templateId,
      baseUrl: widgetForm.baseUrl,
      endpointPath: widgetForm.endpointPath,
      authType: widgetForm.authType,
      authHeaderName: widgetForm.authHeaderName || null,
      authEnvVar: widgetForm.authEnvVar || null,
      authValuePrefix: widgetForm.authValuePrefix || null,
      tlsVerify: widgetForm.tlsVerify,
      pollIntervalSeconds: Number(widgetForm.pollIntervalSeconds || 300),
      fieldMappings,
      enabled: widgetForm.enabled,
      ...(widgetForm.authType !== "none" && widgetForm.confirmSecretOrigin
        ? { confirmSecretOrigin: normalizedOrigin(widgetForm.baseUrl) }
        : {})
    };

    if (widgetForm.authType !== "none" && !widgetForm.confirmSecretOrigin) {
      setActionError("Confirm the credential destination origin before saving this widget");
      return;
    }

    await runFormAction(
      async () => {
        if (widgetForm.id) {
          await apiSend(`/api/api-widgets/${widgetForm.id}`, "PATCH", payload);
        } else {
          await apiSend("/api/api-widgets", "POST", payload);
        }
        setWidgetForm(emptyApiWidgetForm);
        await Promise.all([loadApiWidgets(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      widgetForm.id ? "API widget updated" : "API widget added"
    );
  }

  async function testApiWidget(widget: ApiWidgetDto) {
    setTestingWidgetId(widget.id);
    await runFormAction(
      async () => {
        await apiSend(`/api/api-widgets/${widget.id}/run`, "POST");
        await Promise.all([loadApiWidgets(), loadRuntime(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      "API widget sample collected"
    );
    setTestingWidgetId(null);
  }

  async function patchApiWidget(widget: ApiWidgetDto, body: Record<string, unknown>) {
    await runFormAction(
      async () => {
        await apiSend(`/api/api-widgets/${widget.id}`, "PATCH", body);
        await Promise.all([loadApiWidgets(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      "API widget updated"
    );
  }

  async function deleteApiWidget(widget: ApiWidgetDto) {
    if (!window.confirm(`Delete "${widget.name}" and its sample history? This cannot be undone.`)) return;
    await runFormAction(
      async () => {
        await apiSend(`/api/api-widgets/${widget.id}`, "DELETE");
        if (widgetForm.id === widget.id) {
          setWidgetForm(emptyApiWidgetForm);
        }
        await Promise.all([loadApiWidgets(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      "API widget deleted"
    );
  }

  async function patchHostMonitor(monitor: HostMonitorDto, body: Record<string, unknown>) {
    await runFormAction(
      async () => {
        await apiSend(`/api/metrics/hosts/${monitor.id}`, "PATCH", body);
        await Promise.all([loadHostMonitors(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      "Host monitor updated"
    );
  }

  async function deleteHostMonitor(monitor: HostMonitorDto) {
    if (!window.confirm(`Delete "${monitor.name}" and its metric history? This cannot be undone.`)) return;
    await runFormAction(
      async () => {
        await apiSend(`/api/metrics/hosts/${monitor.id}`, "DELETE");
        if (hostForm.id === monitor.id) {
          setHostForm(emptyHostMonitorForm);
        }
        await Promise.all([loadHostMonitors(), onRefresh()]);
      },
      setActionError,
      setSubmitting,
      "Host monitor deleted"
    );
  }

  const trueNasSource = integrations.find((source) => source.provider === "truenas") ?? null;
  const opnsenseSources = integrations.filter((source) => source.provider === "opnsense");

  return (
    <main className="view-shell">
      <PageHeader title="Admin" subtitle="Account, appearance, and system tools" />

      <DataBackups onRestored={async () => {
        keepSettingsDraft.current = false;
        await Promise.all([onRefresh(), onReloadSettings(), loadHostMonitors(), loadApiWidgets(), loadIntegrations(), loadRuntime()]);
      }} />
      <FormErrorBanner message={actionError} />
      {actionError?.includes("Configuration changed") && <div className="hp-actions">
        <button disabled={submitting} onClick={() => void runFormAction(onReloadSettings, setActionError, setSubmitting)}>Reload saved settings</button>
        <button disabled={submitting} onClick={() => void runFormAction(async () => {
          keepSettingsDraft.current = true;
          try { await onReloadSettings(); } catch (error) { keepSettingsDraft.current = false; throw error; }
        }, setActionError, setSubmitting, "Draft retained. Review your changes before saving again.")}>Keep draft against latest version</button>
      </div>}

      <section className="settings-grid">
        <section className="table-panel settings-wide-panel">
          <h3><CloudSun size={16} /> Launchpad utilities</h3>
          <p className="muted-copy">
            Configure optional, credential-free context for the Launchpad. Weather and release data are fetched by the dashboard server and cached.
          </p>

          <form className="dashboard-utility-settings" onSubmit={saveDashboardUtilities}>
            <div className="utility-settings-block">
              <div className="section-heading compact-section-heading">
                <span>
                  <strong><Search size={15} /> Web search</strong>
                  <small>Used only when you choose the web fallback from Launchpad search.</small>
                </span>
              </div>
              <label>
                Search engine
                <select
                  value={utilitySettings.searchEngine}
                  onChange={(event) => setUtilitySettings((current) => ({
                    ...current,
                    searchEngine: event.target.value as typeof current.searchEngine
                  }))}
                >
                  <option value="duckduckgo">DuckDuckGo</option>
                  <option value="google">Google</option>
                  <option value="brave">Brave</option>
                  <option value="kagi">Kagi</option>
                  <option value="startpage">Startpage</option>
                </select>
              </label>
            </div>

            <div className="utility-settings-block">
              <div className="section-heading compact-section-heading">
                <span>
                  <strong><MapPin size={15} /> Weather</strong>
                  <small>Open-Meteo current conditions and a compact three-day forecast.</small>
                </span>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={utilitySettings.weather.enabled}
                    onChange={(event) => setUtilitySettings((current) => ({
                      ...current,
                      weather: { ...current.weather, enabled: event.target.checked }
                    }))}
                  />
                  Enabled
                </label>
              </div>

              <div className="utility-inline-controls">
                <label>
                  Units
                  <select
                    value={utilitySettings.weather.units}
                    onChange={(event) => setUtilitySettings((current) => ({
                      ...current,
                      weather: {
                        ...current.weather,
                        units: event.target.value as typeof current.weather.units
                      }
                    }))}
                  >
                    <option value="metric">Metric · °C</option>
                    <option value="imperial">Imperial · °F</option>
                  </select>
                </label>
                <label className="utility-grow-field">
                  Location
                  <span className="utility-search-control">
                    <input
                      value={weatherQuery}
                      onChange={(event) => setWeatherQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void searchWeatherLocations();
                        }
                      }}
                      placeholder="Johannesburg, Cape Town, London"
                    />
                    <button
                      className="icon-text-button"
                      type="button"
                      disabled={weatherSearching}
                      onClick={() => void searchWeatherLocations()}
                    >
                      {weatherSearching ? <RefreshCw size={14} className="spin" /> : <Search size={14} />} Search
                    </button>
                  </span>
                </label>
              </div>

              {utilitySettings.weather.location ? (
                <div className="selected-utility-value">
                  <MapPin size={14} />
                  <span><strong>{utilitySettings.weather.location.label}</strong><small>{utilitySettings.weather.location.timezone}</small></span>
                  <button
                    className="icon-button"
                    type="button"
                    title="Clear weather location"
                    onClick={() => setUtilitySettings((current) => ({
                      ...current,
                      weather: { ...current.weather, enabled: false, location: null }
                    }))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : null}

              {weatherLocations.length > 0 ? (
                <div className="utility-suggestion-list" aria-label="Weather location results">
                  {weatherLocations.map((location) => (
                    <button
                      type="button"
                      key={`${location.latitude}-${location.longitude}`}
                      onClick={() => selectWeatherLocation(location)}
                    >
                      <MapPin size={14} />
                      <span><strong>{location.label}</strong><small>{location.timezone}</small></span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="utility-settings-block">
              <div className="section-heading compact-section-heading">
                <span>
                  <strong><Github size={15} /> Software releases</strong>
                  <small>Track the latest public GitHub release for up to 12 repositories.</small>
                </span>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={utilitySettings.releases.enabled}
                    onChange={(event) => setUtilitySettings((current) => ({
                      ...current,
                      releases: { ...current.releases, enabled: event.target.checked }
                    }))}
                  />
                  Enabled
                </label>
              </div>

              <label>
                Add repository
                <span className="utility-search-control">
                  <input
                    value={releaseRepositoryInput}
                    onChange={(event) => setReleaseRepositoryInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addReleaseRepository(releaseRepositoryInput);
                      }
                    }}
                    placeholder="owner/repository"
                  />
                  <button
                    className="icon-text-button"
                    type="button"
                    disabled={!releaseRepositoryInput.trim() || utilitySettings.releases.repositories.length >= 12}
                    onClick={() => addReleaseRepository(releaseRepositoryInput)}
                  >
                    <Plus size={14} /> Add
                  </button>
                </span>
              </label>

              {utilitySettings.releases.repositories.length > 0 ? (
                <div className="repository-chip-list" aria-label="Tracked GitHub repositories">
                  {utilitySettings.releases.repositories.map((repository) => (
                    <span key={repository}>
                      <Github size={13} /> {repository}
                      <button type="button" aria-label={`Stop tracking ${repository}`} onClick={() => removeReleaseRepository(repository)}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {releaseSuggestions.length > 0 ? (
                <div className="utility-suggestions">
                  <small>Suggested from your services</small>
                  <div className="repository-chip-list">
                    {releaseSuggestions.map((suggestion) => (
                      <button
                        type="button"
                        key={suggestion.repository}
                        title={`Track releases for ${suggestion.resourceName}`}
                        onClick={() => addReleaseRepository(suggestion.repository)}
                      >
                        <Plus size={12} /> {suggestion.repository}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={submitting}>
                <Save size={15} /> Save Launchpad utilities
              </button>
            </div>
          </form>
        </section>

        <section className="table-panel settings-wide-panel">
          <h3><CalendarDays size={16} /> Personal context</h3>
          <p className="muted-copy">
            Choose which read-only modules appear on Launchpad. Credentials are supplied only through environment variables; secrets are never shown or stored here.
          </p>
          <form className="dashboard-home-settings" onSubmit={saveDashboardHome}>
            <div className="home-settings-grid">
              <label className="home-module-toggle">
                <span><CalendarDays size={17} /><strong>Calendar &amp; agenda</strong><small>Google Calendar · next five events</small></span>
                <input type="checkbox" checked={homeSettings.agendaEnabled} onChange={(event) => setHomeSettings((current) => ({ ...current, agendaEnabled: event.target.checked }))} />
              </label>
              <label className="home-module-toggle">
                <span><ListTodo size={17} /><strong>Todoist</strong><small>Overdue and today · links only</small></span>
                <input type="checkbox" checked={homeSettings.tasksEnabled} onChange={(event) => setHomeSettings((current) => ({ ...current, tasksEnabled: event.target.checked }))} />
              </label>
              <label className="home-module-toggle">
                <span><Inbox size={17} /><strong>Gmail count</strong><small>Unread Inbox total only</small></span>
                <input type="checkbox" checked={homeSettings.mailEnabled} onChange={(event) => setHomeSettings((current) => ({ ...current, mailEnabled: event.target.checked }))} />
              </label>
            </div>
            <div className="provider-readiness-grid" aria-label="Personal context provider readiness">
              <span><small>Google</small><strong>{runtime?.integrations.personalContext.googleConfigured ? "ready" : "missing env"}</strong></span>
              <span><small>Todoist</small><strong>{runtime?.integrations.personalContext.todoistConfigured ? "ready" : "missing env"}</strong></span>
            </div>
            <p className="muted-copy">Google needs client ID, client secret, refresh token, and calendar IDs. Todoist needs a personal API token.</p>

            <div className="section-heading compact-section-heading home-settings-subheading">
              <span><strong><Film size={15} /> Media &amp; storage</strong><small>Select existing credential-bound widgets; the dashboard never copies their tokens.</small></span>
            </div>
            <div className="home-settings-grid">
              <label className="home-module-toggle">
                <span><Film size={17} /><strong>Movie shelf</strong><small>Plex, Radarr, and TMDB</small></span>
                <input type="checkbox" checked={homeSettings.mediaEnabled} onChange={(event) => setHomeSettings((current) => ({ ...current, mediaEnabled: event.target.checked }))} />
              </label>
              <label className="home-module-toggle">
                <span><HardDrive size={17} /><strong>TrueNAS capacity</strong><small>Health, used/free, and 24h trend</small></span>
                <input type="checkbox" checked={homeSettings.storageEnabled} onChange={(event) => setHomeSettings((current) => ({ ...current, storageEnabled: event.target.checked }))} />
              </label>
            </div>
            <div className="settings-form-grid home-source-fields">
              <label>
                Plex widget
                <select value={homeSettings.plexWidgetId ?? ""} onChange={(event) => setHomeSettings((current) => ({ ...current, plexWidgetId: event.target.value || null }))}>
                  <option value="">Not selected</option>
                  {apiWidgets.filter((widget) => widget.templateId === "plex").map((widget) => <option key={widget.id} value={widget.id}>{widget.name}</option>)}
                </select>
              </label>
              <label>
                Radarr widget
                <select value={homeSettings.radarrWidgetId ?? ""} onChange={(event) => setHomeSettings((current) => ({ ...current, radarrWidgetId: event.target.value || null }))}>
                  <option value="">Not selected</option>
                  {apiWidgets.filter((widget) => widget.templateId === "radarr").map((widget) => <option key={widget.id} value={widget.id}>{widget.name}</option>)}
                </select>
              </label>
              <label>TMDB region<input maxLength={2} value={homeSettings.mediaRegion} onChange={(event) => setHomeSettings((current) => ({ ...current, mediaRegion: event.target.value.toUpperCase() }))} /></label>
              <label>TMDB language<input value={homeSettings.mediaLanguage} onChange={(event) => setHomeSettings((current) => ({ ...current, mediaLanguage: event.target.value }))} /></label>
              <label>Items per tab<input type="number" min={1} max={12} value={homeSettings.mediaLimit} onChange={(event) => setHomeSettings((current) => ({ ...current, mediaLimit: Number(event.target.value) }))} /></label>
            </div>
            <div className="provider-readiness-grid" aria-label="Media provider readiness">
              <span><small>TMDB</small><strong>{runtime?.integrations.personalContext.tmdbConfigured ? "ready" : "missing env"}</strong></span>
              <span><small>TrueNAS</small><strong>{runtime?.integrations.truenas.configured ? "ready" : "missing env"}</strong></span>
              <span><small>Storage status</small><strong>{trueNasSource?.status ?? (runtime?.integrations.truenas.configured ? "waiting" : "disabled")}</strong></span>
              <span><small>Pool</small><strong>{runtime?.integrations.truenas.poolName ?? "not set"}</strong></span>
              <span><small>Dataset</small><strong>{runtime?.integrations.truenas.datasetName ?? "pool total"}</strong></span>
            </div>
            {trueNasSource?.latestError ? <p className="form-error" role="status">TrueNAS: {trueNasSource.latestError}</p> : null}
            <div className="form-actions"><button className="primary-button" type="submit" disabled={submitting}><Save size={15} /> Save daily cockpit</button></div>
          </form>
        </section>

        <section className="table-panel settings-wide-panel">
          <h3><Cpu size={16} /> Host metrics</h3>
          <p className="muted-copy">
            Add Glances web endpoints from trusted LAN/VPN hosts. v1 does not store Glances credentials.
          </p>
          <code className="setup-command">glances -w --disable-webui --bind 0.0.0.0</code>
          <form className="inline-form settings-form-grid host-monitor-form" onSubmit={saveHostMonitor}>
            <label>
              Name
              <input
                value={hostForm.name}
                onChange={(event) => setHostForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="NAS, Docker Host, Proxmox"
                required
              />
            </label>
            <label>
              Glances URL
              <input
                value={hostForm.baseUrl}
                onChange={(event) => setHostForm((current) => ({ ...current, baseUrl: event.target.value }))}
                placeholder="https://glances.home.arpa"
                required
              />
            </label>
            <label>
              Mount
              <input
                value={hostForm.primaryMount}
                onChange={(event) => setHostForm((current) => ({ ...current, primaryMount: event.target.value }))}
                placeholder="/"
              />
            </label>
            <label>
              Network interface
              <input
                value={hostForm.networkInterface}
                onChange={(event) => setHostForm((current) => ({ ...current, networkInterface: event.target.value }))}
                placeholder="eth0, enp1s0"
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={hostForm.enabled}
                onChange={(event) => setHostForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
              Enabled
            </label>
            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={submitting}>
                <Save size={15} /> {hostForm.id ? "Update host" : "Add host"}
              </button>
              {hostForm.id ? (
                <button className="icon-text-button" type="button" onClick={() => setHostForm(emptyHostMonitorForm)}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <div className="host-monitor-list">
            {hostMonitors.map((monitor) => (
              <div className={`host-monitor-row host-${monitor.latestStatus}`} key={monitor.id}>
                <span className={`svc-dot dot-${monitor.latestStatus}`} />
                <span>
                  <strong>{monitor.name}</strong>
                  <small>{monitor.baseUrl} · {monitor.enabled ? "enabled" : "paused"} · {monitor.latestSampledAt ? relativeTime(monitor.latestSampledAt) : "never sampled"}</small>
                  {monitor.latestError ? <small className="drawer-check-error">{monitor.latestError}</small> : null}
                </span>
                <span className="host-monitor-stats">
                  <i>CPU {formatPercent(monitor.latestCpuPercent)}</i>
                  <i>RAM {formatPercent(monitor.latestMemoryPercent)}</i>
                  <i>NET {formatByteRate(((monitor.latestNetworkRxBytesPerSec ?? 0) + (monitor.latestNetworkTxBytesPerSec ?? 0)) || null)}</i>
                </span>
                <button className="icon-button" type="button" title="Test connection" disabled={testingHostId === monitor.id} onClick={() => void testHostMonitor(monitor)}>
                  {testingHostId === monitor.id ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
                </button>
                <button className="icon-button" type="button" title={monitor.enabled ? "Pause" : "Resume"} onClick={() => void patchHostMonitor(monitor, { enabled: !monitor.enabled })}>
                  <Activity size={14} style={{ opacity: monitor.enabled ? 1 : 0.45 }} />
                </button>
                <button className="icon-button" type="button" title="Edit" onClick={() => editHostMonitor(monitor)}>
                  <Gauge size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => void deleteHostMonitor(monitor)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {hostMonitors.length === 0 ? <p className="muted-copy">No host monitors configured.</p> : null}
          </div>
        </section>

        <section className="table-panel settings-wide-panel">
          <h3><ShieldCheck size={16} /> OPNsense integration</h3>
          <p className="muted-copy">
            Read-only API polling is configured with environment variables. API keys are never stored in SQLite.
          </p>
          <div className="key-value-grid runtime-key-grid integration-config-grid">
            <span><span>Enabled</span><strong>{runtime?.integrations.opnsense.enabled ? "yes" : "no"}</strong></span>
            <span><span>Configured</span><strong>{runtime?.integrations.opnsense.configured ? "ready" : "missing env"}</strong></span>
            <span><span>Firewall</span><strong>{runtime?.integrations.opnsense.name ?? "OPNsense"}</strong></span>
            <span><span>Base URL</span><strong>{runtime?.integrations.opnsense.baseUrl ?? "not set"}</strong></span>
            <span><span>TLS verify</span><strong>{runtime?.integrations.opnsense.tlsVerify === false ? "disabled" : "enabled"}</strong></span>
            <span><span>Poll interval</span><strong>{runtime?.integrations.opnsense.pollIntervalSeconds ?? "—"}s</strong></span>
          </div>

          <div className="host-monitor-list integration-source-list">
            {opnsenseSources.map((source) => {
              const opnsense = source.latestSnapshot?.provider === "opnsense" ? source.latestSnapshot : null;
              const gatewayTotal = opnsense?.gateways.length ?? 0;
              const gatewayOnline = opnsense?.gateways.filter((gateway) => gateway.status === "online").length ?? 0;
              const traffic = opnsense?.interfaces.reduce(
                (sum, item) => sum + (item.receivedBytesPerSec ?? 0) + (item.sentBytesPerSec ?? 0),
                0
              ) ?? 0;

              return (
                <div className={`host-monitor-row host-${source.status}`} key={source.id}>
                  <span className={`svc-dot dot-${source.status}`} />
                  <span>
                    <strong>{source.name}</strong>
                    <small>{source.baseUrl} · {source.enabled ? "enabled" : "paused"} · {source.latestSampledAt ? relativeTime(source.latestSampledAt) : "never sampled"}</small>
                    {source.latestError ? <small className="drawer-check-error">{source.latestError}</small> : null}
                  </span>
                  <span className="host-monitor-stats">
                    {opnsense ? <><i>CPU {formatPercent(opnsense.system.cpuPercent)}</i><i>GW {gatewayOnline}/{gatewayTotal}</i><i>NET {formatByteRate(traffic || null)}</i></> : null}
                  </span>
                  <button className="icon-button" type="button" title="Test connection" disabled={testingIntegrationId === source.id} onClick={() => void testIntegration(source)}>
                    {testingIntegrationId === source.id ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
                  </button>
                </div>
              );
            })}
            {opnsenseSources.length === 0 ? <p className="muted-copy">Set `OPNSENSE_ENABLED=true`, `OPNSENSE_BASE_URL`, `OPNSENSE_API_KEY`, and `OPNSENSE_API_SECRET` to enable polling.</p> : null}
          </div>
        </section>

        <section className="table-panel settings-wide-panel">
          <h3><Sparkles size={16} /> AI briefing</h3>
          <p className="muted-copy">
            Read-only command briefings use sanitized dashboard evidence. Provider secrets stay in environment variables.
          </p>
          <div className="key-value-grid runtime-key-grid integration-config-grid">
            <span><span>Enabled</span><strong>{runtime?.ai.enabled ? "yes" : "no"}</strong></span>
            <span><span>Configured</span><strong>{runtime?.ai.configured ? "ready" : "missing env"}</strong></span>
            <span><span>Provider</span><strong>{runtime?.ai.providerName ?? "AI"}</strong></span>
            <span><span>Base URL</span><strong>{runtime?.ai.baseUrl ?? "not set"}</strong></span>
            <span><span>Model</span><strong>{runtime?.ai.model ?? "not set"}</strong></span>
            <span><span>API key</span><strong>{runtime?.ai.apiKeyConfigured ? "set" : "not set"}</strong></span>
            <span><span>TLS verify</span><strong>{runtime?.ai.tlsVerify === false ? "disabled" : "enabled"}</strong></span>
            <span><span>Briefing interval</span><strong>{runtime?.ai.briefingIntervalSeconds ?? "—"}s</strong></span>
            <span><span>Include targets</span><strong>{runtime?.ai.includeTargets ? "yes" : "no"}</strong></span>
            <span><span>Last briefing</span><strong>{runtime?.ai.lastGeneratedAt ? relativeTime(runtime.ai.lastGeneratedAt) : "never"}</strong></span>
          </div>
          {runtime?.ai.lastError ? <p className="drawer-check-error">{runtime.ai.lastError}</p> : null}
          <div className="settings-actions">
            <button
              className="icon-text-button"
              type="button"
              disabled={!runtime?.ai.configured || runningAiBriefing || submitting}
              onClick={() => void runAiBriefing()}
            >
              <RefreshCw size={16} className={runningAiBriefing ? "spin" : ""} /> Run briefing
            </button>
          </div>
        </section>

        <section className="table-panel settings-wide-panel">
          <h3><PanelsTopLeft size={16} /> API widgets</h3>
          {apiWidgetSuggestions.length > 0 ? (
            <div className="host-monitor-list api-widget-suggestion-list">
              {apiWidgetSuggestions.slice(0, 8).map((suggestion) => (
                <div className="host-monitor-row" key={suggestion.id}>
                  <span className="host-icon api-widget-icon"><PanelsTopLeft size={16} /></span>
                  <span>
                    <strong>{suggestion.resourceName}</strong>
                    <small>{suggestion.app} · {suggestion.baseUrl}{suggestion.endpointPath} · {suggestion.reason}</small>
                  </span>
                  <span className="host-monitor-stats">
                    <i>{suggestion.authType === "none" ? "No auth" : suggestion.authEnvVarHint ?? suggestion.authType}</i>
                    <i>{suggestion.templateName}</i>
                  </span>
                  <button
                    className="icon-button"
                    type="button"
                    title="Add API widget"
                    disabled={addingWidgetSuggestionId === suggestion.id || submitting}
                    onClick={() => void createSuggestedApiWidget(suggestion)}
                  >
                    {addingWidgetSuggestionId === suggestion.id ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <form className="inline-form settings-form-grid api-widget-form" onSubmit={saveApiWidget}>
            <label>
              Template
              <select
                value={widgetForm.templateId}
                onChange={(event) => applyWidgetTemplate(event.target.value)}
              >
                {apiWidgetTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input
                value={widgetForm.name}
                onChange={(event) => setWidgetForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Home Assistant, Proxmox, Grafana"
                required
              />
            </label>
            <label>
              Base URL
              <input
                value={widgetForm.baseUrl}
                onChange={(event) => setWidgetForm((current) => ({
                  ...current,
                  baseUrl: event.target.value,
                  confirmSecretOrigin: false
                }))}
                placeholder="https://service.lab.local"
                required
              />
            </label>
            <label>
              Endpoint
              <input
                value={widgetForm.endpointPath}
                onChange={(event) => setWidgetForm((current) => ({ ...current, endpointPath: event.target.value }))}
                placeholder="/api/health"
                required
              />
            </label>
            <label>
              Auth
              <select
                value={widgetForm.authType}
                onChange={(event) => setWidgetForm((current) => ({
                  ...current,
                  authType: event.target.value as ApiWidgetDto["authType"],
                  confirmSecretOrigin: false
                }))}
              >
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
                <option value="header">Header</option>
                <option value="basic">Basic</option>
                <option value="pihole">Pi-hole v6</option>
              </select>
            </label>
            <label>
              Header
              <input
                value={widgetForm.authHeaderName}
                onChange={(event) => setWidgetForm((current) => ({ ...current, authHeaderName: event.target.value }))}
                placeholder="Authorization, X-Api-Key"
              />
            </label>
            <label>
              Env var
              <input
                value={widgetForm.authEnvVar}
                onChange={(event) => setWidgetForm((current) => ({
                  ...current,
                  authEnvVar: event.target.value.toUpperCase(),
                  confirmSecretOrigin: false
                }))}
                placeholder="HOME_ASSISTANT_TOKEN"
              />
            </label>
            <label>
              Prefix
              <input
                value={widgetForm.authValuePrefix}
                onChange={(event) => setWidgetForm((current) => ({ ...current, authValuePrefix: event.target.value }))}
                placeholder="PVEAPIToken "
              />
            </label>
            <label>
              Poll seconds
              <input
                type="number"
                min={15}
                max={86400}
                value={widgetForm.pollIntervalSeconds}
                onChange={(event) => setWidgetForm((current) => ({ ...current, pollIntervalSeconds: event.target.value }))}
                required
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={widgetForm.tlsVerify}
                onChange={(event) => setWidgetForm((current) => ({ ...current, tlsVerify: event.target.checked }))}
              />
              Verify TLS
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={widgetForm.enabled}
                onChange={(event) => setWidgetForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
              Enabled
            </label>
            {widgetForm.authType !== "none" ? (
              <label className="checkbox-row api-widget-mapping-field">
                <input
                  type="checkbox"
                  checked={widgetForm.confirmSecretOrigin}
                  onChange={(event) => setWidgetForm((current) => ({
                    ...current,
                    confirmSecretOrigin: event.target.checked
                  }))}
                />
                Send credentials only to {normalizedOrigin(widgetForm.baseUrl) ?? "a valid HTTPS origin"}
              </label>
            ) : null}
            <label className="api-widget-mapping-field">
              Field mappings
              <textarea
                value={widgetForm.fieldMappings}
                onChange={(event) => setWidgetForm((current) => ({ ...current, fieldMappings: event.target.value }))}
                rows={8}
                spellCheck={false}
              />
            </label>
            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={submitting}>
                <Save size={15} /> {widgetForm.id ? "Update widget" : "Add widget"}
              </button>
              {widgetForm.id ? (
                <button className="icon-text-button" type="button" onClick={() => setWidgetForm(emptyApiWidgetForm)}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <div className="host-monitor-list api-widget-list">
            {apiWidgets.map((widget) => (
              <div className={`host-monitor-row host-${widget.latestStatus}`} key={widget.id}>
                <span className={`svc-dot dot-${widget.latestStatus}`} />
                <span>
                  <strong>{widget.name}</strong>
                  <small>{widget.templateId} · {widget.baseUrl}{widget.endpointPath} · {widget.enabled ? "enabled" : "paused"} · {widget.latestSampledAt ? relativeTime(widget.latestSampledAt) : "never sampled"}</small>
                  {widget.latestError ? <small className="drawer-check-error">{widget.latestError}</small> : null}
                </span>
                <span className="host-monitor-stats">
                  {(widget.latestSnapshot?.fields ?? []).slice(0, 3).map((field) => (
                    <i key={field.label}>{field.label} {field.value}{field.suffix ?? ""}</i>
                  ))}
                </span>
                <button className="icon-button" type="button" title="Test widget" disabled={testingWidgetId === widget.id} onClick={() => void testApiWidget(widget)}>
                  {testingWidgetId === widget.id ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
                </button>
                <button className="icon-button" type="button" title={widget.enabled ? "Pause" : "Resume"} onClick={() => void patchApiWidget(widget, { enabled: !widget.enabled })}>
                  <Activity size={14} style={{ opacity: widget.enabled ? 1 : 0.45 }} />
                </button>
                <button className="icon-button" type="button" title="Edit" onClick={() => editApiWidget(widget)}>
                  <Gauge size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => void deleteApiWidget(widget)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {apiWidgets.length === 0 ? <p className="muted-copy">No API widgets configured.</p> : null}
          </div>
        </section>

        <section className="table-panel">
          <h3><RefreshCw size={16} /> Account</h3>
          <div className="key-value-grid">
            <span><span>Username</span><strong>{username}</strong></span>
            <span><span>Auth</span><strong>{authSource === "env" ? "Server env (ADMIN_PASSWORD)" : "Database"}</strong></span>
          </div>
          {authSource === "database" ? (
            <form className="inline-form settings-form-grid" onSubmit={changePassword}>
              <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
              <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={12} /></label>
              <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={12} /></label>
              <button className="primary-button" type="submit" disabled={submitting}><Save size={15} /> Update password</button>
            </form>
          ) : (
            <p className="muted-copy">Password is set via <code>ADMIN_PASSWORD</code> in docker-compose. Change it there and restart the container.</p>
          )}
        </section>

        <section className="table-panel">
          <h3><Film size={16} /> Credits</h3>
          <a className="tmdb-credit" href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
            <img src="/tmdb-logo.svg" alt="TMDB" />
          </a>
          <p className="muted-copy">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        </section>

        <section className="table-panel">
          <h3><Gauge size={16} /> Data &amp; system</h3>
          <form className="inline-form settings-form-grid" onSubmit={updateSettings}>
            <label>
              Auto ping interval (seconds)
              <input
                type="number"
                min={15}
                max={86400}
                value={autoPingIntervalSeconds}
                onChange={(event) => setAutoPingIntervalSeconds(event.target.value)}
                required
              />
            </label>
            <button className="primary-button" type="submit" disabled={submitting}>Update interval</button>
          </form>
          <div className="settings-actions">
            <button className="icon-text-button" type="button" onClick={() => void onRefresh()}>
              <RefreshCw size={16} /> Sync all data
            </button>
            {runtime?.security.publicStatusMode !== "disabled" ? (
              <button
                className="icon-text-button"
                type="button"
                onClick={() => window.open("/status", "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={16} /> Public status page
              </button>
            ) : (
              <span className="muted-copy">Public status is disabled by deployment policy.</span>
            )}
          </div>
        </section>

        <section className="table-panel settings-wide-panel">
          <h3><Gauge size={16} /> Runtime Health</h3>
          {runtime ? (
            <>
              <div className="key-value-grid runtime-key-grid">
                <span><span>Version</span><strong>v{runtime.build.version} · {runtime.build.gitSha}</strong></span>
                <span><span>Started</span><strong>{relativeTime(runtime.process.startedAt)}</strong></span>
                <span><span>Uptime</span><strong>{formatUptimeSeconds(runtime.process.uptimeSeconds)}</strong></span>
                <span><span>Node</span><strong>{runtime.process.nodeVersion}</strong></span>
                <span><span>Listen</span><strong>{runtime.process.host}:{runtime.process.port}</strong></span>
                <span><span>Database</span><strong>{runtime.database.ok ? runtime.database.url : "unavailable"}</strong></span>
                <span><span>App origin</span><strong>{runtime.security.appOrigin ?? "development mode"}</strong></span>
                <span><span>Session</span><strong>{runtime.auth.sessionMaxAgeHours}h · {runtime.auth.cookieSecure ? "secure cookie" : "HTTP cookie"}</strong></span>
                <span><span>Public status</span><strong>{runtime.security.publicStatusMode}</strong></span>
                <span><span>Outbound policy</span><strong>{runtime.security.outboundPolicy.configured ? `${runtime.security.outboundPolicy.allowedCidrCount} CIDR · ${runtime.security.outboundPolicy.allowedHostCount} hosts` : "not configured"}</strong></span>
              </div>
              {runtime.security.readinessWarnings.length > 0 ? (
                <div className="form-error" role="status">
                  <strong>Security readiness</strong>
                  <ul>
                    {runtime.security.readinessWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              ) : null}

              <div className="runtime-count-grid">
                <span><small>Services</small><strong>{runtime.database.counts.resources}</strong></span>
                <span><small>Checks</small><strong>{runtime.database.counts.healthChecks}</strong></span>
                <span><small>Results</small><strong>{runtime.database.counts.healthResults}</strong></span>
                <span><small>Hosts</small><strong>{runtime.database.counts.hostMonitors}</strong></span>
                <span><small>Samples</small><strong>{runtime.database.counts.hostMetricSamples}</strong></span>
                <span><small>Integrations</small><strong>{runtime.database.counts.integrationSources}</strong></span>
                <span><small>Int samples</small><strong>{runtime.database.counts.integrationSamples}</strong></span>
                <span><small>API widgets</small><strong>{runtime.database.counts.apiWidgets}</strong></span>
                <span><small>Widget samples</small><strong>{runtime.database.counts.apiWidgetSamples}</strong></span>
              </div>

              <div className="scheduler-runtime-grid">
                <SchedulerRuntimeCard label="Health checks" state={runtime.schedulers.health} />
                <SchedulerRuntimeCard label="Host metrics" state={runtime.schedulers.metrics} />
                <SchedulerRuntimeCard label="Integrations" state={runtime.schedulers.integrations} />
                <SchedulerRuntimeCard label="TrueNAS" state={runtime.schedulers.truenas} />
                <SchedulerRuntimeCard label="API widgets" state={runtime.schedulers.apiWidgets} />
                <SchedulerRuntimeCard label="AI briefing" state={runtime.schedulers.ai} />
              </div>

              <div className="runtime-command-grid">
                <code>docker logs --tail=200 homelab-dashboard</code>
                <button className="icon-button" type="button" title="Copy logs command" onClick={() => void copyText("docker logs --tail=200 homelab-dashboard")}>
                  <Clipboard size={14} />
                </button>
                <code>docker compose ps && docker compose logs --tail=200 dashboard</code>
                <button className="icon-button" type="button" title="Copy compose command" onClick={() => void copyText("docker compose ps && docker compose logs --tail=200 dashboard")}>
                  <Clipboard size={14} />
                </button>
              </div>
            </>
          ) : (
            <p className="muted-copy">{runtimeLoading ? "Loading runtime health..." : "Runtime health is not loaded."}</p>
          )}
          <div className="settings-actions">
            <button className="icon-text-button" type="button" onClick={() => {
              void loadRuntime().catch((loadError) => setActionError(loadError instanceof Error ? loadError.message : "Runtime refresh failed"));
            }} disabled={runtimeLoading}>
              <RefreshCw size={16} className={runtimeLoading ? "spin" : ""} /> Refresh runtime
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
