import { z } from "zod";

export const workspaceIdSchema = z.enum(["home", "work"]);
export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export const homepageId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const shortcutSelectionSchema = z.object({
  bookmarkIds: z.array(homepageId).max(10_000),
  collectionIds: z.array(homepageId).max(1000),
}).strict().nullable().default(null);
export const widgetIds = [
  "favorites",
  "bookmarks",
  "weather",
  "notes",
  "prompts",
  "reading",
  "timer",
  "agenda",
  "tasks",
  "mail",
  "media",
  "storage",
  "services",
  "releases",
] as const;
export const layoutSchema = z
  .object({
    // Accept retired theme choices so existing saves and archives remain readable.
    accent: z.enum(["blue", "green", "violet", "amber", "rose", "cyan"])
      .transform(value => value === "rose" || value === "cyan" ? "blue" : value),
    background: z.string().regex(/^(none|dawn|ocean|aurora|sunset|asset:[a-f0-9]{64})$/)
      .transform(value => value === "aurora" || value === "sunset" ? "none" : value),
    colorStyle: z.enum(["vivid", "soft", "minimal"]).transform(() => "minimal" as const).default("minimal"),
    spacing: z.enum(["comfortable", "compact"]).default("comfortable"),
    shortcutStyle: z.enum(["tiles", "compact"]).default("tiles"),
    centerShortcuts: shortcutSelectionSchema,
    sidebarShortcuts: shortcutSelectionSchema,
    clock: z.enum(["digital", "hidden"]),
    widgets: z
      .array(
        z
          .object({
            id: z.enum(widgetIds),
            enabled: z.boolean(),
            size: z.enum(["normal", "wide"]),
            presentation: z.enum(["section", "dropdown"]).default("section"),
          })
          .strict(),
      )
      .length(widgetIds.length),
  })
  .strict()
  .refine(
    (v) => new Set(v.widgets.map((w) => w.id)).size === widgetIds.length,
    "Widgets must be unique",
  );
export type HomeLayout = z.infer<typeof layoutSchema>;
export function defaultLayout(work: boolean): HomeLayout {
  return {
    accent: "blue",
    background: "none",
    colorStyle: "minimal",
    spacing: "comfortable",
    shortcutStyle: "tiles",
    centerShortcuts: null,
    sidebarShortcuts: null,
    clock: "digital",
    widgets: widgetIds.map((id) => ({
      id,
      enabled:
        ["favorites", "bookmarks"].includes(id) ||
        (!work && id === "services") ||
        (work && ["notes", "prompts", "reading", "timer"].includes(id)),
      size: ["favorites", "bookmarks", "services"].includes(id)
        ? "wide"
        : "normal",
      presentation: "section",
    })),
  };
}
const workspaceSchema = z.object({
  notes: z.string().max(50_000),
  savedNotes: z.array(z.object({
    id: homepageId,
    title: z.string().trim().min(1).max(160),
    text: z.string().min(1).max(50_000),
  }).strict()).max(200).default([]),
  layout: layoutSchema,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.savedNotes.map(n => n.id)).size !== value.savedNotes.length)
    ctx.addIssue({ code: "custom", message: "Duplicate note IDs" });
  if (value.notes && value.savedNotes.some(n => n.id === "legacy-scratchpad"))
    ctx.addIssue({ code: "custom", message: "Save the original scratchpad before reusing its ID" });
  if (value.savedNotes.reduce((total, n) => total + n.text.length, 0) > 500_000)
    ctx.addIssue({ code: "custom", message: "Notes exceed the workspace text limit" });
});
export const homepageDataSchema = z
  .object({
    workspaces: z
      .object({
        home: workspaceSchema,
        work: workspaceSchema,
      })
      .strict(),
    collections: z
      .array(
        z
          .object({
            id: homepageId,
            workspaceId: workspaceIdSchema,
            parentId: homepageId.nullable(),
            name: z.string().trim().min(1).max(120),
            sortOrder: z.number().int().min(0),
          })
          .strict(),
      )
      .max(1000),
    prompts: z
      .array(
        z
          .object({
            id: homepageId,
            workspaceId: workspaceIdSchema,
            title: z.string().trim().min(1).max(160),
            text: z.string().trim().min(1).max(20_000),
          })
          .strict(),
      )
      .max(500),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (new Set(data.prompts.map((p) => p.id)).size !== data.prompts.length)
      ctx.addIssue({ code: "custom", message: "Duplicate prompt IDs" });
    const byId = new Map(data.collections.map((c) => [c.id, c]));
    if (byId.size !== data.collections.length)
      ctx.addIssue({ code: "custom", message: "Duplicate collections" });
    for (const c of data.collections) {
      const seen = new Set([c.id]);
      let parent = c.parentId;
      while (parent) {
        const p = byId.get(parent);
        if (
          !p ||
          seen.has(parent) ||
          p.workspaceId !== c.workspaceId ||
          seen.size > 20
        ) {
          ctx.addIssue({
            code: "custom",
            message: "Collection hierarchy is invalid or deeper than 20 levels",
          });
          break;
        }
        seen.add(parent);
        parent = p.parentId;
      }
    }
  });
export type HomepageData = z.infer<typeof homepageDataSchema>;
export function defaultHomepage(): HomepageData {
  return {
    workspaces: {
      home: { notes: "", savedNotes: [], layout: defaultLayout(false) },
      work: { notes: "", savedNotes: [], layout: defaultLayout(true) },
    },
    collections: [],
    prompts: [],
  };
}
export const bookmarkInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    url: z
      .string()
      .trim()
      .max(2000)
      .transform((v, ctx) => {
        try {
          const u = new URL(v);
          if (
            !["http:", "https:"].includes(u.protocol) ||
            u.username ||
            u.password
          )
            throw new Error();
          return u.href;
        } catch {
          ctx.addIssue({
            code: "custom",
            message: "Use an HTTP or HTTPS URL without credentials",
          });
          return z.NEVER;
        }
      }),
    notes: z.string().max(20_000).default(""),
    favorite: z.boolean().default(false),
    workspaceId: workspaceIdSchema,
    collectionId: homepageId.nullable().default(null),
    readingState: z.enum(["none", "unread", "reading", "done"]).default("none"),
  })
  .strict();
export type BookmarkInput = z.infer<typeof bookmarkInputSchema>;
export type HomepageBookmark = BookmarkInput & {
  id: string;
  sortOrder: number;
  deletedAt: string | null;
  updatedAt: string;
};
export type HomepageSnapshot = {
  revision: number;
  data: HomepageData;
  bookmarks: HomepageBookmark[];
  assets: { id: string; mimeType: string }[];
};
export function collectionLabel(data: HomepageData, id: string | null): string {
  const parts: string[] = [];
  let next = id;
  for (let i = 0; next && i < 20; i++) {
    const c = data.collections.find((c) => c.id === next);
    if (!c) break;
    parts.unshift(c.name);
    next = c.parentId;
  }
  return parts.join(" / ") || "Unfiled";
}
