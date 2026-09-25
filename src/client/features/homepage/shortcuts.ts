import type { HomeLayout, HomepageSnapshot, WorkspaceId } from "../../../shared/homepage";

export function workspaceShortcuts(snapshot: HomepageSnapshot, workspace: WorkspaceId, selection: HomeLayout["centerShortcuts"], surface: "center" | "sidebar") {
  // Older homepages selected individual links. Keep that saved selection intact,
  // but show top-level folders in the new folder bar instead of loose link tiles.
  const folderSelection = surface === "center" && selection?.bookmarkIds.length && !selection.collectionIds.length ? null : selection;
  const folders = snapshot.data.collections.filter(c => surface === "center" && c.workspaceId === workspace &&
    (folderSelection ? folderSelection.collectionIds.includes(c.id) : c.parentId === null))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const links = snapshot.bookmarks.filter(b => surface === "sidebar" && b.workspaceId === workspace && !b.deletedAt &&
    (selection ? selection.bookmarkIds.includes(b.id) : b.collectionId === null))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return { folders, links };
}
