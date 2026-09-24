import type { HomeLayout, HomepageSnapshot, WorkspaceId } from "../../../shared/homepage";

export function workspaceShortcuts(snapshot: HomepageSnapshot, workspace: WorkspaceId, selection: HomeLayout["centerShortcuts"], surface: "center" | "sidebar") {
  const folders = snapshot.data.collections.filter(c => c.workspaceId === workspace &&
    (selection ? selection.collectionIds.includes(c.id) : surface === "sidebar" && c.parentId === null))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const links = snapshot.bookmarks.filter(b => b.workspaceId === workspace && !b.deletedAt &&
    (selection ? selection.bookmarkIds.includes(b.id) : surface === "center" ? b.favorite : b.collectionId === null))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return { folders, links };
}
