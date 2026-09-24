import { createHash, randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { z } from "zod";
import {
  bookmarkInputSchema,
  homepageDataSchema,
  homepageId,
} from "../shared/homepage.js";
import {
  resourceSchema,
  dashboardGroupSchema,
  healthCheckSchema,
  hostMonitorSchema,
  apiWidgetSchema,
  settingsSchema,
} from "./validation.js";
import {
  assertCollection,
  claimRevision,
  readHomepage,
  type HomeDatabase,
} from "./homepage.js";

const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_ASSET = 4 * 1024 * 1024;
const resourceConfig = resourceSchema
  .omit({ primaryCheck: true })
  .extend({
    id: homepageId,
    url: bookmarkInputSchema.shape.url.optional().nullable(),
    purpose: z.enum(["service", "bookmark"]),
    workspaceId: z.enum(["home", "work"]),
    collectionId: homepageId.nullable(),
    readingState: z.enum(["none", "unread", "reading", "done"]),
    notes: z.string().max(20_000).nullable(),
    deletedAt: z.string().datetime().nullable(),
  })
  .strict();
const checkConfig = healthCheckSchema
  .extend({ id: homepageId, managed: z.boolean() })
  .strict();
const backupSchema = z
  .object({
    format: z.literal("homelab-homepage"),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    homepage: homepageDataSchema,
    groups: z
      .array(dashboardGroupSchema.extend({ id: homepageId }).strict())
      .max(2000),
    resources: z.array(resourceConfig).max(20_000),
    checks: z.array(checkConfig).max(30_000),
    hosts: z
      .array(hostMonitorSchema.extend({ id: homepageId }).strict())
      .max(1000),
    widgets: z
      .array(apiWidgetSchema.extend({ id: homepageId }).strict())
      .max(1000),
    settings: settingsSchema.strict(),
    requiredEnvironment: z
      .array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/))
      .max(1000),
    assets: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-f0-9]{64}$/),
            mimeType: z.literal("image/png"),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();
type PortableBackup = z.infer<typeof backupSchema>;
function bad(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
function pick<T extends object>(source: T, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, source[k as keyof T]]));
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function pngChecksum(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Accept non-interlaced RGB/RGBA PNGs only, with bounded decompression and dimensions.
export function validateBackground(body: Buffer) {
  if (
    body.length > MAX_ASSET ||
    body.length < 57 ||
    !body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    bad("Choose a PNG background under 4 MiB");
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  let ended = false;
  const compressed: Buffer[] = [];
  while (offset + 12 <= body.length) {
    const length = body.readUInt32BE(offset);
    if (length > MAX_ASSET || offset + length + 12 > body.length)
      bad("Invalid PNG chunk");
    const type = body.toString("ascii", offset + 4, offset + 8);
    const data = body.subarray(offset + 8, offset + 8 + length);
    if (
      pngChecksum(body.subarray(offset + 4, offset + 8 + length)) !==
      body.readUInt32BE(offset + 8 + length)
    )
      bad("Invalid PNG checksum");
    if (offset === 8 && type !== "IHDR") bad("Invalid PNG header");
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) bad("Invalid PNG header");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (
        !width ||
        !height ||
        width > 4096 ||
        height > 4096 ||
        width * height > 4_194_304 ||
        data[8] !== 8 ||
        !channels ||
        data[10] ||
        data[11] ||
        data[12]
      )
        bad("Use an RGB/RGBA PNG up to 4 megapixels without interlacing");
    } else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") {
      if (length || offset + 12 !== body.length) bad("Invalid PNG ending");
      ended = true;
      break;
    } else if (!/^[a-z]/.test(type)) bad("Unsupported PNG chunk");
    offset += length + 12;
  }
  if (!ended || !compressed.length) bad("Incomplete PNG");
  const expected = height * (width * channels + 1);
  try {
    const pixels = inflateSync(Buffer.concat(compressed), {
      maxOutputLength: expected,
    });
    if (pixels.length !== expected) bad("Invalid PNG pixels");
    for (let row = 0; row < height; row++)
      if (pixels[row * (width * channels + 1)] > 4) bad("Invalid PNG filter");
  } catch {
    bad("Invalid or oversized PNG pixels");
  }
}

