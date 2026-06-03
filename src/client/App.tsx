import {
  Activity,
  Bell,
  Download,
  ExternalLink,
  Gauge,
  Home,
  KeyRound,
  LogOut,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Server,
  Shield,
  TerminalSquare
} from "lucide-react";
import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { CommandPalette } from "./components/CommandPalette";
import { BuildBadge } from "./components/BuildBadge";
import { DetailDrawer, type DrawerState } from "./components/DetailDrawer";
import { KeyboardHelp } from "./components/KeyboardHelp";
import { AccessManager } from "./features/access/AccessManager";
import { useRemoteSessions } from "./features/access/useRemoteSessions";
import { AlertsView } from "./features/alerts/AlertsView";
import { DashboardConsole } from "./features/dashboard/DashboardConsole";
import { InventoryView, type InventoryTab } from "./features/inventory/InventoryView";
import { MonitoringCenter } from "./features/monitoring/MonitoringCenter";
import { emptyV2Data, type AppView, type V2Data } from "./features/types";
import { VaultView } from "./features/vault/VaultView";
import {
  apiGet,
  apiSend,
  type AlertChannelDto,
  type AlertDeliveryDto,
  type AlertRuleDto,
  type AuditEventDto,
  type ConnectionDto,
  type CredentialDto,
  type DashboardDto,
  type DashboardWidgetDto,
  type FolderDto,
  type HealthCheckDto,
  type IncidentDto,
  type MaintenanceWindowDto,
  type NoteDto,
  type SearchResultDto,
  type SessionHistoryDto,
  type TagDto
} from "./lib/api";
import { formatDateTime } from "./lib/format";
import { pushToast } from "./lib/toast";
import type { DashboardGroupDto, DashboardResource } from "../shared/types";

