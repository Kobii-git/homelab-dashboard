import { PrismaClient, type DashboardGroup, type Resource } from "@prisma/client";
import { encryptCredential } from "../src/server/vault.js";
import { encryptAlertConfig, summarizeAlertConfig } from "../src/server/alerting.js";

const prisma = new PrismaClient();

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

const groups = [
  "Core Infrastructure",
  "Applications",
  "Virtual Machines",
  "External Sites"
];

const resources: DemoResource[] = [
  {
    name: "OPNsense Gateway",
    kind: "server",
    url: "https://gateway.lab.local",
    host: "192.168.10.1",
    description: "Firewall, VPN, DHCP, and edge routing.",
    color: "#2dd4bf",
    favorite: true,
    group: "Core Infrastructure",
    sortOrder: 0
  },
  {
    name: "Proxmox Cluster",
    kind: "server",
    url: "https://pve.lab.local:8006",
    host: "192.168.10.20",
    description: "Primary virtualization cluster dashboard.",
    color: "#f0b84a",
    favorite: true,
    group: "Core Infrastructure",
    sortOrder: 1
  },
  {
    name: "TrueNAS Scale",
    kind: "server",
    url: "https://nas.lab.local",
    host: "192.168.10.30",
    description: "Storage, snapshots, SMB shares, and backups.",
    color: "#38bdf8",
    favorite: true,
    group: "Core Infrastructure",
    sortOrder: 2
  },
  {
    name: "Home Assistant",
    kind: "app",
    url: "https://ha.lab.local",
    host: "192.168.20.10",
    description: "Automation hub for lights, sensors, and routines.",
    color: "#22c55e",
    favorite: true,
    group: "Applications",
    sortOrder: 0
  },
  {
    name: "Portainer",
    kind: "docker",
    url: "https://portainer.lab.local",
    host: "192.168.20.21",
    description: "Docker stack management for app hosts.",
    color: "#60a5fa",
    favorite: true,
    group: "Applications",
    sortOrder: 1
  },
  {
    name: "Grafana",
    kind: "app",
    url: "https://grafana.lab.local",
    host: "192.168.20.22",
    description: "Metrics dashboards and long-term observability.",
    color: "#fb923c",
    group: "Applications",
    sortOrder: 2
  },
  {
    name: "Vaultwarden",
    kind: "app",
    url: "https://vault.lab.local",
    host: "192.168.20.23",
    description: "Internal password manager.",
    color: "#a78bfa",
    group: "Applications",
    sortOrder: 3
  },
  {
    name: "Docker Host 01",
    kind: "server",
    host: "192.168.30.11",
    description: "Ubuntu host running most containerized services.",
    color: "#2dd4bf",
    group: "Virtual Machines",
    sortOrder: 0
  },
  {
    name: "Windows Admin VM",
    kind: "vm",
    host: "192.168.30.20",
    description: "Windows management VM for Hyper-V and domain admin tools.",
    color: "#60a5fa",
    group: "Virtual Machines",
    sortOrder: 1
  },
  {
    name: "Backup API",
    kind: "website",
    url: "https://backup-api.lab.local/health",
    host: "192.168.40.15",
    description: "Backup controller health endpoint. Demo state: failing.",
    color: "#f87171",
    group: "External Sites",
    sortOrder: 0
  }
];

const folders = [
  { name: "Infrastructure", type: "connection", sortOrder: 0 },
  { name: "Application Hosts", type: "connection", sortOrder: 1 },
  { name: "Admin Vault", type: "credential", sortOrder: 0 },
  { name: "Break Glass", type: "credential", sortOrder: 1 }
];

const tags = [
  { name: "critical", type: "resource", color: "#f87171" },
  { name: "docker", type: "resource", color: "#60a5fa" },
  { name: "windows", type: "connection", color: "#38bdf8" },
  { name: "ssh", type: "connection", color: "#2dd4bf" },
  { name: "shared-admin", type: "credential", color: "#f0b84a" }
];

