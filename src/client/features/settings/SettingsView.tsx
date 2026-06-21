import { Activity, Clipboard, Cpu, ExternalLink, Gauge, Play, RefreshCw, Save, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "../../components/Primitives";
import { FormErrorBanner, runFormAction } from "../../lib/forms";
import { apiGet, apiSend, type HostMonitorDto, type RuntimeStatusDto, type SchedulerRuntimeDto, type SystemSettingsDto } from "../../lib/api";
import { formatByteRate, formatPercent, relativeTime } from "../../lib/format";

type HostMonitorForm = {
  id: string | null;
  name: string;
  baseUrl: string;
  primaryMount: string;
  networkInterface: string;
  enabled: boolean;
};

const emptyHostMonitorForm: HostMonitorForm = {
  id: null,
  name: "",
  baseUrl: "",
  primaryMount: "/",
  networkInterface: "",
  enabled: true
};

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
  onRefresh,
  systemSettings,
  onSaveSettings
}: {
  username: string;
  authSource: "env" | "database";
  onRefresh: () => Promise<void>;
  systemSettings: SystemSettingsDto;
  onSaveSettings: (next: SystemSettingsDto) => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [autoPingIntervalSeconds, setAutoPingIntervalSeconds] = useState(systemSettings.autoPingIntervalSeconds.toString());
  const [hostMonitors, setHostMonitors] = useState<HostMonitorDto[]>([]);
  const [hostForm, setHostForm] = useState<HostMonitorForm>(emptyHostMonitorForm);
  const [runtime, setRuntime] = useState<RuntimeStatusDto | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [testingHostId, setTestingHostId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setAutoPingIntervalSeconds(systemSettings.autoPingIntervalSeconds.toString());
  }, [systemSettings.autoPingIntervalSeconds]);

  useEffect(() => {
    void Promise.all([loadHostMonitors(), loadRuntime()]);
  }, []);

  async function loadHostMonitors() {
    const monitors = await apiGet<HostMonitorDto[]>("/api/metrics/hosts");
    setHostMonitors(monitors);
  }

  async function loadRuntime() {
    setRuntimeLoading(true);
    try {
      setRuntime(await apiGet<RuntimeStatusDto>("/api/admin/runtime"));
    } finally {
      setRuntimeLoading(false);
    }
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

    const payload: SystemSettingsDto = { autoPingIntervalSeconds: interval };
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

  return (
    <main className="view-shell">
      <PageHeader title="Admin" subtitle="Account, appearance, and system tools" />

      <FormErrorBanner message={actionError} />

      <section className="settings-grid">
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
                placeholder="http://192.168.1.10:61208"
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

        <section className="table-panel">
          <h3><RefreshCw size={16} /> Account</h3>
          <div className="key-value-grid">
            <span><span>Username</span><strong>{username}</strong></span>
            <span><span>Auth</span><strong>{authSource === "env" ? "Server env (ADMIN_PASSWORD)" : "Database"}</strong></span>
          </div>
          {authSource === "database" ? (
            <form className="inline-form settings-form-grid" onSubmit={changePassword}>
              <label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
              <label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} /></label>
              <label>Confirm new password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} /></label>
              <button className="primary-button" type="submit" disabled={submitting}><Save size={15} /> Update password</button>
            </form>
          ) : (
            <p className="muted-copy">Password is set via <code>ADMIN_PASSWORD</code> in docker-compose. Change it there and restart the container.</p>
          )}
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
            <button
              className="icon-text-button"
              type="button"
              onClick={() => window.open("/status", "_blank", "noopener,noreferrer")}
            >
              <ExternalLink size={16} /> Public status page
            </button>
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
              </div>

              <div className="runtime-count-grid">
                <span><small>Services</small><strong>{runtime.database.counts.resources}</strong></span>
                <span><small>Checks</small><strong>{runtime.database.counts.healthChecks}</strong></span>
                <span><small>Results</small><strong>{runtime.database.counts.healthResults}</strong></span>
                <span><small>Hosts</small><strong>{runtime.database.counts.hostMonitors}</strong></span>
                <span><small>Samples</small><strong>{runtime.database.counts.hostMetricSamples}</strong></span>
              </div>

              <div className="scheduler-runtime-grid">
                <SchedulerRuntimeCard label="Health checks" state={runtime.schedulers.health} />
                <SchedulerRuntimeCard label="Host metrics" state={runtime.schedulers.metrics} />
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
            <button className="icon-text-button" type="button" onClick={() => void loadRuntime()} disabled={runtimeLoading}>
              <RefreshCw size={16} className={runtimeLoading ? "spin" : ""} /> Refresh runtime
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