export async function exportConfiguration(
  tx: HomeDatabase,
): Promise<{
  manifest: PortableBackup;
  assets: { id: string; body: Uint8Array }[];
}> {
  const state = await tx.homepageState.findUniqueOrThrow({
    where: { id: "main" },
  });
  const groups = await tx.dashboardGroup.findMany();
  const resources = await tx.resource.findMany();
  const checks = await tx.healthCheck.findMany();
  const hosts = await tx.hostMonitor.findMany();
  const widgets = await tx.apiWidget.findMany();
  const assets = await tx.homepageAsset.findMany();
  const settingsKeys = [
    "dashboard_utilities_v1",
    "dashboard_home_v1",
    "auto_ping_interval_seconds",
  ];
  const settingsRows = await tx.systemConfig.findMany({
    where: { key: { in: settingsKeys } },
  });
  const read = (key: string) => settingsRows.find((s) => s.key === key)?.value;
  const manifest = backupSchema.parse({
    format: "homelab-homepage",
    version: 1,
    exportedAt: new Date().toISOString(),
    homepage: state.data,
    groups: groups.map((g) =>
      pick(g, ["id", "name", "sortOrder", "collapsed"]),
    ),
    resources: resources.map((r) => ({
      ...pick(r, [
        "id",
        "name",
        "kind",
        "url",
        "description",
        "icon",
        "color",
        "host",
        "notes",
        "favorite",
        "monitoringMode",
        "manualStatus",
        "sortOrder",
        "groupId",
        "purpose",
        "workspaceId",
        "collectionId",
        "readingState",
      ]),
      deletedAt: r.deletedAt?.toISOString() ?? null,
    })),
    checks: checks.map((c) =>
      pick(c, [
        "id",
        "resourceId",
        "type",
        "target",
        "intervalSeconds",
        "timeoutMs",
        "enabled",
        "managed",
        "primary",
        "failureThreshold",
        "successThreshold",
      ]),
    ),
    hosts: hosts.map((h) =>
      pick(h, [
        "id",
        "name",
        "baseUrl",
        "enabled",
        "sortOrder",
        "primaryMount",
        "networkInterface",
      ]),
    ),
    widgets: widgets.map((w) =>
      pick(w, [
        "id",
        "name",
        "templateId",
        "baseUrl",
        "endpointPath",
        "authType",
        "authHeaderName",
        "authEnvVar",
        "authValuePrefix",
        "tlsVerify",
        "fieldMappings",
        "enabled",
        "pollIntervalSeconds",
        "sortOrder",
      ]),
    ),
    settings: {
      ...(read("dashboard_utilities_v1")
        ? { dashboardUtilities: JSON.parse(read("dashboard_utilities_v1")!) }
        : {}),
      ...(read("dashboard_home_v1")
        ? { dashboardHome: JSON.parse(read("dashboard_home_v1")!) }
        : {}),
      autoPingIntervalSeconds: Number(read("auto_ping_interval_seconds") ?? 60),
    },
    requiredEnvironment: [
      ...new Set(widgets.flatMap((w) => (w.authEnvVar ? [w.authEnvVar] : []))),
    ],
    assets: assets.map((a) => ({ id: a.id, mimeType: a.mimeType })),
  });
  return { manifest, assets };
}
export function encodeBackup(
  manifest: PortableBackup,
  assets: { id: string; body: Uint8Array }[],
) {
  const manifestBytes = strToU8(JSON.stringify(manifest));
  if (manifestBytes.length > 8 * 1024 * 1024)
    bad("Configuration exceeds archive limit");
  if (
    assets.reduce((n, a) => n + a.body.length, manifestBytes.length) >
    MAX_ARCHIVE
  )
    bad("Configuration archive exceeds 32 MiB");
  const files: Record<string, Uint8Array> = { "manifest.json": manifestBytes };
  for (const a of assets) files[`assets/${a.id}.png`] = a.body;
  return Buffer.from(zipSync(files, { level: 0 }));
}
export function decodeBackup(encoded: string) {
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_ARCHIVE + 64_000)
    bad("Archive exceeds 32 MiB");
  let total = 0;
  let count = 0;
  const names = new Set<string>();
  const files = (() => {
    try {
      return unzipSync(bytes, {
        filter: (file) => {
          if (
            ++count > 33 ||
            !/^(manifest\.json|assets\/[a-f0-9]{64}\.png)$/.test(file.name)
          )
            bad("Unexpected archive entry");
          if (names.has(file.name)) bad("Duplicate archive entry");
          names.add(file.name);
          total += file.originalSize;
          if (
            file.originalSize >
              (file.name === "manifest.json" ? 8 * 1024 * 1024 : MAX_ASSET) ||
            total > MAX_ARCHIVE
          )
            bad("Archive expands beyond the allowed size");
          return true;
        },
      });
    } catch {
      bad("Invalid, unsafe, or oversized configuration archive");
    }
  })();
  if (!files["manifest.json"]) bad("Archive manifest missing");
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(files["manifest.json"]));
  } catch {
    bad("Invalid archive manifest JSON");
  }
  const manifest = backupSchema.parse(raw);
  const unique = (items: { id: string }[], label: string) => {
    if (new Set(items.map((i) => i.id)).size !== items.length)
      bad(`Duplicate ${label} IDs`);
  };
  for (const [label, items] of Object.entries({
    groups: manifest.groups,
    resources: manifest.resources,
    checks: manifest.checks,
    hosts: manifest.hosts,
    widgets: manifest.widgets,
    assets: manifest.assets,
  }))
    unique(items, label);
  const groups = new Set(manifest.groups.map((g) => g.id));
  const resources = new Map(manifest.resources.map((r) => [r.id, r]));
  const widgets = new Set(manifest.widgets.map((w) => w.id));
  for (const r of manifest.resources) {
    if (r.groupId && !groups.has(r.groupId)) bad("Missing service group");
    if (r.purpose === "bookmark") {
      if (!r.url) bad("Bookmark URL missing");
      assertCollection(manifest.homepage, r.workspaceId, r.collectionId);
    }
  }
  for (const c of manifest.checks)
    if (!resources.has(c.resourceId)) bad("Missing check resource");
  for (const id of [
    manifest.settings.dashboardHome?.plexWidgetId,
    manifest.settings.dashboardHome?.radarrWidgetId,
  ])
    if (id && !widgets.has(id)) bad("Missing media widget");
  const assets = manifest.assets.map((a) => {
    const body = files[`assets/${a.id}.png`];
    if (!body) bad("Missing background asset");
    validateBackground(Buffer.from(body));
    if (createHash("sha256").update(body).digest("hex") !== a.id)
      bad("Background checksum mismatch");
    return { ...a, body: Buffer.from(body) };
  });
  if (Object.keys(files).length !== assets.length + 1)
    bad("Unlisted archive assets");
  for (const workspace of Object.values(manifest.homepage.workspaces))
    if (
      workspace.layout.background.startsWith("asset:") &&
      !assets.some((a) => a.id === workspace.layout.background.slice(6))
    )
      bad("Background reference missing");
  return { manifest, assets };
}
export async function restoreConfiguration(
  tx: HomeDatabase,
  manifest: PortableBackup,
  assets: { id: string; mimeType: string; body: Buffer }[],
  revision: number,
) {
  await claimRevision(tx, revision);
  // Config replacement also removes derived history belonging to replaced definitions.
  await tx.resource.deleteMany();
  await tx.dashboardGroup.deleteMany();
  await tx.hostMonitor.deleteMany();
  await tx.apiWidget.deleteMany();
  await tx.homepageAsset.deleteMany();
  await tx.systemConfig.upsert({
    where: { key: "api_widget_secret_bindings_v1" },
    create: { key: "api_widget_secret_bindings_v1", value: "{}" },
    update: { value: "{}" },
  });
  for (const g of manifest.groups) await tx.dashboardGroup.create({ data: g });
  for (const r of manifest.resources)
    await tx.resource.create({
      data: {
        ...r,
        monitoringMode: "disabled",
        deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,
      },
    });
  for (const c of manifest.checks)
    await tx.healthCheck.create({ data: { ...c, enabled: false } });
  for (const h of manifest.hosts)
    await tx.hostMonitor.create({ data: { ...h, enabled: false } });
  for (const w of manifest.widgets)
    await tx.apiWidget.create({
      data: { ...w, enabled: false, tlsVerify: true },
    });
  for (const a of assets)
    await tx.homepageAsset.create({
      data: { ...a, body: new Uint8Array(a.body) },
    });
  const entries = [
    [
      "dashboard_utilities_v1",
      manifest.settings.dashboardUtilities
        ? JSON.stringify(manifest.settings.dashboardUtilities)
        : null,
    ],
    [
      "dashboard_home_v1",
      manifest.settings.dashboardHome
        ? JSON.stringify(manifest.settings.dashboardHome)
        : null,
    ],
    [
      "auto_ping_interval_seconds",
      String(manifest.settings.autoPingIntervalSeconds ?? 60),
    ],
  ];
  for (const [key, value] of entries) {
    if (value === null)
      await tx.systemConfig.deleteMany({ where: { key: key! } });
    else
      await tx.systemConfig.upsert({
        where: { key: key! },
        create: { key: key!, value: value! },
        update: { value: value! },
      });
  }
  await tx.homepageState.update({
    where: { id: "main" },
    data: { data: manifest.homepage },
  });
  return readHomepage(tx);
}
export function registerHomepageBackupRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  reauth: (r: FastifyRequest, p: FastifyReply) => boolean,
) {
  const previews = new Map<
    string,
    {
      decoded: ReturnType<typeof decodeBackup>;
      revision: number;
      session: string;
      expires: number;
    }
  >();
  const exports = new Map<
    string,
    { revision: number; session: string; expires: number }
  >();
  const session = (r: FastifyRequest) =>
    createHash("sha256")
      .update(r.cookies.homelab_session ?? "")
      .digest("hex");
  app.post("/api/config/export", async (request, reply) => {
    if (!reauth(request, reply)) return reply;
    const data = await prisma.$transaction(async (tx) => ({
      ...(await exportConfiguration(tx)),
      revision: (
        await tx.homepageState.findUniqueOrThrow({ where: { id: "main" } })
      ).revision,
    }));
    const archive = encodeBackup(data.manifest, data.assets);
    const token = randomUUID();
    if (exports.size >= 10) exports.clear();
    exports.set(token, {
      revision: data.revision,
      session: session(request),
      expires: Date.now() + 600_000,
    });
    return {
      archive: archive.toString("base64"),
      exportToken: token,
      revision: data.revision,
      filename: `homelab-config-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`,
    };
  });
  app.post(
    "/api/config/import/preview",
    { bodyLimit: 45 * 1024 * 1024 },
    async (request, reply) => {
      if (!reauth(request, reply)) return reply;
      const { archive } = z
        .object({ archive: z.string().max(45 * 1024 * 1024) })
        .strict()
        .parse(request.body);
      const decoded = decodeBackup(archive);
      const revision = (
        await prisma.homepageState.findUniqueOrThrow({ where: { id: "main" } })
      ).revision;
      if (previews.size >= 2) previews.clear();
      const token = randomUUID();
      previews.set(token, {
        decoded,
        revision,
        session: session(request),
        expires: Date.now() + 600_000,
      });
      return {
        token,
        revision,
        counts: {
          bookmarks: decoded.manifest.resources.filter(
            (r) => r.purpose === "bookmark",
          ).length,
          services: decoded.manifest.resources.filter(
            (r) => r.purpose === "service",
          ).length,
          groups: decoded.manifest.groups.length,
          checks: decoded.manifest.checks.length,
          hosts: decoded.manifest.hosts.length,
          widgets: decoded.manifest.widgets.length,
          collections: decoded.manifest.homepage.collections.length,
          prompts: decoded.manifest.homepage.prompts.length,
          assets: decoded.assets.length,
        },
        requiredEnvironment: decoded.manifest.requiredEnvironment,
        warnings: [
          "Replaces portable configuration and removes monitoring history belonging to replaced definitions.",
          "All restored monitoring and API widgets start disabled; credentials must be reviewed and rebound.",
          "Administrator credentials, server security settings, and environment-managed integrations remain on this server.",
        ],
      };
    },
  );
  app.post("/api/config/import/apply", async (request, reply) => {
    if (!reauth(request, reply)) return reply;
    const { token, exportToken, downloaded } = z
      .object({
        token: z.string().uuid(),
        exportToken: z.string().uuid(),
        downloaded: z.literal(true),
      })
      .strict()
      .parse(request.body);
    const preview = previews.get(token);
    const backup = exports.get(exportToken);
    if (
      !preview ||
      preview.expires < Date.now() ||
      preview.session !== session(request)
    )
      bad("Import preview expired");
    if (
      !backup ||
      backup.expires < Date.now() ||
      backup.session !== session(request) ||
      backup.revision !== preview.revision ||
      !downloaded
    )
      bad("Download a current configuration backup before restoring");
    const result = await prisma.$transaction(
      (tx) =>
        restoreConfiguration(
          tx,
          preview.decoded.manifest,
          preview.decoded.assets,
          preview.revision,
        ),
      { timeout: 30_000 },
    );
    previews.delete(token);
    exports.delete(exportToken);
    return result;
  });
  app.post(
    "/api/homepage/assets",
    { bodyLimit: 6 * 1024 * 1024 },
    async (request) => {
      const { body: encoded, revision } = z
        .object({
          body: z.string().max(6 * 1024 * 1024),
          revision: z.number().int().min(0),
        })
        .strict()
        .parse(request.body);
      const body = Buffer.from(encoded, "base64");
      validateBackground(body);
      const id = createHash("sha256").update(body).digest("hex");
      return prisma.$transaction(async (tx) => {
        await claimRevision(tx, revision);
        const assets = await tx.homepageAsset.findMany();
        if (
          assets.reduce((sum, a) => sum + a.body.length, body.length) >
            24 * 1024 * 1024 ||
          assets.length >= 32
        )
          bad("Background storage is full; remove an unused background first");
        await tx.homepageAsset.upsert({
          where: { id },
          create: { id, body, mimeType: "image/png" },
          update: {},
        });
        return { id, snapshot: await readHomepage(tx) };
      });
    },
  );
  app.get("/api/homepage/assets/:id", async (request, reply) => {
    const { id } = z
      .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(request.params);
    const asset = await prisma.homepageAsset.findUnique({ where: { id } });
    if (!asset) return reply.code(404).send({ error: "Background not found" });
    return reply.type(asset.mimeType).send(Buffer.from(asset.body));
  });
  app.post("/api/homepage/assets/:id/delete", async (request) => {
    const { id } = z
      .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(request.params);
    const { revision } = z
      .object({ revision: z.number().int() })
      .parse(request.body);
    return prisma.$transaction(async (tx) => {
      await claimRevision(tx, revision);
      const state = await tx.homepageState.findUniqueOrThrow({
        where: { id: "main" },
      });
      if (
        Object.values(homepageDataSchema.parse(state.data).workspaces).some(
          (w) => w.layout.background === `asset:${id}`,
        )
      )
        bad("Choose another background before deleting this one");
      await tx.homepageAsset.delete({ where: { id } });
      return readHomepage(tx);
    });
  });
}