const widgets: DemoWidget[] = [
  { type: "serviceStatus", title: "Service Status", x: 0, y: 0, w: 5, h: 3, sortOrder: 0 },
  { type: "incidents", title: "Active Incidents", x: 5, y: 0, w: 4, h: 3, sortOrder: 1 },
  { type: "favorites", title: "Favorite Launchers", x: 9, y: 0, w: 3, h: 3, sortOrder: 2 },
  { type: "failingChecks", title: "Failing Checks", x: 0, y: 3, w: 4, h: 3, sortOrder: 3 },
  { type: "recentSessions", title: "Recent Sessions", x: 4, y: 3, w: 4, h: 3, sortOrder: 4 },
  { type: "vaultHealth", title: "Vault Health", x: 8, y: 3, w: 4, h: 3, sortOrder: 5 },
  { type: "notes", title: "Pinned Notes", x: 0, y: 6, w: 6, h: 2, sortOrder: 6 }
];

async function findOrCreateGroup(name: string, sortOrder: number): Promise<DashboardGroup> {
  const existing = await prisma.dashboardGroup.findFirst({ where: { name } });

  if (existing) {
    return prisma.dashboardGroup.update({
      where: { id: existing.id },
      data: { sortOrder }
    });
  }

  return prisma.dashboardGroup.create({ data: { name, sortOrder } });
}

async function findOrCreateResource(resource: DemoResource, groupId: string): Promise<Resource> {
  const existing = await prisma.resource.findFirst({ where: { name: resource.name } });
  const data = {
    kind: resource.kind,
    url: resource.url ?? null,
    host: resource.host ?? null,
    description: resource.description ?? null,
    icon: resource.icon ?? null,
    color: resource.color ?? null,
    favorite: resource.favorite ?? false,
    groupId,
    sortOrder: resource.sortOrder,
    notes: `Demo resource seeded for ${resource.group}.`
  };

  if (existing) {
    return prisma.resource.update({ where: { id: existing.id }, data });
  }

  return prisma.resource.create({
    data: {
      name: resource.name,
      ...data
    }
  });
}

async function findOrCreateFolder(input: { name: string; type: string; sortOrder: number }) {
  const existing = await prisma.folder.findFirst({
    where: { name: input.name, type: input.type }
  });
  const data = {
    type: input.type,
    sortOrder: input.sortOrder
  };

  if (existing) {
    return prisma.folder.update({ where: { id: existing.id }, data });
  }

  return prisma.folder.create({
    data: {
      name: input.name,
      ...data
    }
  });
}

async function findOrCreateTag(input: { name: string; type: string; color: string }) {
  return prisma.tag.upsert({
    where: { name_type: { name: input.name, type: input.type } },
    update: { color: input.color },
    create: input
  });
}

async function findOrCreateWidget(widget: DemoWidget) {
  const existing = await prisma.dashboardWidget.findFirst({
    where: { title: widget.title, type: widget.type }
  });
  const data = {
    type: widget.type,
    title: widget.title,
    configJson: JSON.stringify({ demo: true }),
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    sortOrder: widget.sortOrder,
    enabled: true
  };

  if (existing) {
    return prisma.dashboardWidget.update({ where: { id: existing.id }, data });
  }

  return prisma.dashboardWidget.create({ data });
}

async function findOrCreateCredential(label: string, username: string, password: string, folderId?: string) {
  const existing = await prisma.credential.findFirst({ where: { label } });
  const encrypted = encryptCredential(
    {
      username,
      password,
      domain: label.includes("Windows") ? "LAB" : undefined
    },
    process.env.HOMELAB_VAULT_KEY
  );
  const data = {
    username,
    folderId: folderId ?? null,
    notes: "Demo credential. Replace before real use.",
    ...encrypted
  };

  if (existing) {
    return prisma.credential.update({ where: { id: existing.id }, data });
  }

  return prisma.credential.create({ data: { label, ...data } });
}

