import { APP_VERSION, formatBuildLabel, type BuildInfo } from "../../shared/version";

declare const __APP_GIT_SHA__: string | undefined;

export function getClientBuildInfo(): BuildInfo {
  const gitSha = typeof __APP_GIT_SHA__ === "string" ? __APP_GIT_SHA__.slice(0, 7) : "dev";
  return { version: APP_VERSION, gitSha, buildTime: null };
}

export function formatClientBuildLabel(): string {
  return formatBuildLabel(getClientBuildInfo());
}
