import {
  Activity,
  Bell,
  Gauge,
  Home,
  Plus,
  RefreshCw,
  Server,
  Shield
} from "lucide-react";
import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { AppSidebar, adminNavItem } from "./components/AppSidebar";
import { InlineSpinner } from "./components/Primitives";
import { CommandPalette } from "./components/CommandPalette";
import { BuildBadge } from "./components/BuildBadge";
import { DetailDrawer, type DrawerState } from "./components/DetailDrawer";
import { KeyboardHelp } from "./components/KeyboardHelp";
import { AlertsView } from "./features/alerts/AlertsView";
import { DashboardConsole } from "./features/dashboard/DashboardConsole";
import { ServicesView, type ServiceTab } from "./features/services/ServicesView";
import { MonitoringCenter } from "./features/monitoring/MonitoringCenter";
import { emptyV2Data, type AppView, type V2Data } from "./features/types";
import { SettingsView } from "./features/settings/SettingsView";
import {
  apiGet,
  apiSend,
  type AlertChannelDto,
  type AlertDeliveryDto,
  type AlertRuleDto,
  type DashboardDto,
  type DashboardWidgetDto,
  type HealthCheckDto,
  type IncidentDto,
  type MaintenanceWindowDto,
  type NoteDto,
  type SearchResultDto,
  type TagDto
} from "./lib/api";
import { formatDateTime } from "./lib/format";
import { useAppChrome } from "./lib/appChrome";
import type { DashboardGroupDto, DashboardResource } from "../shared/types";

const navItems: Array<{ id: AppView; label: string; icon: ReactNode }> = [
  { id: "dashboard", label: "Dashboard", icon: <Home size={18} /> },
  { id: "monitoring", label: "Monitoring", icon: <Activity size={18} /> },
  { id: "alerts", label: "Alerts", icon: <Bell size={18} /> },
  { id: "services", label: "Services", icon: <Server size={18} /> },
  adminNavItem()
];

function LoginView({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await apiSend("/api/auth/login", "POST", { username: username || undefined, password });
      onLogin();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-lock">
          <Shield size={28} />
          <div>
            <h1>Homelab Dashboard</h1>
            <span>Admin panel</span>
          </div>
        </div>
        <label>
          Username
          <input
            autoFocus
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="admin"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? <InlineSpinner size={16} /> : <Shield size={16} />}
          {submitting ? "Unlocking…" : "Unlock"}
        </button>
        <BuildBadge className="login-build-badge" />
      </form>
    </main>
  );
}

function SetupScreen({
  loading,
  error,
  needsAccount,
  onComplete
}: {
  loading: boolean;
  error: string | null;
  needsAccount: boolean;
  onComplete: (username: string | null, password: string | null, withDemo: boolean) => void;
}) {
  const [withDemo, setWithDemo] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit() {
    if (needsAccount) {
      if (!username) { setLocalError("Please choose a username."); return; }
      if (!password) { setLocalError("Please set a password."); return; }
      if (password !== confirm) { setLocalError("Passwords do not match."); return; }
      if (password.length < 6) { setLocalError("Password must be at least 6 characters."); return; }
    }
    setLocalError(null);
    onComplete(needsAccount ? username : null, needsAccount ? password : null, withDemo);
  }

  const displayError = localError ?? error;

  return (
    <main className="login-shell">
      <div className="setup-panel">
        <div className="brand-lock">
          <Gauge size={28} />
          <div>
            <h1>Homelab Dashboard</h1>
            <span>First-run setup</span>
          </div>
        </div>

        {needsAccount ? (
          <>
            <p className="setup-description">Create the admin account you'll use to log in.</p>
            <label>
              Username
              <input
                type="text"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. admin"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 6 characters"
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
              />
            </label>
          </>
        ) : null}

        <div className="toggle-row" onClick={() => setWithDemo((v) => !v)}>
          <span className={`toggle-track ${withDemo ? "is-on" : ""}`}>
            <span className="toggle-thumb" />
          </span>
          <span>
            <strong>Load demo data</strong>
            <small>
              Sample resources, health checks, an open incident, and a pinned note
            </small>
          </span>
        </div>

        {displayError ? <p className="form-error">{displayError}</p> : null}

        <button
          className="primary-button"
          type="button"
          disabled={loading}
          onClick={submit}
        >
          {loading ? <RefreshCw className="spin" size={16} /> : <Gauge size={16} />}
          {loading ? (withDemo ? "Loading demo data…" : "Setting up…") : "Get started"}
        </button>
      </div>
    </main>
  );
}

