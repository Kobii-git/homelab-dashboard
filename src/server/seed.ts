import { fileURLToPath } from "node:url";
import { PrismaClient, type DashboardGroup, type Resource } from "@prisma/client";
import { encryptAlertConfig, summarizeAlertConfig } from "./alerting.js";

type DemoResource = {
  name: string;
  kind: string;
  url?: string;
  host?: string;
  description?: string;
  icon?: string;
  color?: string;
  favorite?: boolean;
  group: string;
  sortOrder: number;
};

type DemoWidget = {
  type: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sortOrder: number;
};

const groups = ["Core Infrastructure", "Applications", "Virtual Machines", "External Sites"];

const resources: DemoResource[] = [
  { name: "OPNsense Gateway", kind: "server", url: "https://gateway.lab.local", host: "192.168.10.1", description: "Firewall, VPN, DHCP, and edge routing.", color: "#2dd4bf", favorite: true, group: "Core Infrastructure", sortOrder: 0 },
  { name: "Proxmox Cluster", kind: "server", url: "https://pve.lab.local:8006", host: "192.168.10.20", description: "Primary virtualization cluster dashboard.", color: "#f0b84a", favorite: true, group: "Core Infrastructure", sortOrder: 1 },
  { name: "TrueNAS Scale", kind: "server", url: "https://nas.lab.local", host: "192.168.10.30", description: "Storage, snapshots, SMB shares, and backups.", color: "#38bdf8", favorite: true, group: "Core Infrastructure", sortOrder: 2 },
  { name: "Home Assistant", kind: "app", url: "https://ha.lab.local", host: "192.168.20.10", description: "Automation hub for lights, sensors, and routines.", color: "#22c55e", favorite: true, group: "Applications", sortOrder: 0 },
  { name: "Portainer", kind: "docker", url: "https://portainer.lab.local", host: "192.168.20.21", description: "Docker stack management for app hosts.", color: "#60a5fa", favorite: true, group: "Applications", sortOrder: 1 },
  { name: "Grafana", kind: "app", url: "https://grafana.lab.local", host: "192.168.20.22", description: "Metrics dashboards and long-term observability.", color: "#fb923c", group: "Applications", sortOrder: 2 },
  { name: "Vaultwarden", kind: "app", url: "https://vault.lab.local", host: "192.168.20.23", description: "Internal password manager.", color: "#a78bfa", group: "Applications", sortOrder: 3 },
  { name: "Docker Host 01", kind: "server", host: "192.168.30.11", description: "Ubuntu host running most containerized services.", color: "#2dd4bf", group: "Virtual Machines", sortOrder: 0 },
  { name: "Windows Admin VM", kind: "vm", host: "192.168.30.20", description: "Windows management VM for Hyper-V and domain admin tools.", color: "#60a5fa", group: "Virtual Machines", sortOrder: 1 },
  { name: "Backup API", kind: "website", url: "https://backup-api.lab.local/health", host: "192.168.40.15", description: "Backup controller health endpoint. Demo state: failing.", color: "#f87171", group: "External Sites", sortOrder: 0 }
];

const tags = [
  { name: "critical", type: "resource", color: "#f87171" },
  { name: "docker", type: "resource", color: "#60a5fa" }
];

const widgets: DemoWidget[] = [
  { type: "serviceStatus", title: "Service Status", x: 0, y: 0, w: 6, h: 3, sortOrder: 0 },
  { type: "incidents", title: "Active Incidents", x: 6, y: 0, w: 6, h: 3, sortOrder: 1 },
  { type: "favorites", title: "Favorite Launchers", x: 0, y: 3, w: 6, h: 3, sortOrder: 2 },
  { type: "failingChecks", title: "Failing Checks", x: 6, y: 3, w: 6, h: 3, sortOrder: 3 },
  { type: "notes", title: "Pinned Notes", x: 0, y: 6, w: 12, h: 3, sortOrder: 4 }
];

async function findOrCreateGroup(prisma: PrismaClient, name: string, sortOrder: number): Promise<DashboardGroup> {
  const existing = await prisma.dashboardGroup.findFirst({ where: { name } });
  if (existing) return prisma.dashboardGroup.update({ where: { id: existing.id }, data: { sortOrder } });
  return prisma.dashboardGroup.create({ data: { name, sortOrder } });
}

