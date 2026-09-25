import type { SettingsSection } from "../settings/SettingsHub";
import { BrowserHomepage } from "../homepage/BrowserHomepage";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Cpu,
  ExternalLink,
  HardDrive,
  Info,
  LayoutGrid,
  MemoryStick,
  Network,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Star,
  Thermometer,
  X
} from "lucide-react";
import type { DragEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AiBriefingActionDto, AiBriefingDto, ApiWidgetDto, DashboardResource, HostMetricSampleDto, HostMonitorDto, IntegrationSampleDto, IntegrationSourceDto, OpnsenseSnapshotDto } from "../../../shared/types";
import { EmptyPanel, StatusBadge } from "../../components/Primitives";
import { Heartbeat } from "../../components/Heartbeat";
import { ServiceDrawer } from "../../components/ServiceDrawer";
import { HealthStrip, type HealthItem } from "../../components/HealthStrip";
import { serviceHealth } from "../../lib/healthPresentation";
import { ServiceIcon } from "../../components/ServiceIcon";
import { ModalSurface } from "../../components/ModalSurface";
import {
  dashboardResources,
  formatByteRate,
  formatBytes,
  formatPercent,
  formatUptime,
  greetingFor,
  latestCheckedAt,
  latestErrors,
  latestLatency,
  relativeTime,
  resourceTicks,
  serviceAddress,
  statusFor,
  summarizeResourceStatus,
  uptimePercent
} from "../../lib/format";
import { apiGet, apiSend } from "../../lib/api";
import type { SystemSettingsDto } from "../../lib/api";
import { type AppData } from "../types";
import { BookmarkLibrary } from "./BookmarkLibrary";
import { isBookmark } from "../../lib/bookmarks";
import {
  DASHBOARD_MODE_KEY,
  DashboardLaunchpad,
  DashboardModeSwitch,
  type DashboardMode
} from "./DashboardLaunchpad";

type StatusFilter = "all" | "favorites" | "online" | "offline" | "unknown";
type Density = "grid" | "list";

const DENSITY_KEY = "homelab-density";

function readDensity(): Density {
  return localStorage.getItem(DENSITY_KEY) === "list" ? "list" : "grid";
}

function readDashboardMode(): DashboardMode {
  return localStorage.getItem(DASHBOARD_MODE_KEY) === "operations" ? "operations" : "launchpad";
}