function DrawerBody({ rows }: { rows: Array<[string, string | number | null | undefined]> }) {
  return (
    <div className="key-value-grid">
      {rows.map(([label, value]) => (
        <span key={label}>
          <span>{label}</span>
          <strong>{value ?? "-"}</strong>
        </span>
      ))}
    </div>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [setupStatus, setSetupStatus] = useState<{ firstRun: boolean; needsAccount: boolean } | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("dashboard");
  const [data, setData] = useState<V2Data>(emptyV2Data);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const [serviceTab, setServiceTab] = useState<ServiceTab>("resource");
  const [username, setUsername] = useState("admin");
  const [authSource, setAuthSource] = useState<"env" | "database">("database");
  const { theme, toggleTheme, sidebarMode, cycleSidebar } = useAppChrome();

  const openIncidentMap = useMemo(
    () => new Map(data.incidents.map((incident) => [incident.id, incident])),
    [data.incidents]
  );

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const [
        dashboard,
        resources,
        groups,
        checks,
        widgets,
        incidents,
        tags,
        alertChannels,
        alertRules,
        alertDeliveries,
        maintenanceWindows,
        notes
      ] = await Promise.all([
        apiGet<DashboardDto>("/api/dashboard"),
        apiGet<DashboardResource[]>("/api/resources"),
        apiGet<DashboardGroupDto[]>("/api/groups"),
        apiGet<HealthCheckDto[]>("/api/health-checks"),
        apiGet<DashboardWidgetDto[]>("/api/dashboard/widgets"),
        apiGet<IncidentDto[]>("/api/incidents"),
        apiGet<TagDto[]>("/api/tags"),
        apiGet<AlertChannelDto[]>("/api/alert-channels"),
        apiGet<AlertRuleDto[]>("/api/alert-rules"),
        apiGet<AlertDeliveryDto[]>("/api/alert-deliveries"),
        apiGet<MaintenanceWindowDto[]>("/api/maintenance-windows"),
        apiGet<NoteDto[]>("/api/notes")
      ]);

      setData({
        dashboard,
        resources,
        groups,
        checks,
        widgets,
        incidents,
        tags,
        alertChannels,
        alertRules,
        alertDeliveries,
        maintenanceWindows,
        notes
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function checkAuth() {
    const [me, status] = await Promise.all([
      apiGet<{ authenticated: boolean; username?: string; authSource?: "env" | "database" }>("/api/auth/me"),
      apiGet<{ firstRun: boolean; needsAccount: boolean }>("/api/setup/status")
    ]);
    setAuthenticated(me.authenticated);
    if (me.username) setUsername(me.username);
    if (me.authSource) setAuthSource(me.authSource);
    setSetupStatus(status);
    if (me.authenticated) {
      await loadData();
    }
  }

  async function completeSetup(username: string | null, password: string | null, withDemo: boolean) {
    setSetupLoading(true);
    setSetupError(null);
    try {
      await apiSend("/api/setup", "POST", {
        username: username ?? undefined,
        password: password ?? undefined,
        seedDemo: withDemo
      });
      setSetupStatus(null);
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : "Setup failed");
      setSetupLoading(false);
      return;
    }
    // Auto-login then always call checkAuth to get out of loading state
    if (password) {
      try {
        await apiSend("/api/auth/login", "POST", { username: username ?? undefined, password });
      } catch {
        // auto-login failed — checkAuth below will show login screen
      }
    }
    await checkAuth();
    setSetupLoading(false);
  }

  useEffect(() => {
    void checkAuth();
  }, []);

  useEffect(() => {
    if (!authenticated) {
      return undefined;
    }

    const timer = setInterval(() => {
      void loadData();
    }, 30000);

    return () => clearInterval(timer);
  }, [authenticated]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }

      if (!typing && event.key === "/") {
        event.preventDefault();
        setPaletteOpen(true);
      }

      if (!typing && event.key.toLowerCase() === "r") {
        void loadData();
      }

      if (!typing && event.key.toLowerCase() === "n") {
        setServiceTab("resource");
        setView("services");
      }

      if (!typing && event.key === "?") {
        event.preventDefault();
        setKeyboardHelpOpen(true);
      }

      if (event.key === "Escape") {
        if (paletteOpen) {
          setPaletteOpen(false);
        } else if (keyboardHelpOpen) {
          setKeyboardHelpOpen(false);
        } else {
          setDrawer(null);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardHelpOpen, paletteOpen]);

  async function logout() {
    await apiSend("/api/auth/logout", "POST");
    setAuthenticated(false);
  }

  async function patchResource(id: string, body: Record<string, unknown>) {
    await apiSend(`/api/resources/${id}`, "PATCH", body);
    await loadData();
  }

  async function patchGroup(id: string, body: Record<string, unknown>) {
    await apiSend(`/api/groups/${id}`, "PATCH", body);
    await loadData();
  }

  function inspectResource(resource: DashboardResource) {
    setDrawer({
      type: "resource",
      title: resource.name,
      body: (
        <DrawerBody
          rows={[
            ["Kind", resource.kind],
            ["URL", resource.url],
            ["Host", resource.host],
            ["Favorite", resource.favorite ? "Yes" : "No"],
            ["Notes", resource.notes]
          ]}
        />
      )
    });
  }

  function inspectIncident(incident: IncidentDto) {
    setDrawer({
      type: "incident",
      title: incident.title,
      body: (
        <DrawerBody
          rows={[
            ["Status", incident.status],
            ["Severity", incident.severity],
            ["Opened", formatDateTime(incident.openedAt)],
            ["Acknowledged", formatDateTime(incident.acknowledgedAt)],
            ["Resolved", formatDateTime(incident.resolvedAt)],
            ["Summary", incident.summary]
          ]}
        />
      )
    });
  }

  async function handlePaletteAction(result: SearchResultDto) {
    setPaletteOpen(false);

    if (result.action === "navigate" && typeof result.payload?.view === "string") {
      setView(result.payload.view as AppView);
      return;
    }

    if (result.action === "openUrl" && typeof result.payload?.url === "string") {
      window.open(result.payload.url, "_blank", "noopener,noreferrer");
      return;
    }

    if (result.action === "runCheck" && typeof result.payload?.checkId === "string") {
      await apiSend(`/api/health-checks/${result.payload.checkId}/run`, "POST");
      await loadData();
      setView("monitoring");
      return;
    }

    if (result.action === "openIncident" && typeof result.payload?.incidentId === "string") {
      const incident = openIncidentMap.get(result.payload.incidentId);
      if (incident) {
        inspectIncident(incident);
      }
      setView("monitoring");
      return;
    }
  }

  if (authenticated === null || setupStatus === null) {
    return <div className="loading-screen">Loading</div>;
  }

  // No account exists yet — show account creation before anything else
  if (setupStatus.needsAccount) {
    return (
      <SetupScreen
        loading={setupLoading}
        error={setupError}
        needsAccount={true}
        onComplete={completeSetup}
      />
    );
  }

  if (!authenticated) {
    return <LoginView onLogin={() => void checkAuth()} />;
  }

  if (setupStatus.firstRun) {
    return (
      <SetupScreen
        loading={setupLoading}
        error={setupError}
        needsAccount={false}
        onComplete={completeSetup}
      />
    );
  }

  return (
    <div className={`app-shell pro-shell sidebar-${sidebarMode}`}>
      <AppSidebar
        navItems={navItems}
        view={view}
        onNavigate={setView}
        sidebarMode={sidebarMode}
        onCycleSidebar={cycleSidebar}
        onOpenPalette={() => setPaletteOpen(true)}
        onLogout={logout}
        openIncidents={data.incidents.filter((incident) => incident.status !== "resolved").length}
        failingChecks={data.checks.filter((check) => check.latestStatus === "offline" && check.enabled).length}
      />
      <div className="content-shell">
        <div className="workspace-scroll">
          {error ? <div className="app-error">{error}</div> : null}
          {loading ? <div className="loading-strip"><InlineSpinner size={12} /> Syncing</div> : null}
          {view === "dashboard" ? (
            <DashboardConsole
              data={data}
              onRefresh={loadData}
              onPatchResource={patchResource}
              onPatchGroup={patchGroup}
              onOpenServices={() => { setServiceTab("resource"); setView("services"); }}
              onInspectResource={inspectResource}
              onOpenIncident={(id) => {
                const incident = openIncidentMap.get(id);
                if (incident) {
                  inspectIncident(incident);
                }
              }}
            />
          ) : null}
          {view === "services" ? (
            <ServicesView data={data} onRefresh={loadData} activeTab={serviceTab} onTabChange={setServiceTab} />
          ) : null}
          {view === "monitoring" ? (
            <MonitoringCenter
              data={data}
              onRefresh={loadData}
              onInspectIncident={inspectIncident}
              onOpenServicesChecks={() => { setServiceTab("check"); setView("services"); }}
            />
          ) : null}
          {view === "alerts" ? <AlertsView data={data} onRefresh={loadData} /> : null}
          {view === "settings" ? (
            <SettingsView
              username={username}
              authSource={authSource}
              onRefresh={loadData}
              theme={theme}
              onToggleTheme={toggleTheme}
              onOpenKeyboardHelp={() => setKeyboardHelpOpen(true)}
              onOpenBackup={() => { setServiceTab("backup"); setView("services"); }}
            />
          ) : null}
        </div>
        <DetailDrawer drawer={drawer} onClose={() => setDrawer(null)} />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onAction={handlePaletteAction} />
        <KeyboardHelp open={keyboardHelpOpen} onClose={() => setKeyboardHelpOpen(false)} />
      </div>
    </div>
  );
}
