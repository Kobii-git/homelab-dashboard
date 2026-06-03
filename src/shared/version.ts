import packageJson from "../../package.json" with { type: "json" };

export const APP_VERSION = packageJson.version;

export type BuildInfo = {
  version: string;
  gitSha: string;
  buildTime: string | null;
};

export function getBuildInfo(): BuildInfo {
  const gitSha = (process.env.APP_GIT_SHA ?? "dev").slice(0, 7);
  const buildTime = process.env.APP_BUILD_TIME ?? null;
  return { version: APP_VERSION, gitSha, buildTime };
}

export function formatBuildLabel(info: BuildInfo): string {
  return info.buildTime ? `v${info.version} · ${info.gitSha}` : `v${info.version} · ${info.gitSha}`;
}
