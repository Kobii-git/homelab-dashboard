import type { DashboardResource, UtilityResultDto } from "../../shared/types";
import { statusFor, summarizeResourceStatus } from "./format";

export type HealthTone = "healthy" | "warning" | "error" | "neutral" | "loading";
export type HealthDetail = { id: string; label: string; tone?: HealthTone; description?: string; actionLabel?: string; onAction?: () => void };
export type HealthItem = { id: string; label: string; tone: HealthTone; details?: HealthDetail[] };

export function serviceHealth(resources: DashboardResource[], onInspect: (resource: DashboardResource) => void): HealthItem {
  const services = resources.filter(resource => resource.purpose !== "bookmark");
  const totals = summarizeResourceStatus(services);
  return {
    id: "services",
    label: !services.length ? "No services yet" : `Services: ${totals.online} online${totals.offline ? ` · ${totals.offline} offline` : ""}${totals.unknown ? ` · ${totals.unknown} unknown` : ""}`,
    tone: totals.offline ? "error" : totals.unknown || !services.length ? "neutral" : "healthy",
    details: services.filter(resource => statusFor(resource) !== "online").map(resource => ({
      id: resource.id, label: `${resource.name}: ${statusFor(resource)}`, tone: statusFor(resource) === "offline" ? "error" : "neutral", actionLabel: "View service", onAction: () => onInspect(resource),
    })),
  };
}

export function utilityPresentation(result: UtilityResultDto<unknown> | null | undefined, fetchError = ""): { tone: HealthTone; label: string } {
  if (result?.state === "disabled" && !fetchError) return { tone: "neutral", label: "Not configured" };
  if (result?.data != null && (fetchError || result.stale || result.error || result.state === "error")) return { tone: "warning", label: "Cached data" };
  if (fetchError || result?.state === "error" || result?.error) return { tone: "error", label: "Unavailable" };
  if (result?.state === "ready" && result.data != null) return { tone: "healthy", label: "Up to date" };
  return { tone: "loading", label: "Loading" };
}

export function utilityHealth(id: string, name: string, result: UtilityResultDto<unknown> | null | undefined, fetchError: string, onConfigure: () => void): HealthItem {
  const state = utilityPresentation(result, fetchError);
  return { id, tone: state.tone, label: `${name}: ${state.label.toLowerCase()}`,
    details: state.tone !== "healthy" && state.tone !== "loading" ? [{ id, label: name,
      description: fetchError || result?.error || (result?.stale ? "Showing the last available data." : "Enable this integration in Settings."),
      actionLabel: "Integration settings", onAction: onConfigure,
    }] : [],
  };
}
