import { Gauge, LayoutDashboard, Server, Settings, Shield } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { AppSidebar } from "./components/AppSidebar";
import { BuildBadge } from "./components/BuildBadge";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { InlineSpinner } from "./components/Primitives";
import { DashboardConsole } from "./features/dashboard/DashboardConsole";
import { ServicesView } from "./features/services/ServicesView";
import { emptyAppData, type AppData, type AppView } from "./features/types";
import { SettingsView } from "./features/settings/SettingsView";
import { apiGet, apiSend, type SystemSettingsDto } from "./lib/api";
import { useAppChrome } from "./lib/appChrome";
import { statusFor } from "./lib/format";
import type { DashboardResource } from "../shared/types";
import type { DashboardDto, HealthCheckDto } from "./lib/api";

const navItems: Array<{ id: AppView; label: string; icon: React.ReactNode }> = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { id: "services", label: "Services", icon: <Server size={18} /> },
  { id: "settings", label: "Admin", icon: <Settings size={18} /> }
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
      <div className="login-orb login-orb-a" aria-hidden />
      <div className="login-orb login-orb-b" aria-hidden />
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-lock">
          <span className="brand-mark"><Gauge size={22} /></span>
          <div>
            <h1>Homelab</h1>
            <span>Service dashboard</span>
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
          {submitting ? <InlineSpinner size={16} /> : <Shield size={16} />} {submitting ? "Unlocking…" : "Unlock"}
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
      if (!username) {
        setLocalError("Please choose a username.");
        return;
      }
      if (!password) {
        setLocalError("Please set a password.");
        return;
      }
      if (password !== confirm) {
        setLocalError("Passwords do not match.");
        return;
      }
      if (password.length < 6) {
        setLocalError("Password must be at least 6 characters.");
        return;
      }
    }

    setLocalError(null);
    onComplete(needsAccount ? username : null, needsAccount ? password : null, withDemo);
  }

  return (
    <main className="login-shell">
      <div className="login-orb login-orb-a" aria-hidden />
      <div className="login-orb login-orb-b" aria-hidden />
      <div className="setup-panel">
        <div className="brand-lock">
          <span className="brand-mark"><Gauge size={22} /></span>
          <div>
            <h1>Homelab</h1>
            <span>First-run setup</span>
          </div>
        </div>

        {needsAccount ? (
          <>
            <p className="setup-description">Create the admin account for this dashboard.</p>
            <label>
              Username
              <input
                type="text"
                autoFocus
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
                placeholder="Minimum 6 characters"
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Repeat password"
              />
            </label>
          </>
        ) : null}

        <label className="toggle-row" onClick={() => setWithDemo((value) => !value)}>
          <span className={`toggle-track ${withDemo ? "is-on" : ""}`}>
            <span className="toggle-thumb" />
          </span>
          <span>
            <strong>Load demo data</strong>
            <small>Sample services and health checks for a quick first look</small>
          </span>
        </label>

        {(error ?? localError) ? <p className="form-error">{error ?? localError}</p> : null}

        <button className="primary-button" type="button" disabled={loading} onClick={submit}>
          {loading ? <InlineSpinner size={16} /> : <Gauge size={16} />} {loading ? "Starting…" : "Get started"}
        </button>
      </div>
    </main>
  );
}

function deriveAppData(dashboard: DashboardDto): AppData {
  const resources = [
    ...dashboard.groups.flatMap((group) => group.resources),
    ...dashboard.ungroupedResources
  ];
  const checks = resources.flatMap((resource) =>
    (resource.healthChecks ?? []).map((check) => ({ ...check, resource }))
  );

  return {
    dashboard,
    resources,
    groups: dashboard.groups,
    checks
  };
}

