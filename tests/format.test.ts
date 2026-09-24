import { describe, expect, it } from "vitest";
import { statusFor, uptimePercent } from "../src/client/lib/format";
import type { DashboardResource } from "../src/shared/types";

function resourceWithChecks(
  checks: NonNullable<DashboardResource["healthChecks"]>
): DashboardResource {
  return {
    id: "resource-primary-format",
    name: "Primary format",
    kind: "app",
    url: null,
    description: null,
    icon: null,
    color: null,
    host: null,
    notes: null,
    favorite: false,
    monitoringMode: "auto",
    manualStatus: null,
    sortOrder: 0,
    groupId: null,
    healthChecks: checks
  };
}

const baseCheck = {
  resourceId: "resource-primary-format",
  intervalSeconds: 60,
  timeoutMs: 3000,
  enabled: true,
  managed: false,
  latestLatencyMs: 10,
  latestCheckedAt: "2026-07-25T00:00:00.000Z",
  latestError: null,
  consecutiveFailures: 0,
  consecutiveSuccesses: 1,
  failureThreshold: 1,
  successThreshold: 1,
  lastTransitionAt: "2026-07-25T00:00:00.000Z"
} as const;

describe("primary health-check formatting", () => {
  it("ignores failed diagnostics for status and uptime", () => {
    const resource = resourceWithChecks([
      {
        ...baseCheck,
        id: "primary",
        type: "tcp",
        target: "service.test:443",
        primary: true,
        latestStatus: "online",
        results: [
          { id: "p1", status: "online", latencyMs: 10, checkedAt: "2026-07-25T00:00:00.000Z" },
          { id: "p2", status: "online", latencyMs: 11, checkedAt: "2026-07-25T00:01:00.000Z" }
        ]
      },
      {
        ...baseCheck,
        id: "diagnostic",
        type: "ping",
        target: "service.test",
        primary: false,
        latestStatus: "offline",
        latestError: "ICMP blocked",
        results: [
          { id: "d1", status: "offline", latencyMs: null, checkedAt: "2026-07-25T00:00:00.000Z" }
        ]
      }
    ]);

    expect(statusFor(resource)).toBe("online");
    expect(uptimePercent(resource)).toBe(100);
  });

  it("returns unknown when the primary check is disabled", () => {
    const resource = resourceWithChecks([
      {
        ...baseCheck,
        id: "disabled-primary",
        type: "tcp",
        target: "service.test:443",
        primary: true,
        enabled: false,
        latestStatus: "online"
      }
    ]);

    expect(statusFor(resource)).toBe("unknown");
    expect(uptimePercent(resource)).toBeNull();
  });
});
