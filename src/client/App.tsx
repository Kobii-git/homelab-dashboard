import { Gauge, LayoutDashboard, Server, Settings, Shield } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppSidebar } from "./components/AppSidebar";
import { BuildBadge } from "./components/BuildBadge";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { InlineSpinner } from "./components/Primitives";
import { DashboardConsole } from "./features/dashboard/DashboardConsole";
import { ServicesView } from "./features/services/ServicesView";
import { emptyAppData, type AppData, type AppView } from "./features/types";
import { SettingsView } from "./features/settings/SettingsView";
import {
  apiGet,
  apiSend,
  setReauthenticationHandler,
  type SystemSettingsDto
} from "./lib/api";
import { useAppChrome } from "./lib/appChrome";
import { statusFor } from "./lib/format";
import type { DashboardResource } from "../shared/types";
import type { DashboardDto } from "./lib/api";

const defaultSystemSettings: SystemSettingsDto = {
  autoPingIntervalSeconds: 60,
  dashboardUtilities: {
    searchEngine: "duckduckgo",
    weather: { enabled: false, units: "metric", location: null },
    releases: { enabled: false, repositories: [] }
  }
};

const navItems: Array<{ id: AppView; label: string; icon: React.ReactNode }> = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { id: "services", label: "Services", icon: <Server size={18} /> },
  { id: "settings", label: "Admin", icon: <Settings size={18} /> }
];

