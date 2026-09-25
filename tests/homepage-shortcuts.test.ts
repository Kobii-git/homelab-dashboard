import { describe, expect, it } from "vitest";
import { defaultHomepage, type HomepageBookmark, type HomepageSnapshot } from "../src/shared/homepage";
import { workspaceShortcuts } from "../src/client/features/homepage/shortcuts";

function fixture(): HomepageSnapshot {
  const bookmark = (id: string, extra: Partial<HomepageBookmark> = {}): HomepageBookmark => ({
    id, name: id, url: "https://example.com/", notes: "", favorite: false, workspaceId: "home", collectionId: null,
    readingState: "none", sortOrder: 0, deletedAt: null, updatedAt: "2026-01-01T00:00:00Z", ...extra,
  });
  const data = defaultHomepage();
  data.collections = [
    { id: "folder", name: "Folder", parentId: null, workspaceId: "home", sortOrder: 0 },
    { id: "nested", name: "Nested", parentId: "folder", workspaceId: "home", sortOrder: 1 },
    { id: "work", name: "Work", parentId: null, workspaceId: "work", sortOrder: 0 },
  ];
  return { revision: 1, assets: [], data, bookmarks: [
    bookmark("root"), bookmark("favorite", { favorite: true, collectionId: "folder" }),
    bookmark("trashed", { favorite: true, deletedAt: "2026-01-01T00:00:00Z" }), bookmark("work", { workspaceId: "work", favorite: true }),
  ] };
}

describe("independent bookmark shortcuts", () => {
  it("uses top-level folder dropdowns centrally and keeps sidebar links for older layouts", () => {
    const state = fixture();
    const center = workspaceShortcuts(state, "home", null, "center");
    const sidebar = workspaceShortcuts(state, "home", null, "sidebar");
    expect(center.links).toEqual([]);
    expect(center.folders.map(c => c.id)).toEqual(["folder"]);
    expect(sidebar.links.map(b => b.id)).toEqual(["root"]);
    expect(sidebar.folders.map(c => c.id)).toEqual(["folder"]);
  });
  it("allows nested shortcuts while omitting missing, trashed and other-workspace choices", () => {
    const state = fixture();
    const selection = { bookmarkIds: ["root", "work", "trashed", "missing"], collectionIds: ["nested", "work", "missing"] };
    const selected = workspaceShortcuts(state, "home", selection, "center");
    expect(selected.links).toEqual([]);
    expect(selected.folders.map(c => c.id)).toEqual(["nested"]);
    expect(workspaceShortcuts(state, "home", { bookmarkIds: [], collectionIds: [] }, "sidebar")).toEqual({ links: [], folders: [] });
  });
  it("shows folders for old link-only selections without mutating saved data, and honors an explicitly empty bar", () => {
    const state = fixture();
    const selection = { bookmarkIds: ["favorite"], collectionIds: [] };
    const original = structuredClone(selection);
    expect(workspaceShortcuts(state, "home", selection, "center").folders.map(c => c.id)).toEqual(["folder"]);
    expect(selection).toEqual(original);
    expect(workspaceShortcuts(state, "home", { bookmarkIds: [], collectionIds: [] }, "center")).toEqual({ links: [], folders: [] });
    expect(workspaceShortcuts(state, "work", null, "center").folders.map(c => c.id)).toEqual(["work"]);
  });
});
