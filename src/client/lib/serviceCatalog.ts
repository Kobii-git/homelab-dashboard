import type { DashboardResource } from "../../shared/types";

export type ServiceTemplate = {
  id: string;
  name: string;
  kind: DashboardResource["kind"];
  icon: string;
  color: string;
  url: string;
  description: string;
  groupHint: string;
  releaseRepository?: string;
};

export const serviceTemplates: ServiceTemplate[] = [
  { id: "portainer", name: "Portainer", kind: "docker", icon: "portainer", color: "#60a5fa", url: "https://portainer.lab.local", description: "Docker stack management.", groupHint: "Applications", releaseRepository: "portainer/portainer" },
  { id: "proxmox", name: "Proxmox", kind: "server", icon: "proxmox", color: "#f97316", url: "https://proxmox.lab.local:8006", description: "Virtualization cluster.", groupHint: "Infrastructure" },
  { id: "home-assistant", name: "Home Assistant", kind: "app", icon: "home-assistant", color: "#38bdf8", url: "https://homeassistant.lab.local", description: "Home automation controller.", groupHint: "Applications", releaseRepository: "home-assistant/core" },
  { id: "pi-hole", name: "Pi-hole", kind: "app", icon: "pi-hole", color: "#ef4444", url: "https://pihole.lab.local/admin", description: "DNS filtering and local resolver.", groupHint: "Network", releaseRepository: "pi-hole/pi-hole" },
  { id: "truenas", name: "TrueNAS", kind: "server", icon: "truenas", color: "#0284c7", url: "https://truenas.lab.local", description: "Storage and shares.", groupHint: "Infrastructure" },
  { id: "jellyfin", name: "Jellyfin", kind: "app", icon: "jellyfin", color: "#a855f7", url: "https://jellyfin.lab.local", description: "Media library.", groupHint: "Media", releaseRepository: "jellyfin/jellyfin" },
  { id: "grafana", name: "Grafana", kind: "app", icon: "grafana", color: "#f97316", url: "https://grafana.lab.local", description: "Dashboards and observability.", groupHint: "Monitoring", releaseRepository: "grafana/grafana" },
  { id: "nginx-proxy-manager", name: "Nginx Proxy Manager", kind: "app", icon: "nginx-proxy-manager", color: "#22c55e", url: "https://npm.lab.local", description: "Reverse proxy management.", groupHint: "Network", releaseRepository: "NginxProxyManager/nginx-proxy-manager" },
  { id: "vaultwarden", name: "Vaultwarden", kind: "app", icon: "vaultwarden", color: "#64748b", url: "https://vaultwarden.lab.local", description: "Password vault service.", groupHint: "Applications", releaseRepository: "dani-garcia/vaultwarden" },
  { id: "unifi", name: "UniFi", kind: "app", icon: "unifi", color: "#0ea5e9", url: "https://unifi.lab.local", description: "Network controller.", groupHint: "Network" },
  { id: "nextcloud", name: "Nextcloud", kind: "app", icon: "nextcloud", color: "#2563eb", url: "https://nextcloud.lab.local", description: "Private cloud files.", groupHint: "Applications", releaseRepository: "nextcloud/server" },
  { id: "uptime-kuma", name: "Uptime Kuma", kind: "app", icon: "uptime-kuma", color: "#22c55e", url: "https://uptime.lab.local", description: "External uptime monitor.", groupHint: "Monitoring", releaseRepository: "louislam/uptime-kuma" }
];

function normalized(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function serviceTemplateById(id: string | null | undefined): ServiceTemplate | null {
  return serviceTemplates.find((template) => template.id === id) ?? null;
}

export function suggestedReleaseRepositories(resources: DashboardResource[], configured: string[]): Array<{
  repository: string;
  resourceName: string;
}> {
  const existing = new Set(configured.map((repository) => repository.toLowerCase()));
  const suggestions = new Map<string, { repository: string; resourceName: string }>();

  for (const resource of resources) {
    const resourceNames = [resource.name, resource.icon].map(normalized).filter(Boolean);
    const template = serviceTemplates.find((candidate) => {
      const aliases = [candidate.id, candidate.name, candidate.icon].map(normalized);
      return resourceNames.some((value) => aliases.includes(value));
    });
    const repository = template?.releaseRepository;
    if (!repository || existing.has(repository.toLowerCase())) continue;
    suggestions.set(repository.toLowerCase(), { repository, resourceName: resource.name });
  }

  return [...suggestions.values()];
}
