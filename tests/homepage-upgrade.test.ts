import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { expect, it } from "vitest";
import { initializeHomepage } from "../src/server/homepage";
import {
  decodeBackup,
  encodeBackup,
  exportConfiguration,
  restoreConfiguration,
} from "../src/server/homepageBackup";
const exec = promisify(execFile);
it("upgrades the prior schema and restores configuration into an independent fresh installation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "homepage-upgrade-"));
  const sourceUrl = `file:${path.join(directory, "source.db")}`;
  const targetUrl = `file:${path.join(directory, "target.db")}`;
  const source = new PrismaClient({ datasourceUrl: sourceUrl });
  const target = new PrismaClient({ datasourceUrl: targetUrl });
  const push = async (schema: string, url: string) =>
    exec(
      process.execPath,
      [
        "node_modules/prisma/build/index.js",
        "db",
        "push",
        "--skip-generate",
        "--schema",
        schema,
      ],
      { env: { ...process.env, DATABASE_URL: url, RUST_LOG: "info" } },
    );
  try {
    const oldSchema = path.join(directory, "old.prisma");
    await writeFile(
      oldSchema,
      await readFile("tests/fixtures/homepage-v0.prisma", "utf8"),
    );
    await push(oldSchema, sourceUrl);
    await source.$executeRawUnsafe(
      `INSERT INTO "DashboardGroup" (id,name,updatedAt) VALUES ('cmigrate000000000000000000','Old folder',CURRENT_TIMESTAMP)`,
    );
    await source.$executeRawUnsafe(
      `INSERT INTO "Resource" (id,name,kind,url,monitoringMode,groupId,updatedAt) VALUES ('cbookmark00000000000000000','Preserved link','website','https://example.com/saved','disabled','cmigrate000000000000000000',CURRENT_TIMESTAMP)`,
    );
    await source.$executeRawUnsafe(
      `INSERT INTO "Resource" (id,name,kind,url,monitoringMode,updatedAt) VALUES ('cservice000000000000000000','Preserved service','website','https://example.com/service','auto',CURRENT_TIMESTAMP)`,
    );
    await source.$executeRawUnsafe(
      `INSERT INTO "HealthCheck" (id,resourceId,type,target,updatedAt) VALUES ('ccheck00000000000000000000','cservice000000000000000000','http','https://example.com/service',CURRENT_TIMESTAMP)`,
    );
    await source.$executeRawUnsafe(
      `INSERT INTO "HealthResult" (id,checkId,status) VALUES ('chistory000000000000000000','ccheck00000000000000000000','online')`,
    );
    await source.$disconnect();
    await push("prisma/schema.prisma", sourceUrl);
    await initializeHomepage(source);
    await initializeHomepage(source);
    expect(
      (
        await source.resource.findUniqueOrThrow({
          where: { id: "cbookmark00000000000000000" },
        })
      ).purpose,
    ).toBe("bookmark");
    expect(await source.healthResult.count()).toBe(1);
    expect(await source.dashboardGroup.count()).toBe(1);
    const exported = await source.$transaction((tx) => exportConfiguration(tx));
    const decoded = decodeBackup(
      encodeBackup(exported.manifest, exported.assets).toString("base64"),
    );
    await push("prisma/schema.prisma", targetUrl);
    await initializeHomepage(target);
    await target.adminAccount.create({
      data: { username: "destination-admin", passwordHash: "destination-hash" },
    });
    const state = await target.homepageState.findUniqueOrThrow({
      where: { id: "main" },
    });
    await target.$transaction((tx) =>
      restoreConfiguration(
        tx,
        decoded.manifest,
        decoded.assets,
        state.revision,
      ),
    );
    expect(
      (
        await target.resource.findUniqueOrThrow({
          where: { id: "cbookmark00000000000000000" },
        })
      ).groupId,
    ).toBe("cmigrate000000000000000000");
    expect(await target.healthCheck.count({ where: { enabled: true } })).toBe(
      0,
    );
    expect(await target.healthResult.count()).toBe(0);
    expect(
      (await target.adminAccount.findUniqueOrThrow({ where: { id: "admin" } }))
        .passwordHash,
    ).toBe("destination-hash");
    expect(
      (await target.homepageState.findUniqueOrThrow({ where: { id: "main" } }))
        .data,
    ).toEqual(exported.manifest.homepage);
  } finally {
    await source.$disconnect();
    await target.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
