import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { getClientBuildInfo } from "../lib/buildInfo";

export function BuildBadge({ className = "" }: { className?: string }) {
  const [version, setVersion] = useState(() => getClientBuildInfo().version);

  useEffect(() => {
    let active = true;
    void apiGet<{ version: string }>("/api/version")
      .then((payload) => {
        if (active) {
          setVersion(payload.version);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <a
      className={`build-badge ${className}`.trim()}
      href={`https://github.com/Kobii-git/homelab-dashboard/releases/tag/v${version}`}
      rel="noopener noreferrer"
      target="_blank"
      title="Open release notes on GitHub"
    >
      v{version}
    </a>
  );
}
