import { deflateSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { createApp } from "../src/server/app";
import { getEnv } from "../src/server/env";
import { defaultHomepage, type HomepageSnapshot } from "../src/shared/homepage";
import { initializeHomepage, parseBookmarkHtml } from "../src/server/homepage";
import {
  decodeBackup,
  encodeBackup,
  exportConfiguration,
  restoreConfiguration,
  validateBackground,
} from "../src/server/homepageBackup";

const prisma = new PrismaClient();
let app: FastifyInstance;
let cookies: Record<string, string> = {};
let sessionOnly: Record<string, string>;
async function snapshot(): Promise<HomepageSnapshot> {
  const r = await app.inject({ url: "/api/homepage", cookies });
  expect(r.statusCode).toBe(200);
  return r.json();
}
async function send(url: string, payload: unknown, customCookies = cookies) {
  return app.inject({
    method: "POST",
    url,
    payload: payload as object,
    cookies: customCookies,
  });
}
beforeAll(async () => {
  await prisma.resource.deleteMany();
  await prisma.dashboardGroup.deleteMany();
  await prisma.hostMonitor.deleteMany();
  await prisma.apiWidget.deleteMany();
  await prisma.systemConfig.deleteMany();
  await prisma.homepageAsset.deleteMany();
  await prisma.homepageState.deleteMany();
  const env = getEnv();
  app = await createApp({
    prisma,
    env: {
      ...env,
      cookieSecret: "test-cookie-secret-with-more-than-32-chars",
      ai: { ...env.ai, enabled: false, configured: false },
      opnsense: { ...env.opnsense, enabled: false, configured: false },
      truenas: { ...env.truenas, enabled: false, configured: false },
    },
    monitor: false,
  });
  const login = await send(
    "/api/auth/login",
    { username: "admin", password: "test-pass" },
    {},
  );
  expect(login.statusCode).toBe(200);
  for (const c of login.cookies) cookies[c.name] = c.value;
  sessionOnly = { ...cookies };
  const reauth = await send("/api/auth/reauth", { password: "test-pass" });
  expect(reauth.statusCode).toBe(204);
  for (const c of reauth.cookies) cookies[c.name] = c.value;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("private homepage", () => {
  it("authenticates new routes and enforces origin and reauthentication", async () => {
    expect((await app.inject({ url: "/api/homepage" })).statusCode).toBe(401);
    expect(
      (await send("/api/config/export", undefined, sessionOnly)).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/homepage/state",
          cookies,
          headers: { origin: "https://evil.example" },
          payload: { revision: 0, data: defaultHomepage() },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("backfills legacy bookmarks idempotently without changing IDs or groups", async () => {
    await prisma.systemConfig.delete({
      where: { key: "homepage_v1_backfill" },
    });
    const group = await prisma.dashboardGroup.create({
      data: { name: "Browser links" },
    });
    const b = await prisma.resource.create({
      data: {
        name: "Legacy",
        kind: "website",
        url: "https://example.com/legacy",
        monitoringMode: "disabled",
        groupId: group.id,
      },
    });
    await initializeHomepage(prisma);
    const first = await prisma.resource.findUniqueOrThrow({
      where: { id: b.id },
    });
    expect(first.purpose).toBe("bookmark");
    expect(first.groupId).toBe(group.id);
    expect(first.collectionId).toBe(group.id);
    await initializeHomepage(prisma);
    expect(await prisma.resource.count({ where: { id: b.id } })).toBe(1);
  });
  it("saves workspaces, detects concurrent edits, and creates unmonitored bookmarks", async () => {
    const before = await snapshot();
    before.data.workspaces.work.notes = "Keep my draft";
    before.data.prompts.push({
      id: "test-prompt",
      workspaceId: "work",
      title: "Review",
      text: "Review these selected notes.",
    });
    expect(
      (
        await send("/api/homepage/state", {
          revision: before.revision,
          data: before.data,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await send("/api/homepage/state", {
          revision: before.revision,
          data: defaultHomepage(),
        })
      ).statusCode,
    ).toBe(409);
    const next = await snapshot();
    const response = await send("/api/homepage/bookmarks", {
      revision: next.revision,
      bookmark: {
        name: "ChatGPT",
        url: "https://chatgpt.com/",
        workspaceId: "work",
        favorite: true,
      },
    });
    expect(response.statusCode).toBe(200);
    const b = response
      .json<HomepageSnapshot>()
      .bookmarks.find((b) => b.name === "ChatGPT")!;
    expect(
      await prisma.healthCheck.count({ where: { resourceId: b.id } }),
    ).toBe(0);
    expect(
      (await prisma.resource.findUniqueOrThrow({ where: { id: b.id } }))
        .monitoringMode,
    ).toBe("disabled");
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/resources/${b.id}`,
      cookies,
      payload: { monitoringMode: "auto" },
    });
    expect(patch.statusCode).toBe(409);
    const revision = (await snapshot()).revision;
    expect(
      (
        await send("/api/homepage/bookmarks", {
          revision,
          bookmark: {
            name: "Unsafe",
            url: "javascript:alert(1)",
            workspaceId: "home",
          },
        })
      ).statusCode,
    ).toBe(400);
    expect((await snapshot()).revision).toBe(revision);
  });
  it("validates nested collections and refuses deleting occupied collections", async () => {
    const before = await snapshot();
    before.data.collections.push(
      {
        id: "parent",
        name: "Parent",
        parentId: null,
        workspaceId: "work",
        sortOrder: 0,
      },
      {
        id: "child",
        name: "Child",
        parentId: "parent",
        workspaceId: "work",
        sortOrder: 1,
      },
    );
    let r = await send("/api/homepage/state", {
      revision: before.revision,
      data: before.data,
    });
    expect(r.statusCode).toBe(200);
    const next = r.json<HomepageSnapshot>();
    r = await send("/api/homepage/bookmarks", {
      revision: next.revision,
      bookmark: {
        name: "Nested",
        url: "https://example.com/nested",
        workspaceId: "work",
        collectionId: "child",
      },
    });
    expect(r.statusCode).toBe(200);
    const occupied = r.json<HomepageSnapshot>();
    occupied.data.collections = occupied.data.collections.filter(
      (c) => c.id !== "child",
    );
    expect(
      (
        await send("/api/homepage/state", {
          revision: occupied.revision,
          data: occupied.data,
        })
      ).statusCode,
    ).toBe(400);
    before.data.collections[before.data.collections.length - 2].parentId =
      "child";
    expect(
      (
        await send("/api/homepage/state", {
          revision: (await snapshot()).revision,
          data: before.data,
        })
      ).statusCode,
    ).toBe(400);
  });
  it("previews HTML imports inertly, preserves folders, skips duplicates, and protects undo", async () => {
    const html =
      '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Research &amp; reading</H3><DL><p><DT><A HREF="https://example.com/a?q=1#section">A &amp; B</A><DT><H3>Nested</H3><DL><p><DT><A HREF="https://example.com/b">Second</A></DL><p></DL><p></DL><script>throw 1</script>';
    const entries = parseBookmarkHtml(html);
    expect(entries[0].folders).toEqual(["Research & reading"]);
    expect(entries[1].folders).toEqual(["Research & reading", "Nested"]);
    const preview = await send("/api/homepage/bookmarks/import/preview", {
      html,
      workspaceId: "home",
      revision: (await snapshot()).revision,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().additions).toBe(2);
    const applied = await send("/api/homepage/bookmarks/import/apply", {
      token: preview.json().token,
    });
    expect(applied.statusCode).toBe(200);
    expect(
      (
        await send("/api/homepage/bookmarks/import/apply", {
          token: preview.json().token,
        })
      ).statusCode,
    ).toBe(400);
    const next = await snapshot();
    const again = await send("/api/homepage/bookmarks/import/preview", {
      html,
      workspaceId: "home",
      revision: next.revision,
    });
    expect(again.json().duplicates).toBe(2);
    next.data.workspaces.home.notes = "Another edit";
    await send("/api/homepage/state", {
      revision: next.revision,
      data: next.data,
    });
    expect(
      (
        await send("/api/homepage/bookmarks/import/undo", {
          token: applied.json().undoToken,
        })
      ).statusCode,
    ).toBe(409);
    const exported = await app.inject({
      url: "/api/homepage/bookmarks/export?workspaceId=home&format=html",
      cookies,
    });
    expect(
      parseBookmarkHtml(exported.json().content).find(
        (e) => e.name === "Second",
      )?.folders,
    ).toEqual(["Research & reading", "Nested"]);
    expect(() =>
      parseBookmarkHtml('<DL><A HREF="javascript:alert(1)">X</A></DL>'),
    ).toThrow();
  });
  it("trashes, restores and deletes only explicitly trashed bookmarks", async () => {
    let state = await snapshot();
    const id = state.bookmarks[0].id;
    expect(
      (
        await send("/api/homepage/bookmarks/bulk", {
          revision: state.revision,
          ids: [id],
          action: "delete",
        })
      ).statusCode,
    ).toBe(400);
    const trash = await send("/api/homepage/bookmarks/bulk", {
      revision: state.revision,
      ids: [id],
      action: "trash",
    });
    expect(trash.statusCode).toBe(200);
    state = trash.json();
    expect(state.bookmarks.find((b) => b.id === id)?.deletedAt).toBeTruthy();
    const restore = await send("/api/homepage/bookmarks/bulk", {
      revision: state.revision,
      ids: [id],
      action: "restore",
    });
    expect(restore.statusCode).toBe(200);
    expect(
      restore.json<HomepageSnapshot>().bookmarks.find((b) => b.id === id)
        ?.deletedAt,
    ).toBeNull();
  });
  it("tracks legacy configuration writes but not telemetry as revision changes", async () => {
    const service = await prisma.resource.create({
      data: {
        name: "Service",
        kind: "website",
        url: "https://example.com",
        monitoringMode: "auto",
      },
    });
    const check = await prisma.healthCheck.create({
      data: {
        resourceId: service.id,
        type: "http",
        target: "https://example.com",
      },
    });
    let revision = (await snapshot()).revision;
    await prisma.healthCheck.update({
      where: { id: check.id },
      data: { latestStatus: "online", latestCheckedAt: new Date() },
    });
    expect((await snapshot()).revision).toBe(revision);
    await prisma.healthCheck.update({
      where: { id: check.id },
      data: { timeoutMs: 5000 },
    });
    expect((await snapshot()).revision).toBeGreaterThan(revision);
    revision = (await snapshot()).revision;
    await prisma.resource.update({
      where: { id: service.id },
      data: { name: "Changed" },
    });
    expect((await snapshot()).revision).toBeGreaterThan(revision);
  });
  it("validates background pixels, includes assets in restores, and rejects malformed or oversized archives", async () => {
    const chunk = (type: string, data: Buffer) => {
      const bytes = Buffer.concat([Buffer.from(type), data]);
      let crc = 0xffffffff;
      for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
          crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      const result = Buffer.alloc(data.length + 12);
      result.writeUInt32BE(data.length);
      bytes.copy(result, 4);
      result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
      return result;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 6;
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.from([0, 20, 40, 60, 255]))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => validateBackground(png)).not.toThrow();
    const corrupt = Buffer.from(png);
    corrupt[corrupt.length - 1] ^= 1;
    expect(() => validateBackground(corrupt)).toThrow();
    expect(() =>
      validateBackground(Buffer.alloc(4 * 1024 * 1024 + 1)),
    ).toThrow();
    const uploaded = await send("/api/homepage/assets", {
      revision: (await snapshot()).revision,
      body: png.toString("base64"),
    });
    expect(uploaded.statusCode).toBe(200);
    const current = uploaded.json().snapshot as HomepageSnapshot;
    current.data.workspaces.home.layout.background = `asset:${uploaded.json().id}`;
    expect(
      (
        await send("/api/homepage/state", {
          revision: current.revision,
          data: current.data,
        })
      ).statusCode,
    ).toBe(200);
    const exported = await send("/api/config/export", undefined);
    const decoded = decodeBackup(exported.json().archive);
    expect(decoded.assets[0].body).toEqual(png);
    expect(() =>
      decodeBackup(
        Buffer.from(zipSync({ "manifest.json": strToU8("{broken") })).toString(
          "base64",
        ),
      ),
    ).toThrow();
    expect(() =>
      decodeBackup(
        Buffer.from(
          zipSync({ "manifest.json": new Uint8Array(8 * 1024 * 1024 + 1) }),
        ).toString("base64"),
      ),
    ).toThrow();
    expect(() =>
      decodeBackup(encodeBackup(decoded.manifest, []).toString("base64")),
    ).toThrow();
    expect(
      (await app.inject({ url: `/api/homepage/assets/${uploaded.json().id}` }))
        .statusCode,
    ).toBe(401);
  });
  it("rejects forged ZIP sizes, overlapping entries, recompression and checksum corruption before restore", async () => {
    const exported = await send("/api/config/export", undefined);
    const original = Buffer.from(exported.json().archive, "base64");
    const central = original.readUInt32LE(original.length - 6);
    const forged = Buffer.from(original);
    forged.writeUInt32LE(1, central + 24);
    expect(() => decodeBackup(forged.toString("base64"))).toThrow(/Invalid, unsafe/);
    const altered = Buffer.from(original);
    altered[30 + altered.readUInt16LE(26)] ^= 1;
    expect(() => decodeBackup(altered.toString("base64"))).toThrow(/Invalid, unsafe/);
    const overlap = Buffer.from(original);
    const second = central + 46 + overlap.readUInt16LE(central + 28) + overlap.readUInt16LE(central + 30) + overlap.readUInt16LE(central + 32);
    expect(second).toBeLessThan(original.length - 22);
    overlap.writeUInt32LE(0, second + 42);
    expect(() => decodeBackup(overlap.toString("base64"))).toThrow(/Invalid, unsafe/);
    const decoded = decodeBackup(original.toString("base64"));
    const compressed = zipSync({ "manifest.json": strToU8(JSON.stringify(decoded.manifest)) }, { level: 6 });
    expect(() => decodeBackup(Buffer.from(compressed).toString("base64"))).toThrow(/without recompressing/);
    const before = await snapshot();
    expect((await send("/api/config/import/preview", { archive: forged.toString("base64") })).statusCode).toBe(400);
    expect(await snapshot()).toEqual(before);
  });
  it("exports only allowlisted configuration, rejects unsafe archives and restores transactionally", async () => {
    await prisma.systemConfig.create({
      data: { key: "test_secret_do_not_export", value: "SENTINEL_SECRET" },
    });
    const exported = await send("/api/config/export", undefined);
    expect(exported.statusCode).toBe(200);
    const { archive } = exported.json();
    const decoded = decodeBackup(archive);
    expect(JSON.stringify(decoded.manifest)).not.toContain("SENTINEL_SECRET");
    expect(JSON.stringify(decoded.manifest)).not.toContain("latestStatus");
    expect(decoded.manifest.homepage.prompts).toHaveLength(1);
    expect(() =>
      decodeBackup(
        Buffer.from(zipSync({ "../escape": strToU8("bad") })).toString(
          "base64",
        ),
      ),
    ).toThrow();
    const unsupported = { ...decoded.manifest, version: 999 };
    expect(() =>
      decodeBackup(
        Buffer.from(
          zipSync({ "manifest.json": strToU8(JSON.stringify(unsupported)) }),
        ).toString("base64"),
      ),
    ).toThrow();
    const missing = structuredClone(decoded.manifest);
    missing.resources[0].groupId = "cmissinggroup0000000000000";
    expect(() =>
      decodeBackup(encodeBackup(missing, decoded.assets).toString("base64")),
    ).toThrow();
    const preview = await send("/api/config/import/preview", { archive });
    expect(preview.statusCode).toBe(200);
    const current = await send("/api/config/export", undefined);
    expect(
      (
        await send("/api/config/import/apply", {
          token: preview.json().token,
          exportToken: current.json().exportToken,
          downloaded: false,
        })
      ).statusCode,
    ).toBe(400);
    const applied = await send("/api/config/import/apply", {
      token: preview.json().token,
      exportToken: current.json().exportToken,
      downloaded: true,
    });
    expect(applied.statusCode).toBe(200);
    expect(await prisma.homepageAsset.count()).toBe(1);
    expect(
      await prisma.resource.count({
        where: { monitoringMode: { not: "disabled" } },
      }),
    ).toBe(0);
    expect(await prisma.healthCheck.count({ where: { enabled: true } })).toBe(
      0,
    );
    expect(
      (
        await prisma.systemConfig.findUniqueOrThrow({
          where: { key: "test_secret_do_not_export" },
        })
      ).value,
    ).toBe("SENTINEL_SECRET");
    expect(
      JSON.parse(
        (
          await prisma.systemConfig.findUniqueOrThrow({
            where: { key: "api_widget_secret_bindings_v1" },
          })
        ).value,
      ),
    ).toEqual({});
    const before = await snapshot();
    const corrupt = structuredClone(decoded.manifest);
    corrupt.checks[0].resourceId = "cmissingresource00000000000";
    await expect(
      prisma.$transaction((tx) =>
        restoreConfiguration(tx, corrupt, [], before.revision),
      ),
    ).rejects.toThrow();
    expect((await snapshot()).revision).toBe(before.revision);
    expect((await snapshot()).bookmarks).toEqual(before.bookmarks);
    const safety = await send("/api/config/export", undefined);
    const stale = await send("/api/config/import/preview", { archive });
    const changed = await snapshot();
    changed.data.workspaces.home.notes = "New";
    await send("/api/homepage/state", {
      revision: changed.revision,
      data: changed.data,
    });
    expect(
      (
        await send("/api/config/import/apply", {
          token: stale.json().token,
          exportToken: safety.json().exportToken,
          downloaded: true,
        })
      ).statusCode,
    ).toBe(409);
  });
});