function LoginView({ onLogin, message }: { onLogin: () => void; message: string | null }) {
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
            autoComplete="username"
            name="username"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            name="password"
          />
        </label>
        {message ? <p className="form-notice" role="status">{message}</p> : null}
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
  needsSetupCode,
  onComplete
}: {
  loading: boolean;
  error: string | null;
  needsAccount: boolean;
  needsSetupCode: boolean;
  onComplete: (username: string | null, password: string | null, setupCode: string | null, withDemo: boolean) => void;
}) {
  const [withDemo, setWithDemo] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
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
      if (password.length < 12) {
        setLocalError("Password must be at least 12 characters.");
        return;
      }
    }
    if (needsSetupCode && !setupCode.trim()) {
      setLocalError("Enter the one-time setup code shown in the server logs.");
      return;
    }

    setLocalError(null);
    onComplete(needsAccount ? username : null, needsAccount ? password : null, needsSetupCode ? setupCode : null, withDemo);
  }

  return (
    <main className="login-shell">
      <div className="login-orb login-orb-a" aria-hidden />
      <div className="login-orb login-orb-b" aria-hidden />
      <form className="setup-panel" onSubmit={submit}>
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
                name="username"
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 12 characters"
                name="password"
                autoComplete="new-password"
                minLength={12}
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Repeat password"
                name="confirmPassword"
                autoComplete="new-password"
                minLength={12}
              />
            </label>
            {needsSetupCode ? (
              <label>
                One-time setup code
                <input
                  type="text"
                  value={setupCode}
                  onChange={(event) => setSetupCode(event.target.value.toUpperCase())}
                  name="setupCode"
                  autoComplete="one-time-code"
                  inputMode="text"
                  maxLength={20}
                  placeholder="Shown in server logs"
                  required
                />
              </label>
            ) : null}
          </>
        ) : null}

        <label className="toggle-row">
          <input
            className="toggle-input"
            type="checkbox"
            checked={withDemo}
            onChange={(event) => setWithDemo(event.target.checked)}
          />
          <span className={`toggle-track ${withDemo ? "is-on" : ""}`} aria-hidden="true">
            <span className="toggle-thumb" />
          </span>
          <span>
            <strong>Load demo data</strong>
            <small>Sample services and health checks for a quick first look</small>
          </span>
        </label>

        {(error ?? localError) ? <p className="form-error">{error ?? localError}</p> : null}

        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? <InlineSpinner size={16} /> : <Gauge size={16} />} {loading ? "Starting…" : "Get started"}
        </button>
      </form>
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
  const [setupStatus, setSetupStatus] = useState<{ firstRun: boolean; needsAccount: boolean; needsSetupCode: boolean } | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("dashboard");
  const [data, setData] = useState<AppData>(emptyAppData);
  const [systemSettings, setSystemSettings] = useState<SystemSettingsDto>(defaultSystemSettings);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const dataReadyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [username, setUsername] = useState("admin");
  const [authSource, setAuthSource] = useState<"env" | "database">("database");
  const { theme, toggleTheme, sidebarMode, cycleSidebar } = useAppChrome();
  const [openAddServiceForm, setOpenAddServiceForm] = useState(false);
  const [addServiceTemplateId, setAddServiceTemplateId] = useState<string | null>(null);
  const [editServiceId, setEditServiceId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthSubmitting, setReauthSubmitting] = useState(false);
  const reauthPromiseRef = useRef<Promise<void> | null>(null);
  const reauthResolveRef = useRef<(() => void) | null>(null);
  const reauthRejectRef = useRef<((error: Error) => void) | null>(null);
  const reauthFocusRef = useRef<HTMLElement | null>(null);

  const requestReauthentication = useCallback((): Promise<void> => {
    if (reauthPromiseRef.current) return reauthPromiseRef.current;
    reauthFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReauthPassword("");
    setReauthError(null);
    setReauthOpen(true);
    const promise = new Promise<void>((resolve, reject) => {
      reauthResolveRef.current = resolve;
      reauthRejectRef.current = reject;
    });
    reauthPromiseRef.current = promise;
    return promise;
  }, []);

  const finishReauthentication = useCallback((error?: Error) => {
    if (error) reauthRejectRef.current?.(error);
    else reauthResolveRef.current?.();
    reauthPromiseRef.current = null;
    reauthResolveRef.current = null;
    reauthRejectRef.current = null;
    setReauthOpen(false);
    setReauthPassword("");
    setReauthError(null);
    window.setTimeout(() => reauthFocusRef.current?.focus(), 0);
  }, []);

  async function submitReauthentication(event: FormEvent) {
    event.preventDefault();
    setReauthSubmitting(true);
    setReauthError(null);
    try {
      await apiSend("/api/auth/reauth", "POST", { password: reauthPassword });
      finishReauthentication();
    } catch (reauthFailure) {
      setReauthError(reauthFailure instanceof Error ? reauthFailure.message : "Password confirmation failed");
    } finally {
      setReauthSubmitting(false);
    }
  }

  useEffect(() => {
    setReauthenticationHandler(requestReauthentication);
    return () => {
      setReauthenticationHandler(null);
      reauthRejectRef.current?.(new Error("Password confirmation was cancelled"));
      reauthPromiseRef.current = null;
    };
  }, [requestReauthentication]);

  useEffect(() => {
    if (!reauthOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !reauthSubmitting) {
        finishReauthentication(new Error("Password confirmation was cancelled"));
        return;
      }
      if (event.key === "Tab") {
        const dialog = document.querySelector<HTMLElement>(".reauth-dialog");
        const focusable = dialog
          ? [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")]
          : [];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finishReauthentication, reauthOpen, reauthSubmitting]);

  async function loadData() {
    const initialLoad = !dataReadyRef.current;
    if (initialLoad) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const dashboard = await apiGet<DashboardDto>("/api/dashboard");
      setData(deriveAppData(dashboard));
      dataReadyRef.current = true;
      setDataReady(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadSystemSettings() {
    const settings = await apiGet<SystemSettingsDto>("/api/settings");
    setSystemSettings(settings);
  }

  async function checkAuth() {
    const [me, status] = await Promise.all([
      apiGet<{ authenticated: boolean; username?: string; authSource?: "env" | "database" }>("/api/auth/me"),
      apiGet<{ firstRun: boolean; needsAccount: boolean; needsSetupCode: boolean }>("/api/setup/status")
    ]);
    setAuthenticated(me.authenticated);
    if (me.username) setUsername(me.username);
    if (me.authSource) setAuthSource(me.authSource);
    setSetupStatus(status);
    if (me.authenticated) {
      await Promise.all([loadData(), loadSystemSettings()]);
    }
  }

  async function completeSetup(usernameInput: string | null, password: string | null, setupCode: string | null, withDemo: boolean) {
    setSetupLoading(true);
    setSetupError(null);

    try {
      await apiSend("/api/setup", "POST", {
        username: usernameInput ?? undefined,
        password: password ?? undefined,
        setupCode: setupCode ?? undefined,
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
    void checkAuth().catch((bootstrapFailure) => {
      setBootstrapError(bootstrapFailure instanceof Error ? bootstrapFailure.message : "The dashboard could not start");
    });
  }, []);

  useEffect(() => {
    function onSessionExpired() {
      setAuthenticated(false);
      setSessionMessage("Your session expired or was invalidated. Sign in again to continue.");
      setPaletteOpen(false);
      setData(emptyAppData);
      dataReadyRef.current = false;
      setDataReady(false);
    }
    function onApiError(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      if (detail) setError(detail);
    }
    window.addEventListener("homelab:session-expired", onSessionExpired);
    window.addEventListener("homelab:api-error", onApiError);
    return () => {
      window.removeEventListener("homelab:session-expired", onSessionExpired);
      window.removeEventListener("homelab:api-error", onApiError);
    };
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
    try {
      await apiSend("/api/auth/logout", "POST");
      setAuthenticated(false);
      setSessionMessage("You have been signed out on all browsers.");
      setData(emptyAppData);
      dataReadyRef.current = false;
      setDataReady(false);
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Logout failed");
    }
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

    try {
      await apiSend(`/api/resources/${id}`, "PATCH", body);
      await loadData();
    } catch (patchError) {
      await loadData();
      setError(patchError instanceof Error ? patchError.message : "Service update failed");
    }
  }

  async function patchGroup(id: string, body: Record<string, unknown>) {
    try {
      await apiSend(`/api/groups/${id}`, "PATCH", body);
      await loadData();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Group update failed");
    }
  }

  async function reorderResources(orderedIds: string[]) {
    setData((current) => applyLocalOrder(current, orderedIds));
    try {
      await apiSend("/api/resources/reorder", "POST", { ids: orderedIds });
      await loadData();
    } catch (reorderError) {
      await loadData();
      setError(reorderError instanceof Error ? reorderError.message : "Reorder failed");
    }
  }

  async function patchSystemSettings(next: Partial<SystemSettingsDto>) {
    setSystemSettings(await apiSend<SystemSettingsDto>("/api/settings", "PATCH", next));
  }

  function openServicesForCreate() {
    setView("services");
    setOpenAddServiceForm(true);
    setAddServiceTemplateId(null);
  }

  function openServicesForTemplate(templateId: string) {
    setOpenAddServiceForm(false);
    setAddServiceTemplateId(templateId);
    setView("services");
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

    await apiSend(`/api/resources/${resource.id}/run`, "POST");
    await loadData();
  }

  function openResource(resource: DashboardResource) {
    if (!resource.url) return;
    try {
      const target = new URL(resource.url, window.location.origin);
      if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Unsafe service URL");
      window.open(target.toString(), "_blank", "noopener,noreferrer");
    } catch {
      setError(`The URL for ${resource.name} is not a safe HTTP/HTTPS address.`);
    }
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
  ];

  if ((authenticated === null || setupStatus === null) && bootstrapError) {
    return (
      <main className="loading-screen bootstrap-error-screen">
        <div className="login-panel">
          <h1>Dashboard unavailable</h1>
          <p className="form-error">{bootstrapError}</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              setBootstrapError(null);
              void checkAuth().catch((failure) => setBootstrapError(failure instanceof Error ? failure.message : "Retry failed"));
            }}
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (authenticated === null || setupStatus === null) {
    return <div className="loading-screen">Loading</div>;
  }

  if (setupStatus.needsAccount) {
    return (
      <SetupScreen
        loading={setupLoading}
        error={setupError}
        needsAccount
        needsSetupCode={setupStatus.needsSetupCode}
        onComplete={completeSetup}
      />
    );
  }

  if (!authenticated) {
    return <LoginView message={sessionMessage} onLogin={() => {
      setSessionMessage(null);
      void checkAuth();
    }} />;
  }

  if (setupStatus.firstRun) {
    return (
      <SetupScreen
        loading={setupLoading}
        error={setupError}
        needsAccount={false}
        needsSetupCode={false}
        onComplete={completeSetup}
      />
    );
  }

  if (!dataReady && loading) {
    return <div className="loading-screen"><InlineSpinner size={18} /> Loading dashboard</div>;
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
          {refreshing ? <div className="loading-strip" role="status"><InlineSpinner size={12} /> Refreshing</div> : null}

          {view === "dashboard" ? (
            <DashboardConsole
              data={data}
              username={username}
              systemSettings={systemSettings}
              onRefresh={loadData}
              onPatchResource={patchResource}
              onRunCheck={runResourceHealthCheck}
              onPatchGroup={patchGroup}
              onOpenServices={openServicesForCreate}
              onAddServiceTemplate={openServicesForTemplate}
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
              addServiceTemplateId={addServiceTemplateId}
              onAddServiceTemplateHandled={() => setAddServiceTemplateId(null)}
              editServiceId={editServiceId}
              onEditServiceHandled={() => setEditServiceId(null)}
            />
          ) : null}

          {view === "settings" ? (
            <SettingsView
              username={username}
              authSource={authSource}
              resources={data.resources}
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
            openResource(resource);
          } else {
            setView("dashboard");
          }
        }}
      />

      {reauthOpen ? (
        <div className="reauth-backdrop" role="presentation">
          <section
            className="reauth-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reauth-title"
            aria-describedby="reauth-description"
          >
            <form onSubmit={submitReauthentication}>
              <span className="brand-mark"><Shield size={20} /></span>
              <h2 id="reauth-title">Confirm it’s you</h2>
              <p id="reauth-description">
                Enter the administrator password to approve this sensitive change. Approval lasts five minutes.
              </p>
              <label>
                Administrator password
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  value={reauthPassword}
                  onChange={(event) => setReauthPassword(event.target.value)}
                  required
                />
              </label>
              {reauthError ? <p className="form-error" role="alert">{reauthError}</p> : null}
              <div className="reauth-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={reauthSubmitting}
                  onClick={() => finishReauthentication(new Error("Password confirmation was cancelled"))}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={reauthSubmitting}>
                  {reauthSubmitting ? <InlineSpinner size={15} /> : <Shield size={15} />}
                  {reauthSubmitting ? " Confirming…" : " Confirm"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