function applyLocalOrder(current: AppData, orderedIds: string[]): AppData {
  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));

  function sortList(list: DashboardResource[]): DashboardResource[] {
    if (!list.some((resource) => orderIndex.has(resource.id))) {
      return list;
    }
    return [...list].sort(
      (left, right) => (orderIndex.get(left.id) ?? 0) - (orderIndex.get(right.id) ?? 0)
    );
  }

  const dashboard = {
    ...current.dashboard,
    groups: current.dashboard.groups.map((group) => ({ ...group, resources: sortList(group.resources) })),
    ungroupedResources: sortList(current.dashboard.ungroupedResources)
  };

  return deriveAppData(dashboard);
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [setupStatus, setSetupStatus] = useState<{ firstRun: boolean; needsAccount: boolean } | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("dashboard");
  const [data, setData] = useState<AppData>(emptyAppData);
  const [systemSettings, setSystemSettings] = useState<SystemSettingsDto>({ autoPingIntervalSeconds: 60 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("admin");
  const [authSource, setAuthSource] = useState<"env" | "database">("database");
  const { theme, toggleTheme, sidebarMode, cycleSidebar } = useAppChrome();
  const [openAddServiceForm, setOpenAddServiceForm] = useState(false);
  const [editServiceId, setEditServiceId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const dashboard = await apiGet<DashboardDto>("/api/dashboard");
      setData(deriveAppData(dashboard));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadSystemSettings() {
    const settings = await apiGet<SystemSettingsDto>("/api/settings");
    setSystemSettings(settings);
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
      await Promise.all([loadData(), loadSystemSettings()]);
    }
  }

  async function completeSetup(usernameInput: string | null, password: string | null, withDemo: boolean) {
    setSetupLoading(true);
    setSetupError(null);

    try {
      await apiSend("/api/setup", "POST", {
        username: usernameInput ?? undefined,
        password: password ?? undefined,
        seedDemo: withDemo
      });
      setSetupStatus(null);
    } catch (setupError) {
      setSetupError(setupError instanceof Error ? setupError.message : "Setup failed");
      setSetupLoading(false);
      return;
    }

    if (password) {
      try {
        await apiSend("/api/auth/login", "POST", {
          username: usernameInput ?? undefined,
          password
        });
      } catch {
        // continue; checkAuth below handles this path if login fails
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
      return;
    }

    const timer = setInterval(() => {
      void loadData();
    }, 30000);

    function onFocus() {
      void loadData();
    }

    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [authenticated]);

  const offlineCount = useMemo(
    () => data.resources.filter((resource) => statusFor(resource) === "offline").length,
    [data.resources]
  );

  useEffect(() => {
    document.title = offlineCount > 0 ? `(${offlineCount} down) Homelab` : "Homelab Dashboard";
  }, [offlineCount]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
      if (typing || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key.toLowerCase() === "r") {
        void loadData();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function logout() {
    await apiSend("/api/auth/logout", "POST");
    setAuthenticated(false);
  }

  async function patchResource(id: string, body: Record<string, unknown>) {
    if (typeof body.favorite === "boolean") {
      setData((current) => {
        const isFavorite = body.favorite as boolean;
        const dashboard = {
          ...current.dashboard,
          groups: current.dashboard.groups.map((group) => ({
            ...group,
            resources: group.resources.map((resource) =>
              resource.id === id ? { ...resource, favorite: isFavorite } : resource
            )
          })),
          ungroupedResources: current.dashboard.ungroupedResources.map((resource) =>
            resource.id === id ? { ...resource, favorite: isFavorite } : resource
          )
        };

        return deriveAppData(dashboard);
      });
    }

    await apiSend(`/api/resources/${id}`, "PATCH", body);
    await loadData();
  }

  async function patchGroup(id: string, body: Record<string, unknown>) {
    await apiSend(`/api/groups/${id}`, "PATCH", body);
    await loadData();
  }

  async function reorderResources(orderedIds: string[]) {
    setData((current) => applyLocalOrder(current, orderedIds));
    await apiSend("/api/resources/reorder", "POST", { ids: orderedIds });
    await loadData();
  }

  async function patchSystemSettings(next: SystemSettingsDto) {
    await apiSend("/api/settings", "PATCH", next);
    await loadSystemSettings();
  }

  function openServicesForCreate() {
    setView("services");
    setOpenAddServiceForm(true);
  }

  function openSettings() {
    setView("settings");
  }

  function openServicesForEdit(resource: DashboardResource) {
    setEditServiceId(resource.id);
    setView("services");
  }

  async function runResourceHealthCheck(resource: DashboardResource) {
    if (resource.monitoringMode !== "auto") {
      throw new Error("Set this service to automatic monitoring before running checks.");
    }

    let checkId = resource.healthChecks?.[0]?.id;

    if (!checkId) {
      const url = resource.url?.trim();
      const host = resource.host?.trim();
      const target = url
        ? (/^https?:\/\//i.test(url) ? url : `http://${url}`)
        : host;

      if (!target) {
        throw new Error("Add a URL or host before running a health check.");
      }

      const created = await apiSend<HealthCheckDto>("/api/health-checks", "POST", {
        resourceId: resource.id,
        type: url ? "http" : "ping",
        target,
        intervalSeconds: systemSettings.autoPingIntervalSeconds,
        timeoutMs: 3000,
        failureThreshold: 1,
        successThreshold: 1,
        enabled: true
      });
      checkId = created.id;
    }

    await apiSend(`/api/health-checks/${checkId}/run`, "POST");
    await loadData();
  }

  const paletteCommands: PaletteCommand[] = [
    { id: "nav-dashboard", label: "Go to Dashboard", run: () => setView("dashboard") },
    { id: "nav-services", label: "Go to Services", run: () => setView("services") },
    { id: "nav-admin", label: "Go to Admin", run: () => setView("settings") },
    { id: "add-service", label: "Add a service", run: openServicesForCreate },
    { id: "add-host-monitor", label: "Add a host monitor", run: openSettings },
    { id: "refresh", label: "Refresh data", hint: "R", run: () => void loadData() },
    {
      id: "theme",
      label: `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
      run: toggleTheme
    },
    {
      id: "status-page",
      label: "Open public status page",
      run: () => window.open("/status", "_blank", "noopener,noreferrer")
    }
  ];

  if (authenticated === null || setupStatus === null) {
    return <div className="loading-screen">Loading</div>;
  }

  if (setupStatus.needsAccount) {
    return (
      <SetupScreen
        loading={setupLoading}
        error={setupError}
        needsAccount
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
        onNavigate={(target) => {
          setView(target);
          if (target !== "services") {
            setOpenAddServiceForm(false);
          }
        }}
        sidebarMode={sidebarMode}
        onCycleSidebar={cycleSidebar}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenPalette={() => setPaletteOpen(true)}
        onLogout={() => void logout()}
      />

      <div className="content-shell">
        <div className="workspace-scroll">
          {error ? <div className="app-error">{error}</div> : null}
          {loading ? <div className="loading-strip"><InlineSpinner size={12} /> Syncing</div> : null}

          {view === "dashboard" ? (
            <DashboardConsole
              data={data}
              username={username}
              onRefresh={loadData}
              onPatchResource={patchResource}
              onRunCheck={runResourceHealthCheck}
              onPatchGroup={patchGroup}
              onOpenServices={openServicesForCreate}
              onOpenSettings={openSettings}
              onEditService={openServicesForEdit}
              onReorder={reorderResources}
            />
          ) : null}

          {view === "services" ? (
            <ServicesView
              data={data}
              onRefresh={loadData}
              autoPingIntervalSeconds={systemSettings.autoPingIntervalSeconds}
              openAddServiceForm={openAddServiceForm}
              onOpenAddServiceFormHandled={() => setOpenAddServiceForm(false)}
              editServiceId={editServiceId}
              onEditServiceHandled={() => setEditServiceId(null)}
            />
          ) : null}

          {view === "settings" ? (
            <SettingsView
              username={username}
              authSource={authSource}
              onRefresh={loadData}
              systemSettings={systemSettings}
              onSaveSettings={patchSystemSettings}
            />
          ) : null}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        resources={data.resources}
        commands={paletteCommands}
        onLaunch={(resource) => {
          if (resource.url) {
            window.open(resource.url, "_blank", "noopener,noreferrer");
          } else {
            setView("dashboard");
          }
        }}
      />
    </div>
  );
}
