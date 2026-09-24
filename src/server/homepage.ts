import { randomUUID } from "node:crypto";
import type { HomepageAsset, HomepageState, Prisma, PrismaClient, Resource } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import {
  bookmarkInputSchema,
  defaultHomepage,
  homepageDataSchema,
  homepageId,
  workspaceIdSchema,
  type HomepageData,
} from "../shared/homepage.js";

export type HomeDatabase = Prisma.TransactionClient;
export class HomeConflict extends Error {
  statusCode = 409;
  constructor() {
    super(
      "Configuration changed on another device. Reload saved data before resubmitting your draft.",
    );
  }
}
export async function claimRevision(tx: HomeDatabase, revision: number) {
  const result = await tx.homepageState.updateMany({
    where: { id: "main", revision },
    data: { revision: { increment: 1 } },
  });
  if (!result.count) throw new HomeConflict();
}
function homepageReads(tx: HomeDatabase) {
  return [
    tx.homepageState.findUniqueOrThrow({ where: { id: "main" } }),
    tx.resource.findMany({
      where: { purpose: "bookmark" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    tx.homepageAsset.findMany({ select: { id: true, mimeType: true } }),
  ] as const;
}
function homepageSnapshot([state, bookmarks, assets]: readonly [HomepageState, Resource[], Pick<HomepageAsset, "id" | "mimeType">[]]) {
  return {
    revision: state.revision,
    data: homepageDataSchema.parse(state.data),
    bookmarks: bookmarks.map((b) => ({
      id: b.id,
      name: b.name,
      url: b.url,
      notes: b.notes ?? "",
      favorite: b.favorite,
      workspaceId: b.workspaceId,
      collectionId: b.collectionId,
      readingState: b.readingState,
      deletedAt: b.deletedAt,
      sortOrder: b.sortOrder,
      updatedAt: b.updatedAt,
    })),
    assets,
  };
}
export async function readHomepage(tx: HomeDatabase) {
  return homepageSnapshot(await Promise.all(homepageReads(tx)));
}
async function readHomepageSnapshot(prisma: PrismaClient) {
  // Execute the whole read in the engine: overlapping interactive SQLite reads
  // can block each other's callbacks until both transactions time out.
  return homepageSnapshot(await prisma.$transaction([...homepageReads(prisma)]));
}
export async function initializeHomepage(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    await tx.homepageState.upsert({
      where: { id: "main" },
      create: { id: "main", data: defaultHomepage() },
      update: {},
    });
    if (
      await tx.systemConfig.findUnique({
        where: { key: "homepage_v1_backfill" },
      })
    )
      return;
    const existing = await tx.resource.findMany({
      where: {
        kind: "website",
        monitoringMode: "disabled",
        url: { not: null },
      },
    });
    const groups = await tx.dashboardGroup.findMany();
    const data = defaultHomepage();
    const utilityRow = await tx.systemConfig.findUnique({
      where: { key: "dashboard_utilities_v1" },
    });
    const homeRow = await tx.systemConfig.findUnique({
      where: { key: "dashboard_home_v1" },
    });
    try {
      const utilities = JSON.parse(utilityRow?.value ?? "{}");
      const config = JSON.parse(homeRow?.value ?? "{}");
      for (const widget of data.workspaces.home.layout.widgets) {
        if (widget.id === "releases" && utilities.releases?.enabled)
          widget.enabled = true;
        if (widget.id === "weather" && utilities.weather?.enabled)
          widget.enabled = true;
        if (
          ["agenda", "tasks", "mail", "media", "storage"].includes(widget.id) &&
          config[`${widget.id}Enabled`]
        )
          widget.enabled = true;
      }
    } catch {
      /* Invalid legacy settings keep the minimal default homepage. */
    }
    for (const group of groups)
      if (existing.some((r) => r.groupId === group.id))
        data.collections.push({
          id: group.id,
          name: group.name,
          parentId: null,
          workspaceId: "home",
          sortOrder: group.sortOrder,
        });
    for (const item of existing) {
      await tx.resource.update({
        where: { id: item.id },
        data: {
          purpose: "bookmark",
          collectionId: item.groupId,
          workspaceId: "home",
        },
      });
      await tx.healthCheck.updateMany({
        where: { resourceId: item.id },
        data: { enabled: false },
      });
    }
    await tx.homepageState.update({ where: { id: "main" }, data: { data } });
    await tx.systemConfig.create({
      data: { key: "homepage_v1_backfill", value: "1" },
    });
  });
  // Database triggers keep legacy routes and homepage routes in one atomic revision domain.
  const columns: Record<string, string> = {
    Resource:
      "name,kind,purpose,workspaceId,collectionId,readingState,deletedAt,url,description,icon,color,host,notes,favorite,monitoringMode,manualStatus,sortOrder,groupId",
    DashboardGroup: "name,sortOrder,collapsed",
    HealthCheck:
      "resourceId,type,target,intervalSeconds,timeoutMs,enabled,managed,primary,failureThreshold,successThreshold",
    HostMonitor: "name,baseUrl,enabled,sortOrder,primaryMount,networkInterface",
    ApiWidget:
      "name,templateId,baseUrl,endpointPath,authType,authHeaderName,authEnvVar,authValuePrefix,tlsVerify,fieldMappings,enabled,pollIntervalSeconds,sortOrder",
    HomepageAsset: "mimeType,body",
    HomepageState: "data",
  };
  for (const [table, fields] of Object.entries(columns))
    for (const event of ["INSERT", "UPDATE", "DELETE"]) {
      if (table === "HomepageState" && event !== "UPDATE") continue;
      const updateFields = fields
        .split(",")
        .map((f) => `"${f}"`)
        .join(",");
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER IF NOT EXISTS "homepage_${table}_${event}" AFTER ${event === "UPDATE" ? `UPDATE OF ${updateFields}` : event} ON "${table}" BEGIN UPDATE "HomepageState" SET revision = revision + 1 WHERE id = 'main'; END`,
      );
    }
  for (const event of ["INSERT", "UPDATE", "DELETE"]) {
    const row = event === "DELETE" ? "OLD" : "NEW";
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER IF NOT EXISTS "homepage_settings_${event}" AFTER ${event} ON "SystemConfig" WHEN ${row}.key IN ('dashboard_utilities_v1','dashboard_home_v1','auto_ping_interval_seconds') BEGIN UPDATE "HomepageState" SET revision = revision + 1 WHERE id = 'main'; END`,
    );
  }
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER IF NOT EXISTS homepage_bookmark_monitoring BEFORE UPDATE ON Resource WHEN NEW.purpose = 'bookmark' AND NEW.monitoringMode != 'disabled' BEGIN SELECT RAISE(ABORT, 'Bookmarks cannot be monitored'); END`,
  );
}

export function assertCollection(
  data: HomepageData,
  workspaceId: string,
  collectionId: string | null,
) {
  if (
    collectionId &&
    !data.collections.some(
      (c) => c.id === collectionId && c.workspaceId === workspaceId,
    )
  )
    throw Object.assign(
      new Error("Collection is not in the selected workspace"),
      { statusCode: 400 },
    );
}
const revisionSchema = z.number().int().min(0);
function bad(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

export function parseBookmarkHtml(html: string) {
  if (Buffer.byteLength(html) > 5 * 1024 * 1024)
    bad("Bookmark file exceeds 5 MiB");
  if (!/<DL[\s>]/i.test(html)) bad("Expected a browser bookmark HTML export");
  const root = parse(html);
  const entries: { name: string; url: string; folders: string[] }[] = [];
  type Node = DefaultTreeAdapterMap["node"];
  function text(node: Node): string {
    const pending = [node];
    const parts: string[] = [];
    let visited = 0;
    while (pending.length) {
      if (++visited > 100_000) bad("Bookmark text is too complex");
      const current = pending.pop()!;
      if ("value" in current) parts.push(current.value);
      else if ("childNodes" in current)
        for (let index = current.childNodes.length - 1; index >= 0; index--)
          pending.push(current.childNodes[index]);
    }
    return parts.join("");
  }
  let pending: string | null = null;
  let count = 0;
  function visit(node: Node, folders: string[], depth: number) {
    if (++count > 100_000 || depth > 100) bad("Bookmark HTML is too complex");
    const tag = "tagName" in node ? node.tagName : "";
    if (["script", "style", "iframe", "template"].includes(tag)) return;
    if (tag === "h3") {
      pending = text(node).trim().slice(0, 120) || "Imported";
      return;
    }
    if (tag === "a" && "attrs" in node) {
      const href = node.attrs.find((a) => a.name === "href")?.value;
      if (!href) return;
      const parsed = bookmarkInputSchema.safeParse({
        name: text(node).trim().slice(0, 160) || href.slice(0, 160),
        url: href,
        workspaceId: "home",
      });
      if (!parsed.success)
        bad("The bookmark file contains an invalid or unsafe URL");
      entries.push({ name: parsed.data.name, url: parsed.data.url, folders });
      if (entries.length > 10_000)
        bad("A bookmark import is limited to 10,000 links");
      return;
    }
    let current = folders;
    if (tag === "dl" && pending) {
      current = [...folders, pending];
      pending = null;
      if (current.length > 20) bad("Collections cannot exceed 20 levels");
    }
    if ("childNodes" in node)
      for (const child of node.childNodes) visit(child, current, depth + 1);
  }
  visit(root, [], 0);
  if (!entries.length) bad("No bookmarks found");
  return entries;
}
export const htmlEscape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export async function registerHomepageRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  reauth: (req: FastifyRequest, reply: FastifyReply) => boolean,
) {
  app.get("/api/homepage", () => readHomepageSnapshot(prisma));
  app.get("/api/config/revision", async () => {
    const s = await prisma.homepageState.findUniqueOrThrow({
      where: { id: "main" },
    });
    return { revision: s.revision };
  });
  app.post("/api/homepage/state", async (request) => {
    const { revision, data } = z
      .object({ revision: revisionSchema, data: homepageDataSchema })
      .strict()
      .parse(request.body);
    return prisma.$transaction(async (tx) => {
      await claimRevision(tx, revision);
      const bookmarks = await tx.resource.findMany({
        where: { purpose: "bookmark" },
      });
      for (const b of bookmarks)
        assertCollection(data, b.workspaceId, b.collectionId);
      for (const w of Object.values(data.workspaces))
        if (
          w.layout.background.startsWith("asset:") &&
          !(await tx.homepageAsset.findUnique({
            where: { id: w.layout.background.slice(6) },
          }))
        )
          bad("Background asset is missing");
      await tx.homepageState.update({ where: { id: "main" }, data: { data } });
      return readHomepage(tx);
    });
  });
  app.post("/api/homepage/bookmarks", async (request, reply) => {
    if (!reauth(request, reply)) return reply;
    const { revision, bookmark, id } = z
      .object({
        revision: revisionSchema,
        bookmark: bookmarkInputSchema,
        id: homepageId.optional(),
      })
      .strict()
      .parse(request.body);
    return prisma.$transaction(async (tx) => {
      await claimRevision(tx, revision);
      const state = await tx.homepageState.findUniqueOrThrow({
        where: { id: "main" },
      });
      assertCollection(
        homepageDataSchema.parse(state.data),
        bookmark.workspaceId,
        bookmark.collectionId,
      );
      if (id) {
        const previous = await tx.resource.findUnique({ where: { id } });
        if (!previous || previous.purpose !== "bookmark")
          bad("Bookmark not found");
      }
      const fields = {
        ...bookmark,
        kind: "website",
        purpose: "bookmark",
        monitoringMode: "disabled",
      };
      if (id) await tx.resource.update({ where: { id }, data: fields });
      else {
        if (
          (await tx.resource.count({ where: { purpose: "bookmark" } })) >=
          10_000
        )
          bad("Bookmark limit reached");
        await tx.resource.create({ data: fields });
      }
      return readHomepage(tx);
    });
  });
  app.post("/api/homepage/bookmarks/bulk", async (request, reply) => {
    const body = z
      .object({
        revision: revisionSchema,
        ids: z.array(homepageId).min(1).max(10_000),
        action: z.enum([
          "trash",
          "restore",
          "delete",
          "move",
          "favorite",
          "reorder",
        ]),
        workspaceId: workspaceIdSchema.optional(),
        collectionId: homepageId.nullable().optional(),
        favorite: z.boolean().optional(),
      })
      .strict()
      .parse(request.body);
    if (body.action === "delete" && !reauth(request, reply)) return reply;
    return prisma.$transaction(async (tx) => {
      await claimRevision(tx, body.revision);
      const found = await tx.resource.findMany({
        where: { id: { in: body.ids }, purpose: "bookmark" },
      });
      if (found.length !== body.ids.length)
        bad("Unknown or duplicate bookmarks");
      if (body.action === "delete") {
        if (found.some((b) => !b.deletedAt))
          bad("Move bookmarks to trash before deleting them");
        await tx.resource.deleteMany({
          where: { id: { in: body.ids }, purpose: "bookmark" },
        });
      } else if (body.action === "reorder") {
        for (const [sortOrder, id] of body.ids.entries())
          await tx.resource.update({ where: { id }, data: { sortOrder } });
      } else {
        const fields: Prisma.ResourceUpdateManyMutationInput = {};
        if (body.action === "trash") fields.deletedAt = new Date();
        if (body.action === "restore") fields.deletedAt = null;
        if (body.action === "favorite") fields.favorite = body.favorite ?? true;
        if (body.action === "move") {
          if (!body.workspaceId) bad("Choose a workspace");
          const state = await tx.homepageState.findUniqueOrThrow({
            where: { id: "main" },
          });
          assertCollection(
            homepageDataSchema.parse(state.data),
            body.workspaceId,
            body.collectionId ?? null,
          );
          fields.workspaceId = body.workspaceId;
          fields.collectionId = body.collectionId ?? null;
        }
        await tx.resource.updateMany({
          where: { id: { in: body.ids }, purpose: "bookmark" },
          data: fields,
        });
      }
      return readHomepage(tx);
    });
  });
  const imports = new Map<
    string,
    {
      revision: number;
      workspaceId: "home" | "work";
      entries: ReturnType<typeof parseBookmarkHtml>;
      expires: number;
    }
  >();
  app.post(
    "/api/homepage/bookmarks/import/preview",
    { bodyLimit: 6 * 1024 * 1024 },
    async (request) => {
      const body = z
        .object({
          html: z.string().max(5 * 1024 * 1024),
          revision: revisionSchema,
          workspaceId: workspaceIdSchema,
        })
        .strict()
        .parse(request.body);
      const entries = parseBookmarkHtml(body.html);
      const existing = await prisma.resource.findMany({
        where: { purpose: "bookmark", workspaceId: body.workspaceId },
      });
      const urls = new Set(existing.map((b) => b.url));
      const unique = entries.filter((b) => {
        if (urls.has(b.url)) return false;
        urls.add(b.url);
        return true;
      });
      if (imports.size >= 5) imports.clear();
      const token = randomUUID();
      imports.set(token, {
        ...body,
        entries: unique,
        expires: Date.now() + 600_000,
      });
      return {
        token,
        additions: unique.length,
        duplicates: entries.length - unique.length,
        collections: [
          ...new Set(unique.map((e) => e.folders.join(" / ")).filter(Boolean)),
        ],
        sample: unique.slice(0, 20),
      };
    },
  );
  const undo = new Map<
    string,
    { ids: string[]; revision: number; expires: number }
  >();
  app.post("/api/homepage/bookmarks/import/apply", async (request, reply) => {
    if (!reauth(request, reply)) return reply;
    const { token } = z
      .object({ token: z.string().uuid() })
      .parse(request.body);
    const preview = imports.get(token);
    if (!preview || preview.expires < Date.now())
      bad("Preview expired; upload the file again");
    const result = await prisma.$transaction(
      async (tx) => {
        await claimRevision(tx, preview.revision);
        if (
          (await tx.resource.count({ where: { purpose: "bookmark" } })) +
            preview.entries.length >
          10_000
        )
          bad("Bookmark limit reached");
        const state = await tx.homepageState.findUniqueOrThrow({
          where: { id: "main" },
        });
        const data = homepageDataSchema.parse(state.data);
        const ids: string[] = [];
        for (const entry of preview.entries) {
          let parentId: string | null = null;
          for (const name of entry.folders) {
            let c = data.collections.find(
              (c) =>
                c.name === name &&
                c.parentId === parentId &&
                c.workspaceId === preview.workspaceId,
            );
            if (!c) {
              c = {
                id: randomUUID(),
                workspaceId: preview.workspaceId,
                parentId,
                name,
                sortOrder: data.collections.length,
              };
              data.collections.push(c);
            }
            parentId = c.id;
          }
          const b = await tx.resource.create({
            data: {
              name: entry.name,
              url: entry.url,
              workspaceId: preview.workspaceId,
              collectionId: parentId,
              kind: "website",
              purpose: "bookmark",
              monitoringMode: "disabled",
              importBatch: token,
            },
          });
          ids.push(b.id);
        }
        await tx.homepageState.update({
          where: { id: "main" },
          data: { data: homepageDataSchema.parse(data) },
        });
        return { snapshot: await readHomepage(tx), ids };
      },
      { timeout: 30_000 },
    );
    imports.delete(token);
    if (undo.size >= 5) undo.clear();
    undo.set(token, {
      ids: result.ids,
      revision: result.snapshot.revision,
      expires: Date.now() + 600_000,
    });
    return { ...result.snapshot, undoToken: token };
  });
  app.post("/api/homepage/bookmarks/import/undo", async (request, reply) => {
    if (!reauth(request, reply)) return reply;
    const { token } = z
      .object({ token: z.string().uuid() })
      .parse(request.body);
    const batch = undo.get(token);
    if (!batch || batch.expires < Date.now()) bad("Undo expired");
    const result = await prisma.$transaction(async (tx) => {
      await claimRevision(tx, batch.revision);
      await tx.resource.deleteMany({
        where: { id: { in: batch.ids }, importBatch: token },
      });
      return readHomepage(tx);
    });
    undo.delete(token);
    return result;
  });
  app.get("/api/homepage/bookmarks/export", async (request) => {
    const { workspaceId, format } = z
      .object({
        workspaceId: workspaceIdSchema,
        format: z.enum(["html", "json"]),
      })
      .parse(request.query);
    const snapshot = await readHomepageSnapshot(prisma);
    const items = snapshot.bookmarks.filter(
      (b) => b.workspaceId === workspaceId && !b.deletedAt,
    );
    function folder(parentId: string | null): string {
      const links = items
        .filter((b) => b.collectionId === parentId)
        .map(
          (b) =>
            `<DT><A HREF="${htmlEscape(b.url ?? "")}">${htmlEscape(b.name)}</A>`,
        )
        .join("\n");
      return (
        links +
        snapshot.data.collections
          .filter(
            (c) => c.workspaceId === workspaceId && c.parentId === parentId,
          )
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(
            (c) =>
              `<DT><H3>${htmlEscape(c.name)}</H3>\n<DL><p>\n${folder(c.id)}\n</DL><p>`,
          )
          .join("\n")
      );
    }
    return {
      filename: `bookmarks-${workspaceId}.${format}`,
      content:
        format === "json"
          ? JSON.stringify(
              {
                version: 1,
                collections: snapshot.data.collections.filter(
                  (c) => c.workspaceId === workspaceId,
                ),
                bookmarks: items,
              },
              null,
              2,
            )
          : `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${folder(null)}\n</DL><p>`,
    };
  });
}
