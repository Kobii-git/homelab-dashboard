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
  it("uses favorites centrally and top-level items in the sidebar for older layouts", () => {
    const state = fixture();
    const center = workspaceShortcuts(state, "home", null, "center");
    const sidebar = workspaceShortcuts(state, "home", null, "sidebar");
    expect(center.links.map(b => b.id)).toEqual(["favorite"]);
    expect(center.folders).toEqual([]);
    expect(sidebar.links.map(b => b.id)).toEqual(["root"]);
    expect(sidebar.folders.map(c => c.id)).toEqual(["folder"]);
  });
  it("allows nested shortcuts while omitting missing, trashed and other-workspace choices", () => {
    const state = fixture();
    const selection = { bookmarkIds: ["root", "work", "trashed", "missing"], collectionIds: ["nested", "work", "missing"] };
    const selected = workspaceShortcuts(state, "home", selection, "center");
    expect(selected.links.map(b => b.id)).toEqual(["root"]);
    expect(selected.folders.map(c => c.id)).toEqual(["nested"]);
    expect(workspaceShortcuts(state, "home", { bookmarkIds: [], collectionIds: [] }, "sidebar")).toEqual({ links: [], folders: [] });
  });
});
