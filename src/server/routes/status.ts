import type { RouteContext } from "./types.js";
import { getBuildInfo } from "../../shared/version.js";

export async function registerStatusRoutes({ app, prisma }: RouteContext): Promise<void> {
  app.get("/api/status", async () => {
    const [resources, checks] = await Promise.all([
      prisma.resource.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          kind: true,
          url: true,
          host: true,
          healthChecks: {
            select: {
              id: true,
              type: true,
              target: true,
              latestStatus: true,
              latestLatencyMs: true,
              latestCheckedAt: true,
              latestError: true
            }
          }
        }
      }),
      prisma.healthCheck.findMany({ where: { enabled: true }, select: { latestStatus: true } })
    ]);

    const online = checks.filter((check) => check.latestStatus === "online").length;
    const offline = checks.filter((check) => check.latestStatus === "offline").length;
    const unknown = checks.length - online - offline;

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
        status: resource.healthChecks.some((check) => check.latestStatus === "offline")
          ? "offline"
          : resource.healthChecks.some((check) => check.latestStatus === "online")
            ? "online"
            : "unknown",
        checks: resource.healthChecks
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
  <style>
    body { font-family: system-ui, sans-serif; background: #0d1215; color: #e7eef2; margin: 0; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 1.4rem; }
    .meta { color: #8aa0a8; margin-bottom: 20px; font-size: 0.9rem; }
    .build { color: #7ce7c8; font-size: 0.8rem; margin-bottom: 16px; }
    .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
    .pill { padding: 8px 12px; border-radius: 999px; border: 1px solid #2d3338; font-size: 0.85rem; }
    .pill.ok { border-color: rgba(45,212,191,.4); color: #7ce7c8; }
    .pill.bad { border-color: rgba(248,113,113,.4); color: #ffb4b4; }
    .grid { display: grid; gap: 10px; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid #2d3338; border-radius: 10px; background: #12181c; }
    .row small { color: #8aa0a8; display: block; margin-top: 4px; }
    .status-online { color: #7ce7c8; }
    .status-offline { color: #ffb4b4; }
    .status-unknown { color: #cbd5e1; }
  </style>
</head>
<body>
  <h1>Homelab Status</h1>
  <p class="build">v${build.version} · ${build.gitSha}</p>
  <p class="meta">Read-only · auto-refreshes every 30s</p>
  <div id="summary" class="summary"></div>
  <div id="list" class="grid"></div>
  <script>
    async function render() {
      const data = await fetch('/api/status').then(r => r.json());
      const summary = document.getElementById('summary');
      const list = document.getElementById('list');
      summary.innerHTML = [
        '<span class="pill ' + (data.ok ? 'ok' : 'bad') + '">' + (data.ok ? 'All systems operational' : 'Issues detected') + '</span>',
        '<span class="pill">' + data.summary.online + ' online</span>',
        '<span class="pill">' + data.summary.offline + ' offline</span>',
        '<span class="pill">' + data.summary.resources + ' services</span>'
      ].join('');
      list.innerHTML = data.resources.map(function(resource) {
        return '<div class="row"><div><strong>' + esc(resource.name) + '</strong><small>' + esc(resource.host || resource.url || resource.kind) + '</small></div><span class="status-' + esc(resource.status) + '">' + esc(resource.status) + '</span></div>';
      }).join('');
      document.querySelector('.meta').textContent = 'Updated ' + new Date(data.generatedAt).toLocaleString();
    }
    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, function(ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] || ch;
      });
    }
    render();
    setInterval(render, 30000);
  </script>
</body>
</html>`);
  });
}
