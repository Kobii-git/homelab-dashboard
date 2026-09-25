import type { RouteContext } from "./types.js";

// Public status is a standalone document; mirror the app's presentation tokens without loading its private UI.
const STATUS_CSS = `
:root { color-scheme: dark; --bg:#1a2430; --surface:#25313f; --surface-2:#2e3c4b; --border:#3a4a5a; --text:#e7edf2; --text-muted:#acbac7; --accent:#68d5c1; --success:#2fd79b; --danger:#ff8b8b; --shadow:0 1px 2px #0005; }
@media (prefers-color-scheme:light) { :root { color-scheme:light; --bg:#e3e6e2; --surface:#edf0ea; --surface-2:#dce3dd; --border:#c5cec5; --text:#253a36; --text-muted:#50675f; --accent:#08695e; --success:#066548; --danger:#b91c1c; --shadow:0 1px 2px #0f202610; } }
* { box-sizing:border-box; }
body { font:14px/1.5 Inter,system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); margin:0; padding:32px 24px 64px; }
.wrap { max-width:1600px; margin:0 auto; }
header { display:flex; align-items:center; gap:12px; margin-bottom:4px; }
.mark { width:40px; height:40px; flex-shrink:0; border-radius:10px; display:grid; place-items:center; background:var(--surface-2); border:1px solid var(--border); }
.mark span { width:12px; height:12px; border-radius:50%; background:var(--accent); }
h1 { margin:0; font-size:clamp(28px,2.4vw,32px); letter-spacing:-.02em; line-height:1.2; }
.meta { color:var(--text-muted); margin:6px 0 0; font-size:12px; }
.banner { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:24px 0; padding:14px 16px; border-radius:14px; border:1px solid var(--border); background:var(--surface); font-weight:600; color:var(--success); }
.banner.degraded, .banner.error { color:var(--danger); }
.banner.unknown { color:var(--text-muted); }
.dot { width:10px; height:10px; flex-shrink:0; border-radius:50%; background:currentColor; }
#banner-text { flex:1; min-width:0; overflow-wrap:anywhere; }
.retry { margin-left:auto; min-height:44px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); color:var(--text); padding:8px 12px; cursor:pointer; font:inherit; }
.retry:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.retry[hidden] { display:none; }
.chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:24px; }
.chip { padding:5px 11px; border-radius:999px; border:1px solid var(--border); font-size:12px; color:var(--text-muted); background:var(--surface); }
.chip b { color:var(--text); }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr)); gap:20px; }
.row { min-width:0; padding:20px; border:1px solid var(--border); border-radius:14px; background:var(--surface); box-shadow:var(--shadow); }
.row-top { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; }
.row strong { font-size:16px; min-width:0; overflow-wrap:anywhere; }
.right { display:flex; align-items:center; flex-wrap:wrap; gap:10px; font-size:12px; color:var(--text-muted); }
.state { display:inline-flex; align-items:center; gap:6px; font-weight:600; text-transform:capitalize; }
.state i { width:8px; height:8px; border-radius:50%; display:inline-block; background:currentColor; }
.state-online { color:var(--success); }
.state-offline { color:var(--danger); }
.state-unknown { color:var(--text-muted); }
.ticks { display:flex; gap:3px; align-items:center; height:22px; margin-top:12px; }
.tick { flex:1; max-width:9px; height:16px; border-radius:3px; background:var(--border); }
.tick.online { background:var(--success); } .tick.offline { background:var(--danger); height:22px; }
footer { margin-top:28px; color:var(--text-muted); font-size:12px; text-align:center; }
@media (max-width:600px) { body { padding:24px 16px 48px; } .row { padding:16px; } }
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

export async function registerStatusRoutes({ app, prisma, env }: RouteContext): Promise<void> {
  app.get("/api/status", async (_request, reply) => {
    if (env.publicStatusMode === "disabled") {
      return reply.code(404).send({ error: "Not found" });
    }
    const resources = await prisma.resource.findMany({
      where: { purpose: "service", deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        name: true,
        monitoringMode: true,
        manualStatus: true,
        healthChecks: {
          select: {
            enabled: true,
            primary: true,
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
      const status = resource.healthChecks.find((check) => check.enabled && check.primary)?.latestStatus;
      return status === "online" || status === "offline" ? status : "unknown";
    }

    function resourceTicks(resource: (typeof resources)[number]): Array<"online" | "offline" | "unknown"> {
      if (resource.monitoringMode !== "auto") return [];
      const primary = resource.healthChecks.find((check) => check.enabled && check.primary);
      if (!primary) return [];
      return [...primary.results].reverse().map((result) =>
        result.status === "online" || result.status === "offline" ? result.status : "unknown"
      );
    }

    function resourceUptime(resource: (typeof resources)[number]): number | null {
      if (resource.monitoringMode !== "auto") return null;
      const results = resource.healthChecks.find((check) => check.enabled && check.primary)?.results ?? [];
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
      summary: { resources: resources.length, online, offline, unknown },
      resources: env.publicStatusMode === "services"
        ? resources.map((resource) => ({
          name: resource.name,
          status: resourceStatus(resource),
          uptimePercent: resourceUptime(resource),
          ticks: resourceTicks(resource)
        }))
        : [],
      generatedAt: new Date().toISOString()
    };
  });

  app.get("/status.css", async (_request, reply) => env.publicStatusMode === "disabled"
    ? reply.code(404).send("Not found")
    : reply.type("text/css; charset=utf-8").send(STATUS_CSS));
  app.get("/status.js", async (_request, reply) => env.publicStatusMode === "disabled"
    ? reply.code(404).send("Not found")
    : reply.type("application/javascript; charset=utf-8").send(STATUS_JS));
  app.get("/status", async (_request, reply) => {
    if (env.publicStatusMode === "disabled") {
      return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
    }
    reply.type("text/html; charset=utf-8").send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Homelab Status</title><link rel="stylesheet" href="/status.css"></head>
<body><main class="wrap"><header><div class="mark" aria-hidden="true"><span></span></div><div><h1>Homelab Status</h1><p class="meta">Read-only service health</p></div></header>
<div id="banner" class="banner unknown" role="status"><span class="dot" aria-hidden="true"></span><span id="banner-text">Loading status…</span><button id="retry" class="retry" type="button" hidden>Retry</button></div>
<div id="chips" class="chips"></div><div id="list" class="grid"></div><footer id="updated">Loading…</footer></main><script src="/status.js" defer></script></body></html>`);
  });
}
