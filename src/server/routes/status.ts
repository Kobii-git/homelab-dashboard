import type { RouteContext } from "./types.js";
import { getBuildInfo } from "../../shared/version.js";

export async function registerStatusRoutes({ app, prisma }: RouteContext): Promise<void> {
  app.get("/api/status", async () => {
    const resources = await prisma.resource.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        kind: true,
        url: true,
        host: true,
        monitoringMode: true,
        manualStatus: true,
        healthChecks: {
          select: {
            id: true,
            type: true,
            target: true,
            enabled: true,
            latestStatus: true,
            latestLatencyMs: true,
            latestCheckedAt: true,
            latestError: true,
            results: {
              orderBy: { checkedAt: "desc" },
              take: 40,
              select: { status: true, latencyMs: true, checkedAt: true }
            }
          }
        }
      }
    });

    function resourceStatus(resource: (typeof resources)[number]): "online" | "offline" | "unknown" {
      if (resource.monitoringMode === "manual" || resource.monitoringMode === "disabled") {
        return resource.manualStatus === "online" || resource.manualStatus === "offline" ? resource.manualStatus : "unknown";
      }

      const enabledChecks = resource.healthChecks.filter((check) => check.enabled);
      if (enabledChecks.some((check) => check.latestStatus === "offline")) return "offline";
      if (enabledChecks.some((check) => check.latestStatus === "online")) return "online";
      return "unknown";
    }

    function resourceTicks(resource: (typeof resources)[number]) {
      if (resource.monitoringMode !== "auto") return [];
      const primary = resource.healthChecks.find((check) => check.enabled && check.results.length > 0);
      if (!primary) return [];
      return [...primary.results]
        .reverse()
        .map((result) => ({ status: result.status, latencyMs: result.latencyMs, checkedAt: result.checkedAt }));
    }

    function resourceUptime(resource: (typeof resources)[number]): number | null {
      if (resource.monitoringMode !== "auto") return null;
      const results = resource.healthChecks.filter((check) => check.enabled).flatMap((check) => check.results);
      const counted = results.filter((result) => result.status === "online" || result.status === "offline");
      if (counted.length === 0) return null;
      const online = counted.filter((result) => result.status === "online").length;
      return Math.round((online / counted.length) * 1000) / 10;
    }

    const statuses = resources.map(resourceStatus);
    const checks = resources.flatMap((resource) =>
      resource.monitoringMode === "auto" ? resource.healthChecks.filter((check) => check.enabled) : []
    );

    const online = statuses.filter((status) => status === "online").length;
    const offline = statuses.filter((status) => status === "offline").length;
    const unknown = statuses.length - online - offline;

    return {
      ok: offline === 0,
      ...getBuildInfo(),
      summary: {
        resources: resources.length,
        checks: checks.length,
        online,
        offline,
        unknown
      },
      resources: resources.map((resource) => ({
        id: resource.id,
        name: resource.name,
        kind: resource.kind,
        url: resource.url,
        host: resource.host,
        status: resourceStatus(resource),
        monitoringMode: resource.monitoringMode,
        uptimePercent: resourceUptime(resource),
        latencyMs: resource.healthChecks.find((check) => check.enabled)?.latestLatencyMs ?? null,
        ticks: resourceTicks(resource),
        checks: resource.healthChecks.map(({ results: _results, ...check }) => check)
      })),
      generatedAt: new Date().toISOString()
    };
  });

  app.get("/status", async (_request, reply) => {
    const build = getBuildInfo();
    reply.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Homelab Status</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230e1112'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%232dd4bf'/%3E%3C/svg%3E" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      font-family: Inter, system-ui, -apple-system, sans-serif;
      background: radial-gradient(1200px 500px at 50% -10%, rgba(45, 212, 191, 0.08), transparent), #0c0f11;
      color: #e7eef2; margin: 0; padding: 32px 20px 64px;
    }
    .wrap { max-width: 760px; margin: 0 auto; }
    header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
    .mark { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center;
      background: linear-gradient(135deg, rgba(45,212,191,.25), rgba(45,212,191,.05)); border: 1px solid rgba(45,212,191,.35); }
    .mark span { width: 12px; height: 12px; border-radius: 50%; background: #2dd4bf; box-shadow: 0 0 12px rgba(45,212,191,.8); }
    h1 { margin: 0; font-size: 1.25rem; letter-spacing: -0.01em; }
    .meta { color: #76878f; margin: 2px 0 0; font-size: 0.78rem; }
    .banner { display: flex; align-items: center; gap: 10px; margin: 22px 0; padding: 14px 16px;
      border-radius: 12px; border: 1px solid rgba(45,212,191,.3); background: rgba(45,212,191,.07); font-weight: 600; }
    .banner.bad { border-color: rgba(242,100,100,.4); background: rgba(242,100,100,.08); }
    .banner .dot { width: 10px; height: 10px; border-radius: 50%; background: #2dd4bf; animation: pulse 2.4s infinite; }
    .banner.bad .dot { background: #f26464; }
    @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(45,212,191,.4); } 50% { box-shadow: 0 0 0 6px rgba(45,212,191,0); } }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; }
    .chip { padding: 5px 11px; border-radius: 999px; border: 1px solid #28323a; font-size: 0.78rem; color: #b9c6cc; background: #11161a; }
    .chip b { color: #e7eef2; }
    .grid { display: grid; gap: 10px; }
    .row { padding: 13px 16px; border: 1px solid #232c33; border-radius: 12px; background: rgba(20, 26, 30, 0.85); }
    .row-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .row strong { font-size: 0.92rem; }
    .row small { color: #76878f; display: block; margin-top: 2px; font-size: 0.75rem; }
    .right { display: flex; align-items: center; gap: 10px; font-size: 0.78rem; color: #9fb0b8; white-space: nowrap; }
    .s { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
    .s i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .s-online { color: #4be3ab; } .s-online i { background: #4be3ab; }
    .s-offline { color: #ff9d9d; } .s-offline i { background: #ff9d9d; }
    .s-unknown { color: #93a4ad; } .s-unknown i { background: #93a4ad; }
    .ticks { display: flex; gap: 3px; align-items: center; height: 22px; margin-top: 10px; }
    .tick { flex: 1; max-width: 9px; height: 16px; border-radius: 3px; background: #2b343b; transition: height .15s; }
    .tick.online { background: #19b385; } .tick.offline { background: #e05252; height: 22px; }
    .tick:hover { filter: brightness(1.25); }
    footer { margin-top: 28px; color: #5b6a72; font-size: 0.74rem; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="mark"><span></span></div>
      <div>
        <h1>Homelab Status</h1>
        <p class="meta">v${build.version} · ${build.gitSha} · read-only</p>
      </div>
    </header>
    <div id="banner" class="banner"><span class="dot"></span><span id="banner-text">Loading…</span></div>
    <div id="chips" class="chips"></div>
    <div id="list" class="grid"></div>
    <footer id="updated">Auto-refreshes every 30 seconds</footer>
  </div>
  <script>
    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, function(ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] || ch;
      });
    }
    function ticksHtml(ticks) {
      if (!ticks || !ticks.length) return '';
      return '<div class="ticks">' + ticks.slice(-30).map(function(tick) {
        var when = new Date(tick.checkedAt).toLocaleString();
        var label = tick.status + (tick.latencyMs != null ? ' · ' + tick.latencyMs + ' ms' : '') + ' · ' + when;
        return '<span class="tick ' + esc(tick.status) + '" title="' + esc(label) + '"></span>';
      }).join('') + '</div>';
    }
    async function render() {
      const data = await fetch('/api/status').then(function(r) { return r.json(); });
      const banner = document.getElementById('banner');
      banner.className = 'banner' + (data.ok ? '' : ' bad');
      document.getElementById('banner-text').textContent = data.ok
        ? 'All systems operational'
        : data.summary.offline + ' service' + (data.summary.offline === 1 ? '' : 's') + ' down';
      document.getElementById('chips').innerHTML = [
        '<span class="chip"><b>' + data.summary.resources + '</b> services</span>',
        '<span class="chip"><b>' + data.summary.online + '</b> online</span>',
        '<span class="chip"><b>' + data.summary.offline + '</b> offline</span>',
        '<span class="chip"><b>' + data.summary.checks + '</b> active checks</span>'
      ].join('');
      document.getElementById('list').innerHTML = data.resources.map(function(resource) {
        var uptime = resource.uptimePercent != null ? resource.uptimePercent + '%' : '';
        var latency = resource.latencyMs != null ? resource.latencyMs + ' ms' : '';
        var metaBits = [uptime, latency].filter(Boolean).join(' · ');
        return '<div class="row">'
          + '<div class="row-top"><div><strong>' + esc(resource.name) + '</strong>'
          + '<small>' + esc(resource.host || resource.url || resource.kind) + '</small></div>'
          + '<div class="right">' + (metaBits ? '<span>' + esc(metaBits) + '</span>' : '')
          + '<span class="s s-' + esc(resource.status) + '"><i></i>' + esc(resource.status) + '</span></div></div>'
          + ticksHtml(resource.ticks)
          + '</div>';
      }).join('');
      document.getElementById('updated').textContent = 'Updated ' + new Date(data.generatedAt).toLocaleString() + ' · auto-refreshes every 30s';
    }
    render();
    setInterval(render, 30000);
  </script>
</body>
</html>`);
  });
}
