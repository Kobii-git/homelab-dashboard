import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { getClientBuildInfo } from "../lib/buildInfo";

export function BuildBadge({ className = "", showBuild = false }: { className?: string; showBuild?: boolean }) {
  const [client] = useState(getClientBuildInfo);
  const [serverVersion, setServerVersion] = useState(client.version);

  useEffect(() => {
    let active = true;
    const checkVersion = () => {
      void apiGet<{ version: string }>("/api/version")
        .then((payload) => {
          if (active) setServerVersion(payload.version);
        })
        .catch(() => undefined);
    };
    checkVersion();
    window.addEventListener("focus", checkVersion);
    return () => {
      active = false;
      window.removeEventListener("focus", checkVersion);
    };
  }, []);

  return (
    <span className={`build-identity ${className}`.trim()}>
      <a
        className="build-badge"
        href="https://github.com/Kobii-git/homelab-dashboard/blob/main/CHANGELOG.md"
        rel="noopener noreferrer"
        target="_blank"
        title="Version of the app loaded in this browser · View changelog"
      >
        v{client.version}{showBuild && /^[a-f0-9]{7}$/i.test(client.gitSha) ? ` · ${client.gitSha}` : ""}
      </a>
      {serverVersion !== client.version && <button type="button" className="build-refresh" onClick={() => window.location.reload()}>
        Reload for v{serverVersion}
      </button>}
    </span>
  );
}
