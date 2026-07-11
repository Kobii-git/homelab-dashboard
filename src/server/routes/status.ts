import type { RouteContext } from "./types.js";
import { getBuildInfo } from "../../shared/version.js";

const STATUS_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { font-family: Inter, system-ui, -apple-system, sans-serif; background: radial-gradient(1200px 500px at 50% -10%, rgba(45,212,191,.08), transparent), #0c0f11; color: #e7eef2; margin: 0; padding: 32px 20px 64px; }
.wrap { max-width: 760px; margin: 0 auto; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.mark { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: linear-gradient(135deg, rgba(45,212,191,.25), rgba(45,212,191,.05)); border: 1px solid rgba(45,212,191,.35); }
.mark span { width: 12px; height: 12px; border-radius: 50%; background: #2dd4bf; box-shadow: 0 0 12px rgba(45,212,191,.8); }
h1 { margin: 0; font-size: 1.25rem; letter-spacing: -.01em; }
.meta { color: #76878f; margin: 2px 0 0; font-size: .78rem; }
.banner { display: flex; align-items: center; gap: 10px; margin: 22px 0; padding: 14px 16px; border-radius: 12px; border: 1px solid rgba(45,212,191,.3); background: rgba(45,212,191,.07); font-weight: 600; }
.banner.degraded, .banner.error { border-color: rgba(242,100,100,.4); background: rgba(242,100,100,.08); }
.banner.unknown { border-color: rgba(250,204,21,.35); background: rgba(250,204,21,.08); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #2dd4bf; }
.degraded .dot, .error .dot { background: #f26464; }
.unknown .dot { background: #facc15; }
.retry { margin-left: auto; border: 1px solid #40505a; border-radius: 7px; background: #151c20; color: #e7eef2; padding: 5px 10px; cursor: pointer; }
.retry[hidden] { display: none; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; }
.chip { padding: 5px 11px; border-radius: 999px; border: 1px solid #28323a; font-size: .78rem; color: #b9c6cc; background: #11161a; }
.chip b { color: #e7eef2; }
.grid { display: grid; gap: 10px; }
.row { padding: 13px 16px; border: 1px solid #232c33; border-radius: 12px; background: rgba(20,26,30,.85); }
.row-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.row strong { font-size: .92rem; }
.right { display: flex; align-items: center; gap: 10px; font-size: .78rem; color: #9fb0b8; white-space: nowrap; }
.state { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; text-transform: capitalize; }
.state i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.state-online { color: #4be3ab; } .state-online i { background: #4be3ab; }
.state-offline { color: #ff9d9d; } .state-offline i { background: #ff9d9d; }
.state-unknown { color: #93a4ad; } .state-unknown i { background: #93a4ad; }
.ticks { display: flex; gap: 3px; align-items: center; height: 22px; margin-top: 10px; }
.tick { flex: 1; max-width: 9px; height: 16px; border-radius: 3px; background: #2b343b; }
.tick.online { background: #19b385; } .tick.offline { background: #e05252; height: 22px; }
footer { margin-top: 28px; color: #5b6a72; font-size: .74rem; text-align: center; }
@media (max-width: 480px) { body { padding: 22px 14px 48px; } .row-top { align-items: flex-start; } .right { flex-direction: column; align-items: flex-end; gap: 4px; } }
`;

const STATUS_JS = `
(function () {
  var retryButton = document.getElementById('retry');
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }
  function renderTicks(parent, ticks) {
    if (!Array.isArray(ticks) || ticks.length === 0) return;
    var bar = element('div', 'ticks');
    bar.setAttribute('aria-label', 'Recent heartbeat history');
    ticks.slice(-30).forEach(function (status) {
      var tick = element('span', 'tick ' + (status === 'online' || status === 'offline' ? status : 'unknown'));
      tick.title = String(status);
      bar.appendChild(tick);
    });
    parent.appendChild(bar);
  }
  function renderSummary(data) {
    var banner = document.getElementById('banner');
    banner.className = 'banner ' + data.overallStatus;
    document.getElementById('banner-text').textContent = data.overallStatus === 'operational'
      ? 'All monitored systems operational'
      : data.overallStatus === 'degraded'
        ? data.summary.offline + ' service' + (data.summary.offline === 1 ? '' : 's') + ' down'
        : 'System status is not yet known';
    retryButton.hidden = true;
    var chips = document.getElementById('chips');
    chips.replaceChildren();
    [['services', data.summary.resources], ['online', data.summary.online], ['offline', data.summary.offline], ['unknown', data.summary.unknown]].forEach(function (item) {
      var chip = element('span', 'chip');
      chip.appendChild(element('b', '', item[1]));
      chip.appendChild(document.createTextNode(' ' + item[0]));
      chips.appendChild(chip);
    });
    var list = document.getElementById('list');
    list.replaceChildren();
    data.resources.forEach(function (resource) {
      var row = element('article', 'row');
      var top = element('div', 'row-top');
      top.appendChild(element('strong', '', resource.name));
      var right = element('div', 'right');
      if (resource.uptimePercent != null) right.appendChild(element('span', '', resource.uptimePercent + '% uptime'));
      var state = element('span', 'state state-' + resource.status, resource.status);
      state.prepend(element('i'));
      right.appendChild(state);
      top.appendChild(right);
      row.appendChild(top);
      renderTicks(row, resource.ticks);
      list.appendChild(row);
    });
    document.getElementById('updated').textContent = 'Updated ' + new Date(data.generatedAt).toLocaleString() + ' · auto-refreshes every 30s';
  }
  async function refresh() {
    try {
      var response = await fetch('/api/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('Status request failed');
      renderSummary(await response.json());
    } catch (_) {
      var banner = document.getElementById('banner');
      banner.className = 'banner error';
      document.getElementById('banner-text').textContent = 'Status data is temporarily unavailable';
      retryButton.hidden = false;
      document.getElementById('updated').textContent = 'Unable to refresh status';
    }
  }
  retryButton.addEventListener('click', refresh);
  refresh();
  window.setInterval(refresh, 30000);
}());
`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

export async function registerStatusRoutes({ app, prisma }: RouteContext): Promise<void> {
  app.get("/api/status", async () => {
    const resources = await prisma.resource.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        name: true,
        monitoringMode: true,
        manualStatus: true,
        healthChecks: {
          select: {
            enabled: true,
            latestStatus: true,
            results: {
              orderBy: { checkedAt: "desc" },
              take: 40,
              select: { status: true }
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

    function resourceTicks(resource: (typeof resources)[number]): Array<"online" | "offline" | "unknown"> {
      if (resource.monitoringMode !== "auto") return [];
      const primary = resource.healthChecks.find((check) => check.enabled && check.results.length > 0);
      if (!primary) return [];
      return [...primary.results].reverse().map((result) =>
        result.status === "online" || result.status === "offline" ? result.status : "unknown"
      );
    }

    function resourceUptime(resource: (typeof resources)[number]): number | null {
      if (resource.monitoringMode !== "auto") return null;
      const results = resource.healthChecks.filter((check) => check.enabled).flatMap((check) => check.results);
      const counted = results.filter((result) => result.status === "online" || result.status === "offline");
      if (counted.length === 0) return null;
      return Math.round((counted.filter((result) => result.status === "online").length / counted.length) * 1000) / 10;
    }

    const statuses = resources.map(resourceStatus);
    const online = statuses.filter((status) => status === "online").length;
    const offline = statuses.filter((status) => status === "offline").length;
    const unknown = statuses.length - online - offline;
    const overallStatus = offline > 0 ? "degraded" : unknown > 0 || resources.length === 0 ? "unknown" : "operational";

    return {
      ok: overallStatus === "operational",
      overallStatus,
      ...getBuildInfo(),
      summary: { resources: resources.length, online, offline, unknown },
      resources: resources.map((resource) => ({
        name: resource.name,
        status: resourceStatus(resource),
        uptimePercent: resourceUptime(resource),
        ticks: resourceTicks(resource)
      })),
      generatedAt: new Date().toISOString()
    };
  });

  app.get("/status.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(STATUS_CSS));
  app.get("/status.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(STATUS_JS));
  app.get("/status", async (_request, reply) => {
    const build = getBuildInfo();
    reply.type("text/html; charset=utf-8").send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Homelab Status</title><link rel="stylesheet" href="/status.css"></head>
<body><main class="wrap"><header><div class="mark" aria-hidden="true"><span></span></div><div><h1>Homelab Status</h1><p class="meta">v${escapeHtml(build.version)} · ${escapeHtml(build.gitSha)} · read-only</p></div></header>
<div id="banner" class="banner unknown" role="status"><span class="dot" aria-hidden="true"></span><span id="banner-text">Loading status…</span><button id="retry" class="retry" type="button" hidden>Retry</button></div>
<div id="chips" class="chips"></div><div id="list" class="grid"></div><footer id="updated">Loading…</footer></main><script src="/status.js" defer></script></body></html>`);
  });
}