async function findOrCreateResource(prisma: PrismaClient, resource: DemoResource, groupId: string): Promise<Resource> {
  const existing = await prisma.resource.findFirst({ where: { name: resource.name } });
  const data = { kind: resource.kind, url: resource.url ?? null, host: resource.host ?? null, description: resource.description ?? null, icon: resource.icon ?? null, color: resource.color ?? null, favorite: resource.favorite ?? false, groupId, sortOrder: resource.sortOrder, notes: `Demo resource seeded for ${resource.group}.` };
  if (existing) return prisma.resource.update({ where: { id: existing.id }, data });
  return prisma.resource.create({ data: { name: resource.name, ...data } });
}

async function findOrCreateTag(prisma: PrismaClient, input: { name: string; type: string; color: string }) {
  return prisma.tag.upsert({ where: { name_type: { name: input.name, type: input.type } }, update: { color: input.color }, create: input });
}

async function findOrCreateWidget(prisma: PrismaClient, widget: DemoWidget) {
  const existing = await prisma.dashboardWidget.findFirst({
    where: { type: widget.type },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
  const data = { type: widget.type, title: widget.title, configJson: JSON.stringify({ demo: true }), x: widget.x, y: widget.y, w: widget.w, h: widget.h, sortOrder: widget.sortOrder, enabled: true };
  if (existing) return prisma.dashboardWidget.update({ where: { id: existing.id }, data });
  return prisma.dashboardWidget.create({ data });
}

async function findOrCreateCheck(prisma: PrismaClient, input: { resourceId: string; type: "http" | "tcp" | "ping"; target: string; status: "online" | "offline" | "unknown"; latencyMs?: number; error?: string; enabled?: boolean }) {
  const existing = await prisma.healthCheck.findFirst({ where: { resourceId: input.resourceId, type: input.type, target: input.target } });
  const checkedAt = input.status === "unknown" ? null : new Date(Date.now() - 1000 * 60 * 7);
  const data = { latestStatus: input.status, latestLatencyMs: input.latencyMs ?? null, latestCheckedAt: checkedAt, latestError: input.error ?? null, consecutiveFailures: input.status === "offline" ? 3 : 0, consecutiveSuccesses: input.status === "online" ? 8 : 0, failureThreshold: 2, successThreshold: 2, lastTransitionAt: checkedAt, intervalSeconds: 60, timeoutMs: 3000, enabled: input.enabled ?? false };
  const check = existing
    ? await prisma.healthCheck.update({ where: { id: existing.id }, data })
    : await prisma.healthCheck.create({ data: { resourceId: input.resourceId, type: input.type, target: input.target, ...data } });

  await prisma.healthResult.deleteMany({ where: { id: { startsWith: `demo-health-result-${check.id}` } } });
  await prisma.healthResult.createMany({
    data: Array.from({ length: 10 }, (_, index) => {
      const newestFirstOffset = 9 - index;
      const offlineDemoSample = input.status === "offline" && index >= 6;
      const sampleStatus = offlineDemoSample ? "offline" : input.status === "offline" ? "online" : input.status;
      const baseLatency = sampleStatus === "offline" ? input.latencyMs ?? 1200 : input.status === "offline" ? 68 : input.latencyMs ?? 25;
      return { id: `demo-health-result-${check.id}-${index}`, checkId: check.id, status: sampleStatus, latencyMs: sampleStatus === "unknown" ? null : Math.max(5, (baseLatency ?? 0) - newestFirstOffset * 2), error: sampleStatus === "offline" ? input.error ?? "Demo failure" : null, checkedAt: new Date(Date.now() - 1000 * 60 * (7 + newestFirstOffset * 6)) };
    })
  });

  return check;
}

export async function seedDemo(prisma: PrismaClient, vaultKey: string | undefined): Promise<void> {
  await prisma.alertDelivery.deleteMany({ where: { id: { in: ["demo-alert-delivery-backup"] } } });
  await prisma.alertRule.deleteMany({ where: { id: { in: ["demo-alert-rule-opened"] } } });
  await prisma.alertChannel.deleteMany({ where: { id: { in: ["demo-alert-webhook"] } } });
  await prisma.incident.deleteMany({ where: { id: { in: ["demo-backup-api-incident"] } } });
  await prisma.note.deleteMany({ where: { id: { in: ["demo-note-maintenance"] } } });
  await prisma.maintenanceWindow.deleteMany({ where: { id: { in: ["demo-maintenance-window"] } } });

  const groupByName = new Map<string, DashboardGroup>();
  for (const [index, group] of groups.entries()) {
    groupByName.set(group, await findOrCreateGroup(prisma, group, index));
  }

  for (const tag of tags) {
    await findOrCreateTag(prisma, tag);
  }

  for (const widget of widgets) {
    await findOrCreateWidget(prisma, widget);
  }

  await prisma.dashboardLayout.upsert({
    where: { id: "main" },
    update: { layoutJson: JSON.stringify({ mode: "demo", density: "pro", lastSeededAt: new Date().toISOString() }) },
    create: { id: "main", layoutJson: JSON.stringify({ mode: "demo", density: "pro", lastSeededAt: new Date().toISOString() }) }
  });

  const resourceByName = new Map<string, Resource>();
  for (const resource of resources) {
    const group = groupByName.get(resource.group);
    if (!group) throw new Error(`Missing group ${resource.group}`);
    resourceByName.set(resource.name, await findOrCreateResource(prisma, resource, group.id));
  }

  await Promise.all([
    prisma.resource.update({ where: { id: resourceByName.get("Backup API")!.id }, data: { tags: { set: [], connect: [{ name_type: { name: "critical", type: "resource" } }] } } }),
    prisma.resource.update({ where: { id: resourceByName.get("Portainer")!.id }, data: { tags: { set: [], connect: [{ name_type: { name: "docker", type: "resource" } }] } } })
  ]);

  const checks = [
    await findOrCreateCheck(prisma, { resourceId: resourceByName.get("OPNsense Gateway")!.id, type: "http", target: "https://gateway.lab.local", status: "online", latencyMs: 18 }),
    await findOrCreateCheck(prisma, { resourceId: resourceByName.get("Home Assistant")!.id, type: "http", target: "https://ha.lab.local", status: "online", latencyMs: 42 }),
    await findOrCreateCheck(prisma, { resourceId: resourceByName.get("Portainer")!.id, type: "http", target: "https://portainer.lab.local", status: "online", latencyMs: 35 }),
    await findOrCreateCheck(prisma, { resourceId: resourceByName.get("Docker Host 01")!.id, type: "tcp", target: "192.168.30.11:22", status: "online", latencyMs: 11 }),
    await findOrCreateCheck(prisma, { resourceId: resourceByName.get("Backup API")!.id, type: "http", target: "https://backup-api.lab.local/health", status: "offline", latencyMs: 3000, error: "HTTP 503 Service Unavailable" })
  ];

  const backupCheck = checks.at(-1)!;
  const backupIncidentData = { checkId: backupCheck.id, resourceId: resourceByName.get("Backup API")!.id, status: "open", severity: "warning", title: "Backup API health check failing", summary: "Demo incident: backup controller has returned HTTP 503 for three checks.", failureCount: 3, openedAt: new Date(Date.now() - 1000 * 60 * 28), acknowledgedAt: null, resolvedAt: null, mutedUntil: null };
  const existingBackupIncident = await prisma.incident.findFirst({ where: { title: backupIncidentData.title, checkId: backupCheck.id } });
  const backupIncident = existingBackupIncident
    ? await prisma.incident.update({ where: { id: existingBackupIncident.id }, data: backupIncidentData })
    : await prisma.incident.create({ data: backupIncidentData });

  const alertConfig = { url: "https://hooks.example.invalid/homelab", method: "POST" };
  const encryptedAlertConfig = encryptAlertConfig(alertConfig, vaultKey);
  const alertChannelData = { name: "Demo Webhook", type: "webhook", enabled: true, configSummaryJson: JSON.stringify(summarizeAlertConfig("webhook", alertConfig)), encryptedConfigBlob: encryptedAlertConfig.encryptedBlob, iv: encryptedAlertConfig.iv, authTag: encryptedAlertConfig.authTag };
  const existingAlertChannel = await prisma.alertChannel.findFirst({ where: { name: "Demo Webhook", type: "webhook" } });
  const alertChannel = existingAlertChannel
    ? await prisma.alertChannel.update({ where: { id: existingAlertChannel.id }, data: alertChannelData })
    : await prisma.alertChannel.create({ data: alertChannelData });

  const alertRuleData = { channelId: alertChannel.id, name: "Notify on opened incidents", event: "incident.opened", enabled: true, cooldownSeconds: 900, lastTriggeredAt: null };
  const existingAlertRule = await prisma.alertRule.findFirst({ where: { channelId: alertChannel.id, name: alertRuleData.name, event: alertRuleData.event } });
  const alertRule = existingAlertRule
    ? await prisma.alertRule.update({ where: { id: existingAlertRule.id }, data: alertRuleData })
    : await prisma.alertRule.create({ data: alertRuleData });

  const alertDeliveryData = { channelId: alertChannel.id, ruleId: alertRule.id, incidentId: backupIncident.id, event: "incident.opened", status: "queued", attempts: 0, error: null, payloadJson: JSON.stringify({ demo: true, title: backupIncident.title }), sentAt: null };
  const existingAlertDelivery = await prisma.alertDelivery.findFirst({ where: { channelId: alertChannel.id, ruleId: alertRule.id, incidentId: backupIncident.id, event: "incident.opened" } });
  if (existingAlertDelivery) {
    await prisma.alertDelivery.update({ where: { id: existingAlertDelivery.id }, data: alertDeliveryData });
  } else {
    await prisma.alertDelivery.create({ data: alertDeliveryData });
  }

  const noteData = { title: "Tonight: patch Docker Host 01", body: "Demo note: update containers, snapshot first, check Portainer after restart.", pinned: true, resourceId: resourceByName.get("Docker Host 01")!.id };
  const existingNote = await prisma.note.findFirst({ where: { title: noteData.title } });
  if (existingNote) {
    await prisma.note.update({ where: { id: existingNote.id }, data: noteData });
  } else {
    await prisma.note.create({ data: noteData });
  }

  const maintenanceData = { name: "Weekly patch window", startsAt: new Date(Date.now() + 1000 * 60 * 60 * 4), endsAt: new Date(Date.now() + 1000 * 60 * 60 * 6), enabled: true, scopeJson: JSON.stringify({ resources: ["Docker Host 01", "Portainer"] }), notes: "Demo maintenance window." };
  const existingMaintenance = await prisma.maintenanceWindow.findFirst({ where: { name: maintenanceData.name } });
  if (existingMaintenance) {
    await prisma.maintenanceWindow.update({ where: { id: existingMaintenance.id }, data: maintenanceData });
  } else {
    await prisma.maintenanceWindow.create({ data: maintenanceData });
  }

  const auditRows = [
    { action: "demo.seeded", entityType: "system", entityId: null, summary: "Demo homelab data seeded", metadataJson: JSON.stringify({ resources: resources.length, widgets: widgets.length }) }
  ];

  for (const row of auditRows) {
    const existingAudit = await prisma.auditEvent.findFirst({ where: { action: row.action, entityType: row.entityType, entityId: row.entityId, summary: row.summary } });
    if (existingAudit) {
      await prisma.auditEvent.update({ where: { id: existingAudit.id }, data: row });
    } else {
      await prisma.auditEvent.create({ data: row });
    }
  }
}

// Run as standalone script (e.g. npm run seed:demo)
const scriptPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === scriptPath || process.argv[1]?.endsWith("seed.ts");

if (isMain) {
  const client = new PrismaClient();
  seedDemo(client, process.env.HOMELAB_VAULT_KEY)
    .then(async () => {
      console.log("Demo homelab data seeded.");
      await client.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await client.$disconnect();
      process.exit(1);
    });
}