async function findOrCreateConnection(input: {
  resourceId: string;
  credentialId?: string;
  type: "ssh" | "rdp";
  name: string;
  host: string;
  port: number;
  usernameHint: string;
  favorite?: boolean;
  folderId?: string;
}) {
  const existing = await prisma.connection.findFirst({
    where: { resourceId: input.resourceId, type: input.type, host: input.host, port: input.port }
  });
  const data = {
    name: input.name,
    host: input.host,
    port: input.port,
    usernameHint: input.usernameHint,
    credentialId: input.credentialId ?? null,
    folderId: input.folderId ?? null,
    favorite: input.favorite ?? false,
    notes: "Demo remote connection.",
    lastLaunchedAt: input.favorite ? new Date(Date.now() - 1000 * 60 * 45) : null
  };

  if (existing) {
    return prisma.connection.update({ where: { id: existing.id }, data });
  }

  return prisma.connection.create({
    data: {
      resourceId: input.resourceId,
      type: input.type,
      ...data
    }
  });
}

async function findOrCreateCheck(input: {
  resourceId: string;
  type: "http" | "tcp" | "ping";
  target: string;
  status: "online" | "offline" | "unknown";
  latencyMs?: number;
  error?: string;
  enabled?: boolean;
}) {
  const existing = await prisma.healthCheck.findFirst({
    where: { resourceId: input.resourceId, type: input.type, target: input.target }
  });
  const checkedAt = input.status === "unknown" ? null : new Date(Date.now() - 1000 * 60 * 7);
  const data = {
    latestStatus: input.status,
    latestLatencyMs: input.latencyMs ?? null,
    latestCheckedAt: checkedAt,
    latestError: input.error ?? null,
    consecutiveFailures: input.status === "offline" ? 3 : 0,
    consecutiveSuccesses: input.status === "online" ? 8 : 0,
    failureThreshold: 2,
    successThreshold: 2,
    lastTransitionAt: checkedAt,
    intervalSeconds: 60,
    timeoutMs: 3000,
    enabled: input.enabled ?? false
  };

  const check = existing
    ? await prisma.healthCheck.update({ where: { id: existing.id }, data })
    : await prisma.healthCheck.create({
        data: {
          resourceId: input.resourceId,
          type: input.type,
          target: input.target,
          ...data
        }
      });

  await prisma.healthResult.deleteMany({
    where: { id: { startsWith: `demo-health-result-${check.id}` } }
  });

  await prisma.healthResult.createMany({
    data: Array.from({ length: 10 }, (_, index) => {
      const newestFirstOffset = 9 - index;
      const offlineDemoSample = input.status === "offline" && index >= 6;
      const sampleStatus = offlineDemoSample ? "offline" : input.status === "offline" ? "online" : input.status;
      const baseLatency =
        sampleStatus === "offline" ? input.latencyMs ?? 1200 : input.status === "offline" ? 68 : input.latencyMs ?? 25;
      return {
        id: `demo-health-result-${check.id}-${index}`,
        checkId: check.id,
        status: sampleStatus,
        latencyMs: sampleStatus === "unknown" ? null : Math.max(5, (baseLatency ?? 0) - newestFirstOffset * 2),
        error: sampleStatus === "offline" ? input.error ?? "Demo failure" : null,
        checkedAt: new Date(Date.now() - 1000 * 60 * (7 + newestFirstOffset * 6))
      };
    })
  });

  return check;
}

