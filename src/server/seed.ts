import { PrismaClient, type DashboardGroup, type Resource } from "@prisma/client";
import { fileURLToPath } from "node:url";

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

type DemoCheck = {
  resourceId: string;
  type: "http" | "tcp" | "ping";
  target: string;
  status: "online" | "offline" | "unknown";
  latencyMs?: number;
  error?: string;
  enabled?: boolean;
};

const groups = ["Core Infrastructure", "Applications", "Virtual Machines", "External Sites"];

const resources: DemoResource[] = [
  { name: "OPNsense Gateway", kind: "server", url: "https://gateway.lab.local", host: "192.168.10.1", description: "Firewall, VPN, DHCP, and edge routing.", color: "#2dd4bf", favorite: true, group: "Core Infrastructure", sortOrder: 0 },
  { name: "Proxmox Cluster", kind: "server", url: "https://pve.lab.local:8006", host: "192.168.10.20", description: "Primary virtualization cluster dashboard.", color: "#f0b84a", favorite: true, group: "Core Infrastructure", sortOrder: 1 },
  { name: "TrueNAS Scale", kind: "server", url: "https://nas.lab.local", host: "192.168.10.30", description: "Storage, snapshots, SMB shares, and backups.", color: "#38bdf8", favorite: true, group: "Core Infrastructure", sortOrder: 2 },
  { name: "Home Assistant", kind: "app", url: "https://ha.lab.local", host: "192.168.20.10", description: "Automation hub for lights, sensors, and routines.", color: "#22c55e", favorite: true, group: "Applications", sortOrder: 0 },
  { name: "Portainer", kind: "docker", url: "https://portainer.lab.local", host: "192.168.20.21", description: "Docker stack management for app hosts.", color: "#60a5fa", favorite: true, group: "Applications", sortOrder: 1 },
  { name: "Grafana", kind: "app", url: "https://grafana.lab.local", host: "192.168.20.22", description: "Metrics dashboards and observability.", color: "#fb923c", group: "Applications", sortOrder: 2 },
  { name: "Docker Host 01", kind: "server", host: "192.168.30.11", description: "Ubuntu host running most containerized services.", color: "#2dd4bf", group: "Virtual Machines", sortOrder: 0 },
  { name: "Windows Admin VM", kind: "vm", host: "192.168.30.20", description: "Windows management VM.", color: "#60a5fa", group: "Virtual Machines", sortOrder: 1 },
  { name: "Backup API", kind: "website", url: "https://backup-api.lab.local/health", host: "192.168.40.15", description: "Backup controller health endpoint.", color: "#f87171", group: "External Sites", sortOrder: 0 }
];

async function findOrCreateGroup(prisma: PrismaClient, name: string, sortOrder: number): Promise<DashboardGroup> {
  const existing = await prisma.dashboardGroup.findFirst({ where: { name } });
  if (existing) {
    return prisma.dashboardGroup.update({ where: { id: existing.id }, data: { sortOrder } });
  }
  return prisma.dashboardGroup.create({ data: { name, sortOrder } });
}

async function findOrCreateResource(prisma: PrismaClient, resource: DemoResource, groupId: string): Promise<Resource> {
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
    notes: resource.name
  };

  if (existing) return prisma.resource.update({ where: { id: existing.id }, data: { ...data, name: resource.name } });
  return prisma.resource.create({ data: { name: resource.name, ...data } });
}

async function findOrCreateCheck(
  prisma: PrismaClient,
  input: DemoCheck
): Promise<void> {
  const existing = await prisma.healthCheck.findFirst({ where: { resourceId: input.resourceId, type: input.type, target: input.target } });
  const status = input.status;
  const checkedAt = status === "unknown" ? null : new Date(Date.now() - 1000 * 60 * 7);
  const data = {
    latestStatus: status,
    latestLatencyMs: input.latencyMs ?? null,
    latestCheckedAt: checkedAt,
    latestError: input.error ?? null,
    consecutiveFailures: status === "offline" ? 3 : 0,
    consecutiveSuccesses: status === "online" ? 8 : 0,
    failureThreshold: 2,
    successThreshold: 2,
    lastTransitionAt: checkedAt,
    intervalSeconds: 60,
    timeoutMs: 3000,
    enabled: input.enabled ?? false
  };

  if (existing) {
    await prisma.healthCheck.update({ where: { id: existing.id }, data });
    return;
  }

  await prisma.healthCheck.create({
    data: {
      resourceId: input.resourceId,
      type: input.type,
      target: input.target,
      ...data
    }
  });
}

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  const groupByName = new Map<string, DashboardGroup>();
  for (const [index, group] of groups.entries()) {
    groupByName.set(group, await findOrCreateGroup(prisma, group, index));
  }

  const resourceByName = new Map<string, Resource>();
  for (const resource of resources) {
    const group = groupByName.get(resource.group);
    if (!group) throw new Error(`Missing group ${resource.group}`);
    resourceByName.set(resource.name, await findOrCreateResource(prisma, resource, group.id));
  }

  const checks: DemoCheck[] = [
    { resourceId: resourceByName.get("OPNsense Gateway")!.id, type: "http", target: "https://gateway.lab.local", status: "online", latencyMs: 18 },
    { resourceId: resourceByName.get("Home Assistant")!.id, type: "http", target: "https://ha.lab.local", status: "online", latencyMs: 42 },
    { resourceId: resourceByName.get("Portainer")!.id, type: "http", target: "https://portainer.lab.local", status: "online", latencyMs: 35 },
    { resourceId: resourceByName.get("Docker Host 01")!.id, type: "ping", target: "192.168.30.11", status: "online", latencyMs: 11 },
    { resourceId: resourceByName.get("Backup API")!.id, type: "http", target: "https://backup-api.lab.local/health", status: "offline", latencyMs: 3000, error: "HTTP 503 Service Unavailable", enabled: true }
  ];

  for (const check of checks) {
    await findOrCreateCheck(prisma, check);
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === scriptPath || process.argv[1]?.endsWith("seed.ts");

if (isMain) {
  const client = new PrismaClient();
  seedDemo(client)
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
