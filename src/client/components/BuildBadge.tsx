import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { getClientBuildInfo } from "../lib/buildInfo";
import type { BuildInfo } from "../../shared/version";
import { formatBuildLabel } from "../../shared/version";

export function BuildBadge({ className = "" }: { className?: string }) {
  const [info, setInfo] = useState<BuildInfo>(() => getClientBuildInfo());

  useEffect(() => {
    let active = true;
    void apiGet<BuildInfo>("/api/version")
      .then((payload) => {
        if (active) {
          setInfo(payload);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const label = formatBuildLabel(info);

  return (
    <a
      className={`build-badge ${className}`.trim()}
      href={`https://github.com/Kobii-git/homelab-dashboard/releases/tag/v${info.version}`}
      rel="noopener noreferrer"
      target="_blank"
      title={
        info.buildTime
          ? `Built ${new Date(info.buildTime).toLocaleString()} · open release notes`
          : "Open release notes on GitHub"
      }
    >
      {label}
    </a>
  );
}