async function seed() {
  await prisma.alertDelivery.deleteMany({ where: { id: { in: ["demo-alert-delivery-backup"] } } });
  await prisma.alertRule.deleteMany({ where: { id: { in: ["demo-alert-rule-opened"] } } });
  await prisma.alertChannel.deleteMany({ where: { id: { in: ["demo-alert-webhook"] } } });
  await prisma.incident.deleteMany({ where: { id: { in: ["demo-backup-api-incident"] } } });
  await prisma.note.deleteMany({ where: { id: { in: ["demo-note-maintenance"] } } });
  await prisma.maintenanceWindow.deleteMany({ where: { id: { in: ["demo-maintenance-window"] } } });

  const groupByName = new Map<string, DashboardGroup>();
  for (const [index, group] of groups.entries()) {
    groupByName.set(group, await findOrCreateGroup(group, index));
  }

  const folderByName = new Map<string, Awaited<ReturnType<typeof findOrCreateFolder>>>();
  for (const folder of folders) {
    folderByName.set(folder.name, await findOrCreateFolder(folder));
  }

  for (const tag of tags) {
    await findOrCreateTag(tag);
  }

  for (const widget of widgets) {
    await findOrCreateWidget(widget);
  }

  await prisma.dashboardLayout.upsert({
    where: { id: "main" },
    update: {
      layoutJson: JSON.stringify({
        mode: "demo",
        density: "pro",
        lastSeededAt: new Date().toISOString()
      })
    },
    create: {
      id: "main",
      layoutJson: JSON.stringify({
        mode: "demo",
        density: "pro",
        lastSeededAt: new Date().toISOString()
      })
    }
  });

  const resourceByName = new Map<string, Resource>();
  for (const resource of resources) {
    const group = groupByName.get(resource.group);
    if (!group) {
      throw new Error(`Missing group ${resource.group}`);
    }
    resourceByName.set(resource.name, await findOrCreateResource(resource, group.id));
  }

  const labAdmin = await findOrCreateCredential(
    "Lab Admin",
    "admin",
    "demo-admin-password",
    folderByName.get("Admin Vault")?.id
  );
  const linuxRoot = await findOrCreateCredential(
    "Linux Root",
    "root",
    "demo-linux-password",
    folderByName.get("Break Glass")?.id
  );
  const windowsAdmin = await findOrCreateCredential(
    "Windows Admin",
    "administrator",
    "demo-windows-password",
    folderByName.get("Admin Vault")?.id
  );

  const proxmoxShell = await findOrCreateConnection({
    resourceId: resourceByName.get("Proxmox Cluster")!.id,
    credentialId: linuxRoot.id,
    type: "ssh",
    name: "Proxmox Shell",
    host: "192.168.10.20",
    port: 22,
    usernameHint: "root",
    favorite: true,
    folderId: folderByName.get("Infrastructure")?.id
  });
  const truenasShell = await findOrCreateConnection({
    resourceId: resourceByName.get("TrueNAS Scale")!.id,
    credentialId: labAdmin.id,
    type: "ssh",
    name: "TrueNAS SSH",
    host: "192.168.10.30",
    port: 22,
    usernameHint: "admin",
    folderId: folderByName.get("Infrastructure")?.id
  });
  const dockerShell = await findOrCreateConnection({
    resourceId: resourceByName.get("Docker Host 01")!.id,
    credentialId: linuxRoot.id,
    type: "ssh",
    name: "Docker Host Shell",
    host: "192.168.30.11",
    port: 22,
    usernameHint: "root",
    favorite: true,
    folderId: folderByName.get("Application Hosts")?.id
  });
  const windowsRdp = await findOrCreateConnection({
    resourceId: resourceByName.get("Windows Admin VM")!.id,
    credentialId: windowsAdmin.id,
    type: "rdp",
    name: "Windows Admin RDP",
    host: "192.168.30.20",
    port: 3389,
    usernameHint: "LAB\\administrator",
    favorite: true,
    folderId: folderByName.get("Infrastructure")?.id
  });

  await Promise.all([
    prisma.connection.update({
      where: { id: proxmoxShell.id },
      data: { tags: { set: [], connect: [{ name_type: { name: "ssh", type: "connection" } }] } }
    }),
    prisma.connection.update({
      where: { id: truenasShell.id },
      data: { tags: { set: [], connect: [{ name_type: { name: "ssh", type: "connection" } }] } }
    }),
    prisma.connection.update({
      where: { id: dockerShell.id },
      data: { tags: { set: [], connect: [{ name_type: { name: "ssh", type: "connection" } }] } }
    }),
    prisma.connection.update({
      where: { id: windowsRdp.id },
      data: { tags: { set: [], connect: [{ name_type: { name: "windows", type: "connection" } }] } }
    }),
    prisma.credential.update({
      where: { id: labAdmin.id },
      data: { tags: { set: [], connect: [{ name_type: { name: "shared-admin", type: "credential" } }] } }
    }),
    prisma.resource.update({
      where: { id: resourceByName.get("Backup API")!.id },
      data: { tags: { set: [], connect: [{ name_type: { name: "critical", type: "resource" } }] } }
    }),
    prisma.resource.update({
      where: { id: resourceByName.get("Portainer")!.id },
      data: { tags: { set: [], connect: [{ name_type: { name: "docker", type: "resource" } }] } }
    })
  ]);

  const checks = [
    await findOrCreateCheck({
      resourceId: resourceByName.get("OPNsense Gateway")!.id,
      type: "http",
      target: "https://gateway.lab.local",
      status: "online",
      latencyMs: 18
    }),
    await findOrCreateCheck({
      resourceId: resourceByName.get("Home Assistant")!.id,
      type: "http",
      target: "https://ha.lab.local",
      status: "online",
      latencyMs: 42
    }),
    await findOrCreateCheck({
      resourceId: resourceByName.get("Portainer")!.id,
      type: "http",
      target: "https://portainer.lab.local",
      status: "online",
      latencyMs: 35
    }),
    await findOrCreateCheck({
      resourceId: resourceByName.get("Docker Host 01")!.id,
      type: "tcp",
      target: "192.168.30.11:22",
      status: "online",
      latencyMs: 11
    }),
    await findOrCreateCheck({
      resourceId: resourceByName.get("Backup API")!.id,
      type: "http",
      target: "https://backup-api.lab.local/health",
      status: "offline",
      latencyMs: 3000,
      error: "HTTP 503 Service Unavailable"
    })
  ];

  const backupCheck = checks.at(-1)!;
  const backupIncidentData = {
    checkId: backupCheck.id,
    resourceId: resourceByName.get("Backup API")!.id,
    status: "open",
    severity: "warning",
    title: "Backup API health check failing",
    summary: "Demo incident: backup controller has returned HTTP 503 for three checks.",
    failureCount: 3,
    openedAt: new Date(Date.now() - 1000 * 60 * 28),
    acknowledgedAt: null,
    resolvedAt: null,
    mutedUntil: null
  };
  const existingBackupIncident = await prisma.incident.findFirst({
    where: { title: backupIncidentData.title, checkId: backupCheck.id }
  });
  const backupIncident = existingBackupIncident
    ? await prisma.incident.update({
        where: { id: existingBackupIncident.id },
        data: backupIncidentData
      })
    : await prisma.incident.create({ data: backupIncidentData });

  const alertConfig = { url: "https://hooks.example.invalid/homelab", method: "POST" };
  const encryptedAlertConfig = encryptAlertConfig(
    alertConfig,
    process.env.HOMELAB_VAULT_KEY
  );
  const alertChannelData = {
    name: "Demo Webhook",
    type: "webhook",
    enabled: true,
    configSummaryJson: JSON.stringify(summarizeAlertConfig("webhook", alertConfig)),
    encryptedConfigBlob: encryptedAlertConfig.encryptedBlob,
    iv: encryptedAlertConfig.iv,
    authTag: encryptedAlertConfig.authTag
  };
  const existingAlertChannel = await prisma.alertChannel.findFirst({
    where: { name: "Demo Webhook", type: "webhook" }
  });
  const alertChannel = existingAlertChannel
    ? await prisma.alertChannel.update({
        where: { id: existingAlertChannel.id },
        data: alertChannelData
      })
    : await prisma.alertChannel.create({ data: alertChannelData });

  const alertRuleData = {
    channelId: alertChannel.id,
    name: "Notify on opened incidents",
    event: "incident.opened",
    enabled: true,
    cooldownSeconds: 900,
    lastTriggeredAt: null
  };
  const existingAlertRule = await prisma.alertRule.findFirst({
    where: {
      channelId: alertChannel.id,
      name: alertRuleData.name,
      event: alertRuleData.event
    }
  });
  const alertRule = existingAlertRule
    ? await prisma.alertRule.update({
        where: { id: existingAlertRule.id },
        data: alertRuleData
      })
    : await prisma.alertRule.create({ data: alertRuleData });

  const alertDeliveryData = {
    channelId: alertChannel.id,
    ruleId: alertRule.id,
    incidentId: backupIncident.id,
    event: "incident.opened",
    status: "queued",
    attempts: 0,
    error: null,
    payloadJson: JSON.stringify({ demo: true, title: backupIncident.title }),
    sentAt: null
  };
  const existingAlertDelivery = await prisma.alertDelivery.findFirst({
    where: {
      channelId: alertChannel.id,
      ruleId: alertRule.id,
      incidentId: backupIncident.id,
      event: "incident.opened"
    }
  });
  if (existingAlertDelivery) {
    await prisma.alertDelivery.update({
      where: { id: existingAlertDelivery.id },
      data: alertDeliveryData
    });
  } else {
    await prisma.alertDelivery.create({ data: alertDeliveryData });
  }

  const sessionRows = [
    {
      connectionId: dockerShell.id,
      credentialId: linuxRoot.id,
      resourceName: "Docker Host 01",
      connectionName: "Docker Host Shell",
      protocol: "ssh",
      host: "192.168.30.11",
      port: 22,
      status: "closed",
      error: null,
      hasCredential: true,
      startedAt: new Date(Date.now() - 1000 * 60 * 90),
      endedAt: new Date(Date.now() - 1000 * 60 * 75)
    },
    {
      connectionId: windowsRdp.id,
      credentialId: windowsAdmin.id,
      resourceName: "Windows Admin VM",
      connectionName: "Windows Admin RDP",
      protocol: "rdp",
      host: "192.168.30.20",
      port: 3389,
      status: "closed",
      error: null,
      hasCredential: true,
      startedAt: new Date(Date.now() - 1000 * 60 * 180),
      endedAt: new Date(Date.now() - 1000 * 60 * 150)
    }
  ];

  for (const row of sessionRows) {
    const existingSession = await prisma.sessionHistory.findFirst({
      where: {
        resourceName: row.resourceName,
        connectionName: row.connectionName,
        protocol: row.protocol,
        host: row.host,
        port: row.port
      }
    });

    if (existingSession) {
      await prisma.sessionHistory.update({ where: { id: existingSession.id }, data: row });
    } else {
      await prisma.sessionHistory.create({ data: row });
    }
  }

  const noteData = {
    title: "Tonight: patch Docker Host 01",
    body: "Demo note: update containers, snapshot first, check Portainer after restart.",
    pinned: true,
    resourceId: resourceByName.get("Docker Host 01")!.id
  };
  const existingNote = await prisma.note.findFirst({ where: { title: noteData.title } });
  if (existingNote) {
    await prisma.note.update({ where: { id: existingNote.id }, data: noteData });
  } else {
    await prisma.note.create({ data: noteData });
  }

  const maintenanceData = {
    name: "Weekly patch window",
    startsAt: new Date(Date.now() + 1000 * 60 * 60 * 4),
    endsAt: new Date(Date.now() + 1000 * 60 * 60 * 6),
    enabled: true,
    scopeJson: JSON.stringify({ resources: ["Docker Host 01", "Portainer"] }),
    notes: "Demo maintenance window."
  };
  const existingMaintenance = await prisma.maintenanceWindow.findFirst({
    where: { name: maintenanceData.name }
  });
  if (existingMaintenance) {
    await prisma.maintenanceWindow.update({ where: { id: existingMaintenance.id }, data: maintenanceData });
  } else {
    await prisma.maintenanceWindow.create({ data: maintenanceData });
  }

  const auditRows = [
    {
      action: "demo.seeded",
      entityType: "system",
      entityId: null,
      summary: "Demo homelab data seeded",
      metadataJson: JSON.stringify({ resources: resources.length, widgets: widgets.length })
    },
    {
      action: "vault.reveal",
      entityType: "credential",
      entityId: labAdmin.id,
      summary: "Demo audit event: Lab Admin credential revealed",
      metadataJson: JSON.stringify({ demo: true })
    }
  ];

  for (const row of auditRows) {
    const existingAudit = await prisma.auditEvent.findFirst({
      where: {
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: row.summary
      }
    });

    if (existingAudit) {
      await prisma.auditEvent.update({ where: { id: existingAudit.id }, data: row });
    } else {
      await prisma.auditEvent.create({ data: row });
    }
  }
}

seed()
  .then(async () => {
    console.log("Demo homelab data seeded.");
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