const navItems: Array<{ id: AppView; label: string; icon: ReactNode }> = [
  { id: "dashboard", label: "Dashboard", icon: <Home size={18} /> },
  { id: "ssh", label: "SSH", icon: <TerminalSquare size={18} /> },
  { id: "rdp", label: "Remote Desktop", icon: <Monitor size={18} /> },
  { id: "monitoring", label: "Monitoring", icon: <Activity size={18} /> },
  { id: "vault", label: "Vault", icon: <KeyRound size={18} /> },
  { id: "alerts", label: "Alerts", icon: <Bell size={18} /> },
  { id: "inventory", label: "Inventory", icon: <Server size={18} /> }
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
            <span>Admin vault</span>
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
          <KeyRound size={16} />
          Unlock
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
              Sample resources, SSH/RDP connections, health checks, an open incident, vault
              credentials, and a pinned note
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

function StatusStrip({ data, liveSessionCount }: { data: V2Data; liveSessionCount: number }) {
  const openIncidents = data.incidents.filter((incident) => incident.status !== "resolved").length;
  const failingChecks = data.checks.filter((check) => check.latestStatus === "offline").length;
  const activeSessions =
    liveSessionCount ||
    data.sessionHistory.filter((session) => session.status === "connected" || session.status === "launching").length;

  return (
    <div className="status-strip">
      <span className={openIncidents ? "strip-danger" : ""}>{openIncidents} incidents</span>
      <span className={failingChecks ? "strip-danger" : ""}>{failingChecks} failing checks</span>
      <span>{activeSessions} live sessions</span>
      <span>{data.credentials.length} vault items</span>
    </div>
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
  const [inventoryTab, setInventoryTab] = useState<InventoryTab>("resource");
  const [launchConnectionId, setLaunchConnectionId] = useState<string | null>(null);
  const remoteSessions = useRemoteSessions();

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
        credentials,
        connections,
        checks,
        widgets,
        incidents,
        sessionHistory,
        folders,
        tags,
        audit,
        alertChannels,
        alertRules,
        alertDeliveries,
        maintenanceWindows,
        notes
      ] = await Promise.all([
        apiGet<DashboardDto>("/api/dashboard"),
        apiGet<DashboardResource[]>("/api/resources"),
        apiGet<DashboardGroupDto[]>("/api/groups"),
        apiGet<CredentialDto[]>("/api/credentials"),
        apiGet<ConnectionDto[]>("/api/connections"),
        apiGet<HealthCheckDto[]>("/api/health-checks"),
        apiGet<DashboardWidgetDto[]>("/api/dashboard/widgets"),
        apiGet<IncidentDto[]>("/api/incidents"),
        apiGet<SessionHistoryDto[]>("/api/sessions/history"),
        apiGet<FolderDto[]>("/api/vault/folders"),
        apiGet<TagDto[]>("/api/tags"),
        apiGet<AuditEventDto[]>("/api/vault/audit"),
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
        credentials,
        connections,
        checks,
        widgets,
        incidents,
        sessionHistory,
        folders,
        tags,
        audit,
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
      apiGet<{ authenticated: boolean }>("/api/auth/me"),
      apiGet<{ firstRun: boolean; needsAccount: boolean }>("/api/setup/status")
    ]);
    setAuthenticated(me.authenticated);
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
        setView("inventory");
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
    remoteSessions.reset();
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

  async function exportInventory() {
    setInventoryTab("backup");
    setView("inventory");
  }

  function openConnection(connection: ConnectionDto) {
    setLaunchConnectionId(connection.id);
    setView(connection.type);
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

  function inspectCredential(credential: CredentialDto) {
    setDrawer({
      type: "credential",
      title: credential.label,
      body: (
        <DrawerBody
          rows={[
            ["Username", credential.username],
            ["Folder", data.folders.find((folder) => folder.id === credential.folderId)?.name],
            ["Last used", formatDateTime(credential.lastUsedAt)],
            ["Notes", credential.notes]
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

    if (result.action === "startSession") {
      const connectionId = result.payload?.connectionId;
      if (typeof connectionId === "string") {
        const connection = data.connections.find((item) => item.id === connectionId);
        if (connection) {
          setLaunchConnectionId(connection.id);
          setView(connection.type);
        }
      }
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

    if (result.action === "openVault") {
      setView("vault");
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
    <div className="app-shell pro-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Gauge size={24} />
          <span>Homelab</span>
        </div>
        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => (
            <button
              className={view === item.id ? "active" : ""}
              type="button"
              key={item.id}
              onClick={() => setView(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <BuildBadge className="sidebar-build-badge" />
        <button className="nav-utility" type="button" onClick={logout}>
          <LogOut size={18} />
          Logout
        </button>
      </aside>
      <div className="content-shell">
        <header className="top-command-bar">
          <button className="command-button" type="button" onClick={() => setPaletteOpen(true)}>
            <Search size={16} />
            <span>Command palette</span>
            <kbd>Ctrl K</kbd>
          </button>
          <StatusStrip
            data={data}
            liveSessionCount={remoteSessions.tabs.filter((tab) => tab.state === "connected" || tab.state === "launching").length}
          />
          <div className="top-command-bar-actions">
            <button className="icon-text-button" type="button" onClick={() => { setInventoryTab("resource"); setView("inventory"); }}>
              <Plus size={16} />
              New
            </button>
            <button className="icon-text-button" type="button" onClick={() => window.open("/status", "_blank", "noopener,noreferrer")}>
              <ExternalLink size={16} />
              Status
            </button>
            <button className="icon-text-button" type="button" onClick={() => { setInventoryTab("backup"); setView("inventory"); }}>
              <Download size={16} />
              Backup
            </button>
            <button className="icon-text-button" type="button" onClick={() => setKeyboardHelpOpen(true)}>
              <Shield size={16} />
              Shortcuts
            </button>
            <button className="icon-text-button" type="button" onClick={loadData}>
              <RefreshCw size={16} />
              Sync
            </button>
          </div>
        </header>
        <div className={`workspace-scroll ${view === "ssh" || view === "rdp" ? "access-workspace" : ""}`}>
          {error ? <div className="app-error">{error}</div> : null}
          {loading ? <div className="loading-strip"><RefreshCw className="spin" size={12} />Refreshing</div> : null}
          {view === "dashboard" ? (
            <DashboardConsole
              data={data}
              onRefresh={loadData}
              onPatchResource={patchResource}
              onPatchGroup={patchGroup}
              onOpenInventory={() => { setInventoryTab("resource"); setView("inventory"); }}
              onInspectResource={inspectResource}
              onOpenIncident={(id) => {
                const incident = openIncidentMap.get(id);
                if (incident) {
                  inspectIncident(incident);
                }
              }}
              onConnect={openConnection}
            />
          ) : null}
          {view === "ssh" ? (
            <AccessManager
              protocol="ssh"
              data={data}
              onRefresh={loadData}
              tabs={remoteSessions.tabs}
              setTabs={remoteSessions.setTabs}
              activeTabId={remoteSessions.getActiveTabId("ssh")}
              setActiveTabId={(tabId) => remoteSessions.setActiveTabId("ssh", tabId)}
              launchConnectionId={launchConnectionId}
              onLaunchHandled={() => setLaunchConnectionId(null)}
            />
          ) : null}
          {view === "rdp" ? (
            <AccessManager
              protocol="rdp"
              data={data}
              onRefresh={loadData}
              tabs={remoteSessions.tabs}
              setTabs={remoteSessions.setTabs}
              activeTabId={remoteSessions.getActiveTabId("rdp")}
              setActiveTabId={(tabId) => remoteSessions.setActiveTabId("rdp", tabId)}
              launchConnectionId={launchConnectionId}
              onLaunchHandled={() => setLaunchConnectionId(null)}
            />
          ) : null}
          {view === "inventory" ? (
            <InventoryView data={data} onRefresh={loadData} activeTab={inventoryTab} onTabChange={setInventoryTab} />
          ) : null}
          {view === "monitoring" ? (
            <MonitoringCenter
              data={data}
              onRefresh={loadData}
              onInspectIncident={inspectIncident}
              onOpenInventoryChecks={() => { setInventoryTab("check"); setView("inventory"); }}
            />
          ) : null}
          {view === "vault" ? (
            <VaultView data={data} onRefresh={loadData} onInspectCredential={inspectCredential} />
          ) : null}
          {view === "alerts" ? <AlertsView data={data} onRefresh={loadData} /> : null}
        </div>
        <DetailDrawer drawer={drawer} onClose={() => setDrawer(null)} />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onAction={handlePaletteAction} />
        <KeyboardHelp open={keyboardHelpOpen} onClose={() => setKeyboardHelpOpen(false)} />
      </div>
    </div>
  );
}