function monitoringLabel(resource: DashboardResource): string {
  if (resource.monitoringMode === "disabled") return "off";
  if (resource.monitoringMode === "manual") return "manual";
  const latency = latestLatency(resource);
  return latency == null ? "—" : `${latency} ms`;
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

type DragState = { id: string; container: string } | null;
type MetricKey = "cpuPercent" | "memoryPercent" | "diskPercent";

function metricLevel(value: number | null | undefined): "ok" | "warn" | "critical" | "unknown" {
  if (value == null) return "unknown";
  if (value >= 90) return "critical";
  if (value >= 80) return "warn";
  return "ok";
}

function sortSamples(samples: HostMetricSampleDto[] | undefined): HostMetricSampleDto[] {
  return [...(samples ?? [])].sort((left, right) => left.sampledAt.localeCompare(right.sampledAt));
}

function MetricSparkline({ samples, metric }: { samples: HostMetricSampleDto[] | undefined; metric: MetricKey }) {
  const values = sortSamples(samples)
    .map((sample) => sample[metric])
    .filter((value): value is number => typeof value === "number");

  if (values.length < 2) {
    return <div className="metric-sparkline metric-sparkline-empty" aria-hidden />;
  }

  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 36 - (Math.max(0, Math.min(100, value)) / 100) * 32;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="metric-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

function MetricBar({
  icon,
  label,
  value,
  detail
}: {
  icon: ReactNode;
  label: string;
  value: number | null | undefined;
  detail?: string;
}) {
  const percent = value == null ? 0 : Math.max(0, Math.min(100, value));
  const level = metricLevel(value);

  return (
    <div className={`metric-row metric-${level}`}>
      <span className="metric-row-label">{icon}<span>{label}</span></span>
      <strong>{formatPercent(value)}</strong>
      <div className="metric-bar" aria-hidden><i style={{ width: `${percent}%` }} /></div>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function HostVitalsCard({ host, onInspect }: { host: HostMonitorDto; onInspect: (host: HostMonitorDto) => void }) {
  const samples = sortSamples(host.samples);
  const latestSample = samples[samples.length - 1];
  const status = host.latestStatus;
  const updated = host.latestSampledAt ?? latestSample?.sampledAt ?? null;
  const networkTotal = (host.latestNetworkRxBytesPerSec ?? 0) + (host.latestNetworkTxBytesPerSec ?? 0);

  return (
    <button
      className={`host-card host-${status}`}
      type="button"
      title={`Inspect ${host.name} metrics`}
      onClick={() => onInspect(host)}
    >
      <header className="host-card-head">
        <span className="host-icon"><Server size={18} /></span>
        <span>
          <strong>{host.name}</strong>
          <small>{host.baseUrl}</small>
        </span>
        <i className={`svc-dot dot-${status}`} title={status} />
      </header>

      <div className="host-spark-grid">
        <MetricSparkline samples={host.samples} metric="cpuPercent" />
        <MetricSparkline samples={host.samples} metric="memoryPercent" />
        <MetricSparkline samples={host.samples} metric="diskPercent" />
      </div>

      <div className="host-metrics">
        <MetricBar icon={<Cpu size={13} />} label="CPU" value={host.latestCpuPercent} />
        <MetricBar
          icon={<MemoryStick size={13} />}
          label="RAM"
          value={host.latestMemoryPercent}
          detail={`${formatBytes(host.latestMemoryUsedBytes)} / ${formatBytes(host.latestMemoryTotalBytes)}`}
        />
        <MetricBar
          icon={<HardDrive size={13} />}
          label={host.primaryMount}
          value={host.latestDiskPercent}
          detail={`${formatBytes(host.latestDiskUsedBytes)} / ${formatBytes(host.latestDiskTotalBytes)}`}
        />
      </div>

      <footer className="host-card-foot">
        <span title="Network throughput"><Network size={13} /> {formatByteRate(networkTotal || null)}</span>
        {host.latestTemperatureC != null ? <span title="Temperature"><Thermometer size={13} /> {host.latestTemperatureC.toFixed(1)}°C</span> : null}
        {host.latestContainersTotal != null ? <span title="Containers"><Activity size={13} /> {host.latestContainersRunning ?? 0}/{host.latestContainersTotal}</span> : null}
        <span title="Last sampled">{relativeTime(updated)}</span>
      </footer>

      {status === "offline" && host.latestError ? <p className="host-error">{host.latestError}</p> : null}
    </button>
  );
}

function NetworkSparkline({ samples }: { samples: HostMetricSampleDto[] | undefined }) {
  const values = sortSamples(samples)
    .map((sample) => (sample.networkRxBytesPerSec ?? 0) + (sample.networkTxBytesPerSec ?? 0))
    .filter((value) => value > 0);

  if (values.length < 2) {
    return <div className="metric-sparkline metric-sparkline-empty" aria-hidden />;
  }

  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 36 - (Math.max(0, Math.min(max, value)) / max) * 32;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="metric-sparkline host-detail-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

function HostDetailDrawer({
  host,
  loading,
  error,
  onClose
}: {
  host: HostMonitorDto;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const samples = sortSamples(host.samples);
  const newest = samples[samples.length - 1];
  const oldest = samples[0];
  const networkTotal = (host.latestNetworkRxBytesPerSec ?? 0) + (host.latestNetworkTxBytesPerSec ?? 0);

  return (
    <ModalSurface
      backdropClassName="drawer-backdrop"
      className="service-drawer host-detail-drawer"
      ariaLabel={`${host.name} host metrics`}
      onClose={onClose}
    >
        <header className="drawer-head">
          <span className="host-icon"><Server size={20} /></span>
          <div className="drawer-title">
            <h2>{host.name}</h2>
            <small>{host.baseUrl}</small>
          </div>
          <StatusBadge status={host.latestStatus} />
          <button className="icon-button drawer-close" type="button" aria-label={`Close ${host.name} host metrics`} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="drawer-stats">
          <span><small>CPU</small><strong>{formatPercent(host.latestCpuPercent)}</strong></span>
          <span><small>RAM</small><strong>{formatPercent(host.latestMemoryPercent)}</strong></span>
          <span><small>Disk</small><strong>{formatPercent(host.latestDiskPercent)}</strong></span>
          <span><small>Network</small><strong>{formatByteRate(networkTotal || null)}</strong></span>
        </div>

        {loading ? <p className="muted-copy">Loading 24h host history...</p> : null}
        {error ? <div className="app-error">{error}</div> : null}

        <section className="drawer-section host-detail-section">
          <h4>24h trends</h4>
          <div className="host-detail-trends">
            <div>
              <span><Cpu size={14} /> CPU</span>
              <MetricSparkline samples={samples} metric="cpuPercent" />
            </div>
            <div>
              <span><MemoryStick size={14} /> RAM</span>
              <MetricSparkline samples={samples} metric="memoryPercent" />
            </div>
            <div>
              <span><HardDrive size={14} /> Disk</span>
              <MetricSparkline samples={samples} metric="diskPercent" />
            </div>
            <div>
              <span><Network size={14} /> Network</span>
              <NetworkSparkline samples={samples} />
            </div>
          </div>
        </section>

        <section className="drawer-section">
          <h4>Latest sample</h4>
          <div className="key-value-grid host-detail-grid">
            <span><span>Collected</span><strong>{relativeTime(host.latestSampledAt ?? newest?.sampledAt ?? null)}</strong></span>
            <span><span>Range</span><strong>{oldest ? `${relativeTime(oldest.sampledAt)} to now` : "No history"}</strong></span>
            <span><span>Memory</span><strong>{formatBytes(host.latestMemoryUsedBytes)} / {formatBytes(host.latestMemoryTotalBytes)}</strong></span>
            <span><span>Disk {host.primaryMount}</span><strong>{formatBytes(host.latestDiskUsedBytes)} / {formatBytes(host.latestDiskTotalBytes)}</strong></span>
            <span><span>Containers</span><strong>{host.latestContainersTotal == null ? "—" : `${host.latestContainersRunning ?? 0}/${host.latestContainersTotal}`}</strong></span>
            <span><span>Temperature</span><strong>{host.latestTemperatureC == null ? "—" : `${host.latestTemperatureC.toFixed(1)}°C`}</strong></span>
          </div>
          {host.latestError ? <p className="drawer-check-error">{host.latestError}</p> : null}
        </section>
    </ModalSurface>
  );
}

type IntegrationMetricKey = "cpuPercent" | "memoryPercent" | "diskPercent";

function sortIntegrationSamples(samples: IntegrationSampleDto[] | undefined): IntegrationSampleDto[] {
  return [...(samples ?? [])].sort((left, right) => left.sampledAt.localeCompare(right.sampledAt));
}

function latestNetworkRate(snapshot: OpnsenseSnapshotDto | null | undefined): number | null {
  const total = snapshot?.interfaces.reduce(
    (sum, item) => sum + (item.receivedBytesPerSec ?? 0) + (item.sentBytesPerSec ?? 0),
    0
  ) ?? 0;
  return total > 0 ? total : null;
}

function gatewaySummary(snapshot: OpnsenseSnapshotDto | null | undefined): string {
  const gateways = snapshot?.gateways ?? [];
  if (gateways.length === 0) return "No gateways";
  const online = gateways.filter((gateway) => gateway.status === "online").length;
  return `${online}/${gateways.length} gateways`;
}

function IntegrationMetricSparkline({
  samples,
  metric
}: {
  samples: IntegrationSampleDto[] | undefined;
  metric: IntegrationMetricKey;
}) {
  const values = sortIntegrationSamples(samples)
    .map((sample) => sample.snapshot?.provider === "opnsense" ? sample.snapshot.system[metric] : null)
    .filter((value): value is number => typeof value === "number");

  if (values.length < 2) {
    return <div className="metric-sparkline metric-sparkline-empty" aria-hidden />;
  }

  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 36 - (Math.max(0, Math.min(100, value)) / 100) * 32;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="metric-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

function IntegrationCard({
  source,
  onInspect
}: {
  source: IntegrationSourceDto;
  onInspect: (source: IntegrationSourceDto) => void;
}) {
  const trueNasSnapshot = source.latestSnapshot?.provider === "truenas" ? source.latestSnapshot : null;
  if (source.provider === "truenas") {
    const capacity = trueNasSnapshot?.dataset ?? trueNasSnapshot?.pool;
    const percent = capacity && capacity.sizeBytes > 0 ? (capacity.usedBytes / capacity.sizeBytes) * 100 : null;
    const unhealthy = trueNasSnapshot && !["ONLINE", "HEALTHY"].includes(trueNasSnapshot.pool.health.toUpperCase());
    return (
      <button className={`host-card integration-card host-${unhealthy ? "offline" : source.status}`} type="button" title={`Inspect ${source.name} integration`} onClick={() => onInspect(source)}>
        <header className="host-card-head"><span className="host-icon integration-icon"><HardDrive size={18} /></span><span><strong>{source.name}</strong><small>{capacity?.name ?? source.baseUrl}</small></span><i className={`svc-dot dot-${source.status}`} title={source.status} /></header>
        <div className="host-metrics"><MetricBar icon={<HardDrive size={13} />} label="Used" value={percent} /></div>
        <div className="drawer-stats"><span><small>Used</small><strong>{formatBytes(capacity?.usedBytes)}</strong></span><span><small>Free</small><strong>{formatBytes(capacity?.freeBytes)}</strong></span></div>
        <footer className="host-card-foot"><span>{trueNasSnapshot?.pool.health ?? "No sample"}</span><span>{relativeTime(source.latestSampledAt)}</span></footer>
        {source.latestError ? <p className="host-error">{source.latestError}</p> : null}
      </button>
    );
  }
  const snapshot = source.latestSnapshot?.provider === "opnsense" ? source.latestSnapshot : null;
  const networkTotal = latestNetworkRate(snapshot);
  const gatewaysOffline = snapshot?.gateways.filter((gateway) => gateway.status === "offline").length ?? 0;
  const detailStatus = gatewaysOffline > 0 ? "offline" : source.status;

  return (
    <button
      className={`host-card integration-card host-${detailStatus}`}
      type="button"
      title={`Inspect ${source.name} integration`}
      onClick={() => onInspect(source)}
    >
      <header className="host-card-head">
        <span className="host-icon integration-icon"><ShieldCheck size={18} /></span>
        <span>
          <strong>{source.name}</strong>
          <small>{source.baseUrl}</small>
        </span>
        <i className={`svc-dot dot-${source.status}`} title={source.status} />
      </header>

      <div className="host-spark-grid">
        <IntegrationMetricSparkline samples={source.samples} metric="cpuPercent" />
        <IntegrationMetricSparkline samples={source.samples} metric="memoryPercent" />
        <IntegrationMetricSparkline samples={source.samples} metric="diskPercent" />
      </div>

      <div className="host-metrics">
        <MetricBar icon={<Cpu size={13} />} label="CPU" value={snapshot?.system.cpuPercent} />
        <MetricBar icon={<MemoryStick size={13} />} label="RAM" value={snapshot?.system.memoryPercent} />
        <MetricBar icon={<HardDrive size={13} />} label="Disk" value={snapshot?.system.diskPercent} />
      </div>

      <footer className="host-card-foot">
        <span title="Gateway health"><Network size={13} /> {gatewaySummary(snapshot)}</span>
        <span title="Interface throughput"><Activity size={13} /> {formatByteRate(networkTotal)}</span>
        {snapshot?.firmware.version ? <span title="Firmware">{snapshot.firmware.version}</span> : null}
        <span title="Last sampled">{relativeTime(source.latestSampledAt)}</span>
      </footer>

      {source.latestError ? <p className="host-error">{source.latestError}</p> : null}
      {!source.latestSnapshot && source.status === "unknown" ? <p className="host-error">No OPNsense sample collected yet.</p> : null}
    </button>
  );
}

function IntegrationDetailDrawer({
  source,
  loading,
  error,
  onClose
}: {
  source: IntegrationSourceDto;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const trueNasSnapshot = source.latestSnapshot?.provider === "truenas" ? source.latestSnapshot : null;
  if (source.provider === "truenas") {
    const capacity = trueNasSnapshot?.dataset ?? trueNasSnapshot?.pool;
    const percent = capacity && capacity.sizeBytes > 0 ? (capacity.usedBytes / capacity.sizeBytes) * 100 : null;
    const trueNasSamples = sortIntegrationSamples(source.samples).filter((sample) => sample.snapshot?.provider === "truenas");
    const oldestCapacity = trueNasSamples[0]?.snapshot?.provider === "truenas" ? trueNasSamples[0].snapshot.dataset ?? trueNasSamples[0].snapshot.pool : null;
    const change = capacity && oldestCapacity ? capacity.usedBytes - oldestCapacity.usedBytes : null;
    return (
      <ModalSurface backdropClassName="drawer-backdrop" className="service-drawer host-detail-drawer integration-detail-drawer" ariaLabel={`${source.name} integration`} onClose={onClose}>
        <header className="drawer-head"><span className="host-icon integration-icon"><HardDrive size={20} /></span><div className="drawer-title"><h2>{source.name}</h2><small>{source.baseUrl}</small></div><StatusBadge status={source.status} /><button className="icon-button drawer-close" type="button" aria-label={`Close ${source.name} integration details`} onClick={onClose}><X size={16} /></button></header>
        <div className="drawer-stats"><span><small>Used</small><strong>{formatPercent(percent)}</strong></span><span><small>Allocated</small><strong>{formatBytes(capacity?.usedBytes)}</strong></span><span><small>Free</small><strong>{formatBytes(capacity?.freeBytes)}</strong></span><span><small>24h change</small><strong>{change == null ? "—" : `${change >= 0 ? "+" : "−"}${formatBytes(Math.abs(change))}`}</strong></span></div>
        {loading ? <p className="muted-copy">Loading integration history...</p> : null}{error ? <div className="app-error">{error}</div> : null}{source.latestError ? <p className="drawer-check-error">{source.latestError}</p> : null}
        <section className="drawer-section"><h4>Storage</h4><div className="key-value-grid host-detail-grid"><span><span>Pool</span><strong>{trueNasSnapshot?.pool.name ?? "—"}</strong></span><span><span>Pool health</span><strong>{trueNasSnapshot?.pool.health ?? "—"}</strong></span><span><span>Dataset</span><strong>{trueNasSnapshot?.dataset?.name ?? "Pool total"}</strong></span><span><span>Capacity</span><strong>{formatBytes(capacity?.sizeBytes)}</strong></span><span><span>Collected</span><strong>{relativeTime(source.latestSampledAt)}</strong></span><span><span>Samples</span><strong>{trueNasSamples.length}</strong></span></div></section>
        {trueNasSnapshot?.warnings.length ? <section className="drawer-section"><h4>Attention</h4>{trueNasSnapshot.warnings.map((warning) => <p className="drawer-check-error" key={warning}>{warning}</p>)}</section> : null}
      </ModalSurface>
    );
  }
  const snapshot = source.latestSnapshot?.provider === "opnsense" ? source.latestSnapshot : null;
  const samples = sortIntegrationSamples(source.samples);
  const newest = samples[samples.length - 1];
  const oldest = samples[0];
  const networkTotal = latestNetworkRate(snapshot);
  const gatewaysOffline = snapshot?.gateways.filter((gateway) => gateway.status === "offline").length ?? 0;

  return (
    <ModalSurface
      backdropClassName="drawer-backdrop"
      className="service-drawer host-detail-drawer integration-detail-drawer"
      ariaLabel={`${source.name} integration`}
      onClose={onClose}
    >
        <header className="drawer-head">
          <span className="host-icon integration-icon"><ShieldCheck size={20} /></span>
          <div className="drawer-title">
            <h2>{source.name}</h2>
            <small>{source.baseUrl}</small>
          </div>
          <StatusBadge status={source.status} />
          <button className="icon-button drawer-close" type="button" aria-label={`Close ${source.name} integration details`} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="drawer-stats">
          <span><small>CPU</small><strong>{formatPercent(snapshot?.system.cpuPercent)}</strong></span>
          <span><small>RAM</small><strong>{formatPercent(snapshot?.system.memoryPercent)}</strong></span>
          <span><small>Gateways</small><strong>{gatewaySummary(snapshot)}</strong></span>
          <span><small>Traffic</small><strong>{formatByteRate(networkTotal)}</strong></span>
        </div>

        {loading ? <p className="muted-copy">Loading integration history...</p> : null}
        {error ? <div className="app-error">{error}</div> : null}
        {source.latestError ? <p className="drawer-check-error">{source.latestError}</p> : null}

        <section className="drawer-section host-detail-section">
          <h4>24h trends</h4>
          <div className="host-detail-trends">
            <div>
              <span><Cpu size={14} /> CPU</span>
              <IntegrationMetricSparkline samples={samples} metric="cpuPercent" />
            </div>
            <div>
              <span><MemoryStick size={14} /> RAM</span>
              <IntegrationMetricSparkline samples={samples} metric="memoryPercent" />
            </div>
            <div>
              <span><HardDrive size={14} /> Disk</span>
              <IntegrationMetricSparkline samples={samples} metric="diskPercent" />
            </div>
            <div>
              <span><Network size={14} /> Network</span>
              <NetworkSparkline samples={samples.map((sample) => ({
                id: sample.id,
                monitorId: sample.sourceId,
                status: sample.status,
                error: sample.error,
                cpuPercent: null,
                memoryPercent: null,
                memoryUsedBytes: null,
                memoryTotalBytes: null,
                diskPercent: null,
                diskUsedBytes: null,
                diskTotalBytes: null,
                networkRxBytesPerSec: sample.snapshot?.provider === "opnsense" ? sample.snapshot.interfaces.reduce((sum, item) => sum + (item.receivedBytesPerSec ?? 0), 0) : null,
                networkTxBytesPerSec: sample.snapshot?.provider === "opnsense" ? sample.snapshot.interfaces.reduce((sum, item) => sum + (item.sentBytesPerSec ?? 0), 0) : null,
                temperatureC: null,
                containersRunning: null,
                containersTotal: null,
                sampledAt: sample.sampledAt
              }))} />
            </div>
          </div>
        </section>

        <section className="drawer-section">
          <h4>System</h4>
          <div className="key-value-grid host-detail-grid">
            <span><span>Collected</span><strong>{relativeTime(source.latestSampledAt ?? newest?.sampledAt ?? null)}</strong></span>
            <span><span>Range</span><strong>{oldest ? `${relativeTime(oldest.sampledAt)} to now` : "No history"}</strong></span>
            <span><span>Hostname</span><strong>{snapshot?.system.hostname ?? "—"}</strong></span>
            <span><span>Uptime</span><strong>{snapshot?.system.uptime ?? "—"}</strong></span>
            <span><span>Firmware</span><strong>{snapshot?.firmware.version ?? snapshot?.system.version ?? "—"}</strong></span>
            <span><span>PF states</span><strong>{snapshot?.firewall.stateCount ?? "—"}</strong></span>
          </div>
        </section>

        <section className="drawer-section">
          <h4>Gateways</h4>
          <div className="integration-row-list">
            {(snapshot?.gateways ?? []).map((gateway) => (
              <span key={gateway.id}>
                <i className={`svc-dot dot-${gateway.status}`} />
                <strong>{gateway.name}</strong>
                <small>{gateway.address ?? "no address"} · {gateway.delayMs == null ? "—" : `${gateway.delayMs} ms`} · loss {formatPercent(gateway.lossPercent)}</small>
              </span>
            ))}
            {snapshot?.gateways.length === 0 ? <p className="muted-copy">No gateways returned by OPNsense.</p> : null}
          </div>
        </section>

        <section className="drawer-section">
          <h4>Interfaces</h4>
          <div className="integration-row-list">
            {(snapshot?.interfaces ?? []).map((item) => (
              <span key={item.id}>
                <i className={`svc-dot dot-${item.status}`} />
                <strong>{item.name}</strong>
                <small>{item.device ?? item.identifier ?? "interface"} · {item.ipv4 ?? item.ipv6 ?? "no address"} · {formatByteRate(((item.receivedBytesPerSec ?? 0) + (item.sentBytesPerSec ?? 0)) || null)}</small>
              </span>
            ))}
            {snapshot?.interfaces.length === 0 ? <p className="muted-copy">No interfaces returned by OPNsense.</p> : null}
          </div>
        </section>

        {snapshot?.warnings.length ? (
          <section className="drawer-section">
            <h4>Partial data</h4>
            {snapshot.warnings.slice(0, 5).map((warning) => <p className="drawer-check-error" key={warning}>{warning}</p>)}
          </section>
        ) : null}
    </ModalSurface>
  );
}

function ApiWidgetCard({ widget }: { widget: ApiWidgetDto }) {
  const fields = widget.latestSnapshot?.fields ?? [];

  return (
    <article className={`api-widget-card host-${widget.latestStatus}`}>
      <header className="host-card-head">
        <span className="host-icon api-widget-icon"><PanelsTopLeft size={18} /></span>
        <span>
          <strong>{widget.name}</strong>
          <small>{widget.baseUrl}{widget.endpointPath}</small>
        </span>
        <i className={`svc-dot dot-${widget.latestStatus}`} title={widget.latestStatus} />
      </header>

      <div className="api-widget-fields">
        {fields.slice(0, 6).map((field) => (
          <span key={`${field.label}-${field.value}`}>
            <small>{field.label}</small>
            <strong>{field.value}{field.suffix ?? ""}</strong>
          </span>
        ))}
        {fields.length === 0 ? (
          <span>
            <small>Status</small>
            <strong>{widget.latestStatus}</strong>
          </span>
        ) : null}
      </div>

      <footer className="host-card-foot">
        <span title="Template">{widget.templateId}</span>
        <span title="Last sampled">{relativeTime(widget.latestSampledAt)}</span>
      </footer>
      {widget.latestError ? <p className="host-error">{widget.latestError}</p> : null}
    </article>
  );
}

function CommandBriefingPanel({
  briefing,
  refreshing,
  onRefresh,
  onAction
}: {
  briefing: AiBriefingDto;
  refreshing: boolean;
  onRefresh: () => void;
  onAction: (action: AiBriefingActionDto) => void;
}) {
  const generated = briefing.generatedAt ? `Generated ${relativeTime(briefing.generatedAt)}` : "Not generated yet";
  const tone = briefing.severity === "critical" ? "critical" : briefing.severity === "warning" ? "warning" : briefing.severity === "ok" ? "ok" : "notice";

  return (
    <section className={`command-briefing command-${tone} ${briefing.stale ? "command-stale" : ""}`}>
      <div className="section-heading compact-section-heading">
        <h3><Sparkles size={16} /> Command Briefing</h3>
        <button className="icon-text-button" type="button" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? "spin" : ""} /> Refresh
        </button>
      </div>

      <div className="command-briefing-body">
        <div className="command-briefing-lead">
          <span className={`command-severity command-severity-${briefing.severity}`}>{briefing.severity}</span>
          <h4>{briefing.headline}</h4>
          <p>{briefing.summary}</p>
          <div className="command-meta">
            <span>{generated}</span>
            {briefing.stale ? <span>stale</span> : null}
            {briefing.model ? <span>{briefing.model}</span> : null}
            <span>{briefing.confidence} confidence</span>
          </div>
          {briefing.error ? <p className="host-error">{briefing.error}</p> : null}
        </div>

        {briefing.items.length > 0 ? (
          <div className="command-item-grid">
            {briefing.items.map((item) => (
              <article className={`command-item command-item-${item.severity}`} key={`${item.title}-${item.body}`}>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
                {item.evidenceIds.length > 0 ? (
                  <div className="command-evidence">
                    {item.evidenceIds.slice(0, 3).map((id) => <span key={id}>{id}</span>)}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}

        {briefing.nextActions.length > 0 ? (
          <div className="command-actions">
            {briefing.nextActions.map((action) => (
              <button className="icon-text-button" type="button" key={action.label} onClick={() => onAction(action)}>
                <Info size={14} /> {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ServiceCard({
  resource,
  density,
  checking,
  draggable,
  dragging,
  onOpen,
  onInspect,
  onFavorite,
  onRunCheck,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  resource: DashboardResource;
  density: Density;
  checking: boolean;
  draggable: boolean;
  dragging: boolean;
  onOpen: (resource: DashboardResource) => void;
  onInspect: (resource: DashboardResource) => void;
  onFavorite: (resource: DashboardResource) => void;
  onRunCheck: (resource: DashboardResource) => void;
  onDragStart: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const status = statusFor(resource);
  const ticks = resourceTicks(resource, density === "grid" ? 22 : 16);
  const uptime = uptimePercent(resource);
  const checked = latestCheckedAt(resource);
  const automatic = resource.monitoringMode === "auto";

  function activate() {
    if (resource.url) {
      onOpen(resource);
    } else {
      onInspect(resource);
    }
  }

  return (
    <article
      className={`svc-card svc-${status} ${dragging ? "is-dragging" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <button
        className="svc-primary"
        type="button"
        title={resource.url ? `Open ${resource.name}` : `Inspect ${resource.name}`}
        onClick={activate}
      >
        <header className="svc-top">
          <ServiceIcon resource={resource} size={40} />
          <span className="svc-name">
            <strong>{resource.name}</strong>
            <small>{serviceAddress(resource)}</small>
          </span>
          <span className={`svc-dot dot-${status}`} title={status} />
        </header>
        <Heartbeat ticks={ticks} slots={density === "grid" ? 22 : 16} className="svc-heartbeat" />
      </button>

      <footer className="svc-meta">
        <span className="svc-stat" title="Uptime across recent checks">{formatUptime(uptime)}</span>
        <span className="svc-stat" title="Latest latency">{monitoringLabel(resource)}</span>
        <span className="svc-stat svc-when" title="Last checked">{relativeTime(checked)}</span>

        <span className="svc-actions">
          <button
            className={`svc-action ${resource.favorite ? "is-active" : ""}`}
            type="button"
            aria-label={resource.favorite ? `Remove ${resource.name} from favorites` : `Add ${resource.name} to favorites`}
            onClick={() => onFavorite(resource)}
          >
            <Star size={14} fill={resource.favorite ? "currentColor" : "none"} />
          </button>
          {automatic ? (
            <button
              className="svc-action"
              type="button"
              aria-label={`Run all enabled health checks for ${resource.name}`}
              disabled={checking || (!resource.url && !resource.host)}
              onClick={() => onRunCheck(resource)}
            >
              <RefreshCw size={14} className={checking ? "spin" : ""} />
            </button>
          ) : null}
          <button className="svc-action" type="button" aria-label={`Show details for ${resource.name}`} onClick={(event) => { event.currentTarget.focus(); onInspect(resource); }}>
            <Info size={14} />
          </button>
          {resource.url ? (
            <button className="svc-action" type="button" aria-label={`Open ${resource.name} in a new tab`} onClick={() => onOpen(resource)}>
              <ExternalLink size={14} />
            </button>
          ) : null}
        </span>
      </footer>
    </article>
  );
}

export function DashboardConsole({
  data,
  username,
  systemSettings,
  onRefresh,
  onPatchResource,
  onRunCheck,
  onPatchGroup,
  onOpenServices,
  onAddServiceTemplate,
  onOpenSettings,
  onEditService,
  onReorder
}: {
  data: AppData;
  username: string;
  systemSettings: SystemSettingsDto;
  onRefresh: () => Promise<void>;
  onPatchResource: (id: string, body: Record<string, unknown>) => Promise<void>;
  onRunCheck: (resource: DashboardResource) => Promise<void>;
  onPatchGroup: (id: string, body: Record<string, unknown>) => Promise<void>;
  onOpenServices: () => void;
  onAddServiceTemplate: (templateId: string) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onEditService: (resource: DashboardResource) => void;
  onReorder: (orderedIds: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<DashboardMode>(readDashboardMode);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [density, setDensity] = useState<Density>(readDensity);
  const serviceDensity = mode === "launchpad" ? "grid" : density;
  const [checkingResourceId, setCheckingResourceId] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [inspectedHostId, setInspectedHostId] = useState<string | null>(null);
  const [hostDetail, setHostDetail] = useState<HostMonitorDto | null>(null);
  const [hostDetailLoading, setHostDetailLoading] = useState(false);
  const [hostDetailError, setHostDetailError] = useState<string | null>(null);
  const [inspectedIntegrationId, setInspectedIntegrationId] = useState<string | null>(null);
  const [integrationDetail, setIntegrationDetail] = useState<IntegrationSourceDto | null>(null);
  const [integrationDetailLoading, setIntegrationDetailLoading] = useState(false);
  const [integrationDetailError, setIntegrationDetailError] = useState<string | null>(null);
  const [aiBriefingRefreshing, setAiBriefingRefreshing] = useState(false);
  const [drag, setDrag] = useState<DragState>(null);
  const now = useClock();

  useEffect(() => {
    localStorage.setItem(DENSITY_KEY, density);
  }, [density]);

  useEffect(() => {
    localStorage.setItem(DASHBOARD_MODE_KEY, mode);
  }, [mode]);

  const resources = useMemo(
    () => dashboardResources(data.dashboard.groups, data.dashboard.ungroupedResources),
    [data.dashboard]
  );
  const hostMonitors = data.dashboard.hostMonitors ?? [];
  const integrations = data.dashboard.integrations ?? [];
  const apiWidgets = data.dashboard.apiWidgets ?? [];
  const aiBriefing = data.dashboard.aiBriefing ?? null;
  const briefing = data.dashboard.dailyBriefing;
  const directoryResources = resources.filter((resource) => !isBookmark(resource));
  const totals = summarizeResourceStatus(directoryResources);
  const favorites = resources.filter((resource) => resource.favorite);
  const offlineResources = directoryResources.filter((resource) => statusFor(resource) === "offline");
  const inspected = inspectedId ? resources.find((resource) => resource.id === inspectedId) ?? null : null;
  const inspectedHost = inspectedHostId
    ? hostDetail ?? hostMonitors.find((host) => host.id === inspectedHostId) ?? null
    : null;
  const inspectedIntegration = inspectedIntegrationId
    ? integrationDetail ?? integrations.find((source) => source.id === inspectedIntegrationId) ?? null
    : null;
  const offlineHosts = hostMonitors.filter((host) => host.latestStatus === "offline").length;
  const offlineIntegrations = integrations.filter((source) => source.status === "offline").length;
  const offlineApiWidgets = apiWidgets.filter((widget) => widget.latestStatus === "offline").length;
  const offlineGateways = integrations.reduce(
    (sum, source) => sum + (source.latestSnapshot?.provider === "opnsense" ? source.latestSnapshot.gateways.filter((gateway) => gateway.status === "offline").length : 0),
    0
  );
  const pressureHosts = briefing.hostsUnderPressure.length;
  const storageIssues = briefing.storageIssues ?? [];
  const dailyIssueCount =
    offlineResources.length +
    offlineHosts +
    offlineIntegrations +
    offlineApiWidgets +
    offlineGateways +
    pressureHosts +
    storageIssues.length +
    briefing.staleChecks.length +
    briefing.watchlist.length;
  const lastUpdatedAt = [
    ...resources.map(latestCheckedAt),
    ...hostMonitors.map((host) => host.latestSampledAt),
    ...integrations.map((source) => source.latestSampledAt),
    ...apiWidgets.map((widget) => widget.latestSampledAt)
  ]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

  const filters: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: directoryResources.length },
    { id: "favorites", label: "Favorites", count: totals.favorites },
    { id: "online", label: "Online", count: totals.online },
    { id: "offline", label: "Offline", count: totals.offline },
    { id: "unknown", label: "Unknown", count: totals.unknown }
  ];

  function matchesResource(resource: DashboardResource): boolean {
    if (isBookmark(resource)) return false;
    const status = statusFor(resource);
    const haystack = [resource.name, resource.url, resource.host, resource.kind, resource.description]
      .join(" ")
      .toLowerCase();
    const matchesQuery = haystack.includes(query.toLowerCase());
    const matchesFilter =
      statusFilter === "all" ||
      (statusFilter === "favorites" ? resource.favorite : status === statusFilter);
    return matchesQuery && matchesFilter;
  }

  const filteredGroups = data.dashboard.groups
    .map((group) => ({ ...group, resources: group.resources.filter(matchesResource) }))
    .filter((group) => group.resources.length > 0 || (mode !== "launchpad" && !query && statusFilter === "all"));
  const filteredUngrouped = data.dashboard.ungroupedResources.filter(matchesResource);
  const visibleCount =
    filteredGroups.reduce((sum, group) => sum + group.resources.length, 0) + filteredUngrouped.length;

  const reorderEnabled = mode === "launchpad" || (query === "" && statusFilter === "all");

  useEffect(() => {
    if (!inspectedHostId) {
      setHostDetail(null);
      setHostDetailError(null);
      setHostDetailLoading(false);
      return;
    }

    let active = true;
    setHostDetailLoading(true);
    setHostDetailError(null);

    apiGet<HostMonitorDto>(`/api/metrics/hosts/${inspectedHostId}`)
      .then((host) => {
        if (active) setHostDetail(host);
      })
      .catch((error) => {
        if (active) setHostDetailError(error instanceof Error ? error.message : "Host metrics failed to load");
      })
      .finally(() => {
        if (active) setHostDetailLoading(false);
      });

    return () => {
      active = false;
    };
  }, [inspectedHostId]);

  useEffect(() => {
    if (!inspectedIntegrationId) {
      setIntegrationDetail(null);
      setIntegrationDetailError(null);
      setIntegrationDetailLoading(false);
      return;
    }

    let active = true;
    setIntegrationDetailLoading(true);
    setIntegrationDetailError(null);

    apiGet<IntegrationSourceDto>(`/api/integrations/${inspectedIntegrationId}`)
      .then((source) => {
        if (active) setIntegrationDetail(source);
      })
      .catch((error) => {
        if (active) setIntegrationDetailError(error instanceof Error ? error.message : "Integration history failed to load");
      })
      .finally(() => {
        if (active) setIntegrationDetailLoading(false);
      });

    return () => {
      active = false;
    };
  }, [inspectedIntegrationId]);

  function openResource(resource: DashboardResource) {
    if (!resource.url) return;
    try {
      const target = new URL(resource.url, window.location.origin);
      if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Unsafe URL");
      window.open(target.toString(), "_blank", "noopener,noreferrer");
    } catch {
      setCheckError(`The URL for ${resource.name} is not a safe HTTP/HTTPS address.`);
    }
  }

  function resourceById(id: string): DashboardResource | null {
    return resources.find((resource) => resource.id === id) ?? null;
  }

  function inspectResource(id: string) {
    setInspectedId(id);
  }

  function editResource(id: string) {
    const resource = resourceById(id);
    if (resource) {
      onEditService(resource);
    }
  }

  function runResourceById(id: string) {
    const resource = resourceById(id);
    if (resource) {
      void runCheck(resource);
    }
  }

  function resourceByCheckId(checkId: string | null | undefined): DashboardResource | null {
    if (!checkId) return null;
    return resources.find((resource) => resource.healthChecks?.some((check) => check.id === checkId)) ?? null;
  }

  function runAiAction(action: AiBriefingActionDto) {
    const checkResource = resourceByCheckId(action.checkId);
    if (checkResource) {
      void runCheck(checkResource);
      return;
    }

    if (action.resourceId) {
      inspectResource(action.resourceId);
      return;
    }

    onOpenSettings();
  }

  async function refreshAiBriefing() {
    setAiBriefingRefreshing(true);
    setCheckError(null);
    try {
      await apiSend<AiBriefingDto>("/api/ai/briefing/run", "POST");
      await onRefresh();
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "AI briefing failed");
    } finally {
      setAiBriefingRefreshing(false);
    }
  }

  async function runCheck(resource: DashboardResource) {
    setCheckingResourceId(resource.id);
    setCheckError(null);
    try {
      await onRunCheck(resource);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "Health check failed");
    } finally {
      setCheckingResourceId(null);
    }
  }

  function handleDrop(containerKey: string, containerIds: string[], targetId: string | null, event: DragEvent) {
    event.preventDefault();
    if (!drag || drag.container !== containerKey) {
      setDrag(null);
      return;
    }

    const withoutDragged = containerIds.filter((id) => id !== drag.id);
    let insertAt = targetId ? withoutDragged.indexOf(targetId) : withoutDragged.length;
    if (insertAt < 0) {
      insertAt = withoutDragged.length;
    } else if (targetId) {
      const target = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const isAfter = serviceDensity === "list"
        ? event.clientY > target.top + target.height / 2
        : event.clientX > target.left + target.width / 2;
      if (isAfter) insertAt += 1;
    }

    const next = [...withoutDragged];
    next.splice(insertAt, 0, drag.id);
    setDrag(null);

    if (next.join() !== containerIds.join()) {
      void onReorder(next);
    }
  }

  function renderCards(containerKey: string, items: DashboardResource[]) {
    const ids = items.map((item) => item.id);

    return (
      <div
        className={`svc-collection density-${serviceDensity}`}
        onDragOver={(event) => {
          if (drag?.container === containerKey) event.preventDefault();
        }}
        onDrop={(event) => handleDrop(containerKey, ids, null, event)}
      >
        {items.map((resource) => (
          <ServiceCard
            key={resource.id}
            resource={resource}
            density={serviceDensity}
            checking={checkingResourceId === resource.id}
            draggable={reorderEnabled}
            dragging={drag?.id === resource.id}
            onOpen={openResource}
            onInspect={(item) => setInspectedId(item.id)}
            onFavorite={(item) => void onPatchResource(item.id, { favorite: !item.favorite })}
            onRunCheck={(item) => void runCheck(item)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              setDrag({ id: resource.id, container: containerKey });
            }}
            onDragOver={(event) => {
              if (drag?.container === containerKey) event.preventDefault();
            }}
            onDrop={(event) => {
              event.stopPropagation();
              handleDrop(containerKey, ids, resource.id, event);
            }}
            onDragEnd={() => setDrag(null)}
          />
        ))}
      </div>
    );
  }

  const serviceDirectory = (
    <>
      {checkError ? <div className="app-error">{checkError}</div> : null}
      <div className="hp-service-groups">
        {data.dashboard.ungroupedResources.some(r => !isBookmark(r)) && renderCards("ungrouped", data.dashboard.ungroupedResources.filter(r => !isBookmark(r)))}
        {data.dashboard.groups.map(group => {
          const items = group.resources.filter(r => !isBookmark(r));
          if (!items.length) return null;
          return <section className="service-group" key={group.id}>
            <div className="service-group-header">
              <button className="group-toggle" type="button" aria-expanded={!group.collapsed} onClick={() => onPatchGroup(group.id, { collapsed: !group.collapsed })}>
                {group.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<h3>{group.name}</h3>
              </button>
            </div>
            {!group.collapsed && renderCards(group.id, items)}
          </section>;
        })}
        {!directoryResources.length && <p className="muted-copy">Add your first service with Manage services.</p>}
      </div>
    </>
  );

  const overlays = (
    <>
      {inspected ? (
        <ServiceDrawer
          resource={inspected}
          checking={checkingResourceId === inspected.id}
          onClose={() => setInspectedId(null)}
          onOpen={openResource}
          onFavorite={(item) => void onPatchResource(item.id, { favorite: !item.favorite })}
          onRunCheck={(item) => void runCheck(item)}
          onEdit={(item) => {
            setInspectedId(null);
            onEditService(item);
          }}
        />
      ) : null}

      {inspectedHost ? (
        <HostDetailDrawer
          host={inspectedHost}
          loading={hostDetailLoading}
          error={hostDetailError}
          onClose={() => setInspectedHostId(null)}
        />
      ) : null}

      {inspectedIntegration ? (
        <IntegrationDetailDrawer
          source={inspectedIntegration}
          loading={integrationDetailLoading}
          error={integrationDetailError}
          onClose={() => setInspectedIntegrationId(null)}
        />
      ) : null}
    </>
  );

  const signalCount = hostMonitors.length + integrations.length + apiWidgets.length;
  const unknownSignals = hostMonitors.some(host => host.latestStatus === "unknown") || integrations.some(source => source.status === "unknown") || apiWidgets.some(widget => widget.latestStatus === "unknown");
  const operationsHealth: HealthItem[] = [serviceHealth(directoryResources, resource => setInspectedId(resource.id)), {
    id: "operations", tone: dailyIssueCount > 0 ? (offlineResources.length + offlineHosts + offlineIntegrations + offlineApiWidgets + offlineGateways > 0 ? "error" : "warning") : unknownSignals || !signalCount ? "neutral" : "healthy",
    label: dailyIssueCount > 0 ? `${dailyIssueCount} operational item${dailyIssueCount === 1 ? "" : "s"} need attention` : unknownSignals ? "Some operational signals are unknown" : !signalCount ? "No operational integrations" : "Operational signals healthy",
    details: dailyIssueCount > 0 ? [{ id: "attention", label: "Operational issues", actionLabel: "View attention briefing", onAction: () => document.getElementById("operations-attention")?.focus() }]
      : unknownSignals || !signalCount ? [{ id: "connections", label: unknownSignals ? "Waiting for operational data" : "Connect operational data", actionLabel: "Integration settings", onAction: () => onOpenSettings("integrations") }] : [],
  }];

  const dateLine = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (mode === "launchpad") {
    return (
      <main className="view-shell dashboard-view launchpad-view homepage-shell">
        <BrowserHomepage username={username} now={now} settings={systemSettings} onOperations={() => setMode("operations")} onSettings={onOpenSettings} services={resources.filter(r => !isBookmark(r))} serviceDirectory={serviceDirectory} onInspectService={resource => setInspectedId(resource.id)} />
        {overlays}
      </main>
    );
  }

  return (
    <main className="view-shell dashboard-view">
      <header className="dash-hero ops-hero">
        <div className="dash-hero-copy">
          <span className="ops-eyebrow">{greetingFor(now)}{username ? `, ${username}` : ""}</span>
          <h2>Lab Command Center</h2>
          <p>
            {dateLine}
            <span className="dash-hero-sep">·</span>
            {directoryResources.length} service{directoryResources.length === 1 ? "" : "s"}
            <span className="dash-hero-sep">·</span>
            {hostMonitors.length} host monitor{hostMonitors.length === 1 ? "" : "s"}
            {integrations.length > 0 ? (
              <>
                <span className="dash-hero-sep">·</span>
                {integrations.length} integration{integrations.length === 1 ? "" : "s"}
              </>
            ) : null}
            {apiWidgets.length > 0 ? (
              <>
                <span className="dash-hero-sep">·</span>
                {apiWidgets.length} API widget{apiWidgets.length === 1 ? "" : "s"}
              </>
            ) : null}
          </p>
        </div>
        <div className="ops-status-panel">
          <div className="dash-clock" aria-hidden>{clock}</div>
          <small>{lastUpdatedAt ? `Updated ${relativeTime(lastUpdatedAt)}` : "No samples yet"}</small>
          <DashboardModeSwitch mode={mode} onChange={setMode} />
        </div>
      </header>

      <HealthStrip items={operationsHealth} />

      {(dailyIssueCount > 0 || briefing.recentChanges.length > 0) && (
      <section className="daily-briefing" id="operations-attention" tabIndex={-1}>
        <div className="section-heading compact-section-heading">
          <h3>Daily Briefing</h3>
          <span className="group-meta">last 24h</span>
        </div>
        <div className="briefing-summary-strip">
          <span><small>Services</small><strong>{briefing.summary.servicesOnline}/{briefing.summary.servicesTotal} online</strong></span>
          <span><small>Attention</small><strong>{dailyIssueCount}</strong></span>
          <span><small>Hosts</small><strong>{briefing.summary.hostsOffline} offline · {briefing.summary.hostsUnderPressure} pressure</strong></span>
          <span><small>Watchlist</small><strong>{briefing.summary.pendingFailures} failing · {briefing.summary.pendingRecoveries} recovering</strong></span>
        </div>
        <div className="briefing-grid">
          {briefing.offlineServices.length > 0 ? (
          <article className="briefing-card briefing-danger">
            <strong><AlertTriangle size={15} /> Offline services</strong>
            {briefing.offlineServices.map((item) => {
                const resource = resourceById(item.id);
                return (
                  <div className="briefing-action-row" key={item.id}>
                    <button className="briefing-main-action" type="button" onClick={() => inspectResource(item.id)}>
                      <span>{item.name}</span>
                      <small>{item.error ?? "offline"}</small>
                    </button>
                    {resource?.monitoringMode === "auto" ? (
                      <button className="svc-action" type="button" title="Run check" onClick={() => runResourceById(item.id)}>
                        <RefreshCw size={13} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
          </article>
          ) : null}

          {briefing.hostsUnderPressure.length > 0 ? (
          <article className="briefing-card briefing-warning">
            <strong><Cpu size={15} /> Host pressure</strong>
            {briefing.hostsUnderPressure.map((item) => (
                <span key={`${item.id}-${item.metric}`}>
                  <i>{item.name}</i>
                  <small>{item.metric} {formatPercent(item.value)}</small>
                </span>
              ))}
          </article>
          ) : null}
          {storageIssues.length > 0 ? (
            <article className="briefing-card briefing-warning">
              <strong><HardDrive size={15} /> Storage</strong>
              {storageIssues.map((item) => (
                <button key={item.id} type="button" onClick={() => setInspectedIntegrationId(item.id)}>
                  <span>{item.name}</span><small>{item.health} · {item.usedPercent}% used</small>
                </button>
              ))}
            </article>
          ) : null}

          {briefing.recentChanges.length > 0 ? (
          <article className="briefing-card">
            <strong><Activity size={15} /> 24h timeline</strong>
            {briefing.recentChanges.map((item) => (
                <button key={`${item.resourceId}-${item.changedAt}`} type="button" onClick={() => inspectResource(item.resourceId)}>
                  <span>{item.name}</span>
                  <small>{item.status} · {relativeTime(item.changedAt)}</small>
                </button>
              ))}
          </article>
          ) : null}

          {briefing.watchlist.length > 0 ? (
          <article className="briefing-card briefing-warning">
            <strong><RefreshCw size={15} /> Threshold watchlist</strong>
            {briefing.watchlist.map((item) => (
                <div className="briefing-action-row" key={item.checkId}>
                  <button className="briefing-main-action" type="button" onClick={() => inspectResource(item.resourceId)}>
                    <span>{item.resourceName}</span>
                    <small>
                      {item.direction === "failing" ? "failing" : "recovering"} · {item.consecutive}/{item.threshold}
                    </small>
                  </button>
                  <button className="svc-action" type="button" title="Run check" onClick={() => runResourceById(item.resourceId)}>
                    <RefreshCw size={13} />
                  </button>
                </div>
              ))}
          </article>
          ) : null}

          {briefing.staleChecks.length > 0 ? (
          <article className="briefing-card briefing-warning">
            <strong><RefreshCw size={15} /> Stale checks</strong>
            {briefing.staleChecks.slice(0, 4).map((item) => (
              <div className="briefing-action-row" key={item.checkId}>
                <button className="briefing-main-action" type="button" onClick={() => inspectResource(item.resourceId)}>
                  <span>{item.resourceName}</span>
                  <small>stale · {item.lastCheckedAt ? relativeTime(item.lastCheckedAt) : "never"}</small>
                </button>
                <button className="svc-action" type="button" title="Run check" onClick={() => runResourceById(item.resourceId)}>
                  <RefreshCw size={13} />
                </button>
              </div>
            ))}
          </article>
          ) : null}
        </div>
      </section>
      )}

      {hostMonitors.length > 0 ? (
        <section className="lab-vitals">
        <div className="section-heading compact-section-heading">
          <h3>Lab Vitals</h3>
          <button className="icon-text-button" type="button" onClick={() => onOpenSettings()}>
            <Plus size={14} /> Host monitor
          </button>
        </div>
        <div className="host-grid">
          {hostMonitors.map((host) => (
            <HostVitalsCard key={host.id} host={host} onInspect={(item) => setInspectedHostId(item.id)} />
          ))}
        </div>
      </section>
      ) : null}

      {hostMonitors.length === 0 && integrations.length === 0 && apiWidgets.length === 0 && !aiBriefing ? (
        <button className="operations-connect-panel" type="button" onClick={() => onOpenSettings()}>
          <span className="host-icon"><Server size={19} /></span>
          <span>
            <strong>Connect operations data</strong>
            <small>Add a Glances host, OPNsense integration, or read-only API widget when you are ready.</small>
          </span>
          <Plus size={16} />
        </button>
      ) : null}

      {integrations.length > 0 ? (
        <section className="lab-vitals integration-vitals">
          <div className="section-heading compact-section-heading">
            <h3>OPNsense</h3>
            <button className="icon-text-button" type="button" onClick={() => onOpenSettings()}>
              <RefreshCw size={14} /> Integration
            </button>
          </div>
          <div className="host-grid integration-grid">
            {integrations.map((source) => (
              <IntegrationCard
                key={source.id}
                source={source}
                onInspect={(item) => setInspectedIntegrationId(item.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {apiWidgets.length > 0 ? (
        <section className="lab-vitals api-widget-vitals">
          <div className="section-heading compact-section-heading">
            <h3>API Widgets</h3>
            <button className="icon-text-button" type="button" onClick={() => onOpenSettings()}>
              <Plus size={14} /> Widget
            </button>
          </div>
          <div className="api-widget-grid">
            {apiWidgets.map((widget) => (
              <ApiWidgetCard key={widget.id} widget={widget} />
            ))}
          </div>
        </section>
      ) : null}

      {aiBriefing ? (
        <CommandBriefingPanel
          briefing={aiBriefing}
          refreshing={aiBriefingRefreshing}
          onRefresh={() => void refreshAiBriefing()}
          onAction={runAiAction}
        />
      ) : null}

      <div className="dash-toolbar">
        <label className="search-box service-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services" />
          <kbd>⌘K</kbd>
        </label>

        <div className="filter-chips" aria-label="Service filters">
          {filters.map((filter) => (
            <button
              key={filter.id}
              className={statusFilter === filter.id ? "active" : ""}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
            >
              {filter.label}
              <i>{filter.count}</i>
            </button>
          ))}
        </div>

        <div className="dash-toolbar-end">
          <div className="segmented-control density-toggle" role="group" aria-label="Layout density">
            <button
              className={density === "grid" ? "active" : ""}
              type="button"
              title="Grid view"
              onClick={() => setDensity("grid")}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              className={density === "list" ? "active" : ""}
              type="button"
              title="List view"
              onClick={() => setDensity("list")}
            >
              <Rows3 size={15} />
            </button>
          </div>
          <button className="icon-button" type="button" title="Refresh" onClick={() => void onRefresh()}>
            <RefreshCw size={16} />
          </button>
          <button className="primary-button header-primary-action" type="button" onClick={onOpenServices}>
            <Plus size={16} /> Add service
          </button>
        </div>
      </div>

      {checkError ? <div className="app-error">{checkError}</div> : null}

      {offlineResources.length > 0 && statusFilter === "all" && !query ? (
        <section className="attention-strip" aria-label="Services needing attention">
          <span className="attention-label">
            <AlertTriangle size={15} />
            {offlineResources.length} service{offlineResources.length === 1 ? "" : "s"} down
          </span>
          <div className="attention-chips">
            {offlineResources.map((resource) => (
              <button
                key={resource.id}
                type="button"
                title={latestErrors(resource)[0] ?? "Offline"}
                onClick={() => setInspectedId(resource.id)}
              >
                {resource.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {favorites.length > 0 && statusFilter === "all" && !query ? (
        <section className="favorites-strip" aria-label="Favorites">
          {favorites.map((resource) => {
            const status = statusFor(resource);
            return (
              <button
                key={resource.id}
                className="favorite-tile"
                type="button"
                title={resource.url ? `Open ${resource.name}` : resource.name}
                onClick={() => (resource.url ? openResource(resource) : setInspectedId(resource.id))}
              >
                <ServiceIcon resource={resource} size={40} />
                <span>{resource.name}</span>
                <i className={`svc-dot dot-${status}`} />
              </button>
            );
          })}
        </section>
      ) : null}

      {resources.length === 0 ? (
        <EmptyPanel
          icon={<Server size={36} />}
          title="No services yet"
          body="Add Plex, Home Assistant, NAS, router, websites, and anything else you host."
          action={
            <button className="icon-text-button" type="button" onClick={onOpenServices}>
              <Plus size={16} /> Add service
            </button>
          }
        />
      ) : null}

      {filteredGroups.map((group) => {
        const groupTotals = summarizeResourceStatus(group.resources);
        return (
          <section className="service-group" key={group.id}>
            <div className="service-group-header">
              <button
                className="group-toggle"
                type="button"
                onClick={() => onPatchGroup(group.id, { collapsed: !group.collapsed })}
              >
                {group.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                <h3>{group.name}</h3>
              </button>
              <span className="group-meta">
                {groupTotals.online}/{group.resources.length} online
              </span>
            </div>
            {!group.collapsed ? renderCards(group.id, group.resources) : null}
          </section>
        );
      })}

      {filteredUngrouped.length > 0 ? (
        <section className="service-group">
          <div className="service-group-header">
            <h3>Ungrouped</h3>
            <span className="group-meta">
              {summarizeResourceStatus(filteredUngrouped).online}/{filteredUngrouped.length} online
            </span>
          </div>
          {renderCards("ungrouped", filteredUngrouped)}
        </section>
      ) : null}

      {directoryResources.length > 0 && visibleCount === 0 ? (
        <EmptyPanel icon={<Search size={36} />} title="No services match" body="Clear search or change the status filter." />
      ) : null}

      {overlays}
    </main>
  );
}
