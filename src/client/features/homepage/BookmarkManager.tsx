import { SiteIcon } from "../../components/SiteIcon";
import { BookmarkTree } from "./BookmarkTree";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Bookmark, Pencil, Plus, Star, Settings2, X } from "lucide-react";
import {
  collectionLabel,
  type BookmarkInput,
  type HomepageBookmark,
  type HomepageSnapshot,
  type WorkspaceId,
} from "../../../shared/homepage";
import { apiGet, apiSend } from "../../lib/api";
import { ModalSurface } from "../../components/ModalSurface";
import { bookmarkHostname } from "../../lib/bookmarks";
import { download, newHomepageId, type HomepageController } from "./useHomepage";

export function CopyPreview({
  text,
  onClose,
  title = "Copy selected items",
  description = "Review this text before copying. Nothing is sent to ChatGPT.",
  copiedMessage = "Copied. Paste into ChatGPT when you are ready.",
}: {
  text: string;
  onClose: () => void;
  title?: string;
  description?: string;
  copiedMessage?: string;
}) {
  const [notice, setNotice] = useState("");
  return (
    <ModalSurface
      ariaLabel={title}
      backdropClassName="modal-backdrop"
      className="hp-modal"
      onClose={onClose}
    >
      <h2>{title}</h2>
      <p>{description}</p>
      <label>
        Text to copy
        <textarea
          readOnly
          rows={12}
          value={text}
          onFocus={(e) => e.target.select()}
        />
      </label>
      <p role="status">{notice}</p>
      <div className="hp-actions">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setNotice(copiedMessage);
            } catch {
              setNotice(
                "Clipboard unavailable. Select the text above and copy it manually.",
              );
            }
          }}
        >
          Copy text
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalSurface>
  );
}
export function BookmarkManager({
  home,
  workspace,
  manage = false,
  onManage,
  onClose,
}: {
  home: HomepageController;
  workspace: WorkspaceId;
  manage?: boolean;
  onManage?: () => void;
  onClose?: () => void;
}) {
  const { snapshot, busy } = home;
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("all");
  const [trash, setTrash] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{
    bookmark: BookmarkInput;
    id?: string;
    revision: number;
  } | null>(null);
  const [copy, setCopy] = useState<string | null>(null);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    token: string;
    additions: number;
    duplicates: number;
    collections: string[];
    sample: { name: string; url: string }[];
  } | null>(null);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState("home:");
  const addRef = useRef<HTMLButtonElement>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const visible = useMemo(
    () =>
      snapshot?.bookmarks.filter(
        (b) =>
          b.workspaceId === workspace &&
          Boolean(b.deletedAt) === trash &&
          (collection === "all" ||
            (b.collectionId ?? "unfiled") === collection) &&
          [b.name, b.url, b.notes]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase().trim()),
      ) ?? [],
    [snapshot, workspace, trash, collection, query],
  );
  if (!snapshot) return null;
  const data = snapshot.data;
  const collections = data.collections
    .filter((c) => c.workspaceId === workspace)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const run = async (work: () => Promise<unknown>) => {
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete the action",
      );
    }
  };
  const bulk = (action: string, ids = selected, extra = {}) =>
    home.mutate("/api/homepage/bookmarks/bulk", {
      revision: snapshot.revision,
      ids,
      action,
      ...extra,
    });
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    await run(async () => {
      await home.mutate("/api/homepage/bookmarks", editing);
      setEditing(null);
      addRef.current?.focus();
    });
  }
  function move(id: string, delta: number) {
    const ids = visible.map((b) => b.id);
    const index = ids.indexOf(id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => bulk("reorder", ids));
  }
  async function exportBookmarks(format: "html" | "json") {
    await run(async () => {
      const result = await apiGet<{ filename: string; content: string }>(
        `/api/homepage/bookmarks/export?workspaceId=${workspace}&format=${format}`,
      );
      download(
        result.filename,
        result.content,
        format === "html" ? "text/html" : "application/json",
      );
    });
  }
  const shown = visible.slice(page * 60, (page + 1) * 60);
  return (
    <section className="hp-card hp-bookmarks" aria-label="Bookmarks">
      <div className="hp-card-title">
        <h3>
          <Bookmark size={18} /> Bookmarks <small>{visible.length}</small>
        </h3>
        <div className="hp-actions">
        {!manage && <button aria-label="Manage bookmarks" title="Manage bookmarks" onClick={onManage}><Settings2 size={16} /></button>}
        <button
          ref={addRef}
          type="button"
          onClick={(event) => {
            event.currentTarget.focus();
            setEditing({
              revision: snapshot.revision,
              bookmark: {
                name: "",
                url: "",
                notes: "",
                favorite: true,
                workspaceId: workspace,
                collectionId:
                  collection !== "all" && collection !== "unfiled"
                    ? collection
                    : null,
                readingState: "none",
              },
            });
          }}
        >
          <Plus size={16} /> Add bookmark
        </button>
        {onClose && <button type="button" aria-label="Close bookmarks" title="Close bookmarks" onClick={onClose}><X size={16} /></button>}
        </div>
      </div>
      {manage ? <>
      <div className="hp-actions">
        <label className="hp-grow">
          Filter bookmarks
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Find a saved site…"
          />
        </label>
        <label>
          Collection
          <select
            aria-label="Collection"
            value={collection}
            onChange={(e) => {
              setCollection(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All collections</option>
            <option value="unfiled">Unfiled</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {collectionLabel(data, c.id)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setCollectionsOpen(true)}>
          Manage collections
        </button>
        <button
          type="button"
          aria-pressed={trash}
          onClick={() => {
            setTrash(!trash);
            setSelected([]);
            setPage(0);
          }}
        >
          {trash ? "Back to bookmarks" : "Trash"}
        </button>
      </div>
      <details className="hp-transfer"><summary>Import &amp; export</summary><div className="hp-actions hp-subtle">
        <button type="button" onClick={() => void exportBookmarks("html")}>
          Export HTML
        </button>
        <button type="button" onClick={() => void exportBookmarks("json")}>
          Export JSON
        </button>
        <label className="hp-file">
          Import browser HTML
          <input
            type="file"
            accept=".html,.htm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void run(async () => {
                if (file.size > 5 * 1024 * 1024)
                  throw new Error("File exceeds 5 MiB");
                setImportPreview(
                  await apiSend(
                    "/api/homepage/bookmarks/import/preview",
                    "POST",
                    {
                      html: await file.text(),
                      workspaceId: workspace,
                      revision: snapshot.revision,
                    },
                  ),
                );
              });
            }}
          />
        </label>
        {undoToken && (
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                await home.mutate("/api/homepage/bookmarks/import/undo", {
                  token: undoToken,
                });
                setUndoToken(null);
              })
            }
          >
            Undo last import
          </button>
        )}
      </div>
      </details>
      {error && <p role="alert">{error}</p>}
      {selected.length > 0 && (
        <div className="hp-bulk">
          <strong>{selected.length} selected</strong>
          <button
            disabled={busy}
            type="button"
            onClick={() =>
              void run(async () => {
                await bulk(trash ? "restore" : "trash");
                setSelected([]);
              })
            }
          >
            {trash ? "Restore" : "Move to trash"}
          </button>
          {trash ? (
            <button
              disabled={busy}
              type="button"
              onClick={() => {
                if (
                  window.confirm("Permanently delete the selected bookmarks?")
                )
                  void run(async () => {
                    await bulk("delete");
                    setSelected([]);
                  });
              }}
            >
              Delete permanently
            </button>
          ) : (
            <>
              <label>
                Move to
                <select
                  value={moveTarget}
                  onChange={(e) => setMoveTarget(e.target.value)}
                >
                  {(["home", "work"] as const).map((w) => (
                    <optgroup key={w} label={w === "home" ? "Home" : "Work"}>
                      <option value={`${w}:`}>Unfiled</option>
                      {data.collections
                        .filter((c) => c.workspaceId === w)
                        .map((c) => (
                          <option key={c.id} value={`${w}:${c.id}`}>
                            {collectionLabel(data, c.id)}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <button
                disabled={busy}
                type="button"
                onClick={() =>
                  void run(async () => {
                    const [workspaceId, collectionId] = moveTarget.split(":");
                    await bulk("move", selected, {
                      workspaceId,
                      collectionId: collectionId || null,
                    });
                    setSelected([]);
                  })
                }
              >
                Move selected
              </button>
              <button
                type="button"
                onClick={() =>
                  setCopy(
                    snapshot.bookmarks
                      .filter((b) => selected.includes(b.id))
                      .map(
                        (b) =>
                          `${b.name}\n${b.url}${b.notes ? `\n${b.notes}` : ""}`,
                      )
                      .join("\n\n"),
                  )
                }
              >
                Copy selected items
              </button>
            </>
          )}
          <button type="button" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
      )}
      {shown.length > 0 && <label className="hp-check">
        <input
          type="checkbox"
          checked={
            shown.length > 0 && shown.every((b) => selected.includes(b.id))
          }
          onChange={(e) =>
            setSelected(
              e.target.checked
                ? [...new Set([...selected, ...shown.map((b) => b.id)])]
                : selected.filter((id) => !shown.some((b) => b.id === id)),
            )
          }
        />{" "}
        Select this page
      </label>}
      <div className="hp-link-list">
        {shown.map((b: HomepageBookmark) => (
          <div
            key={b.id}
            className="hp-link-row"
            draggable={!trash}
            onDragStart={() => setDragged(b.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragged || dragged === b.id) return;
              const ids = visible
                .map((x) => x.id)
                .filter((id) => id !== dragged);
              ids.splice(ids.indexOf(b.id), 0, dragged);
              setDragged(null);
              void run(() => bulk("reorder", ids));
            }}
          >
            <input
              aria-label={`Select ${b.name}`}
              type="checkbox"
              checked={selected.includes(b.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, b.id]
                    : selected.filter((id) => id !== b.id),
                )
              }
            />
            <a href={b.url} target="_blank" rel="noopener noreferrer">
              <SiteIcon name={b.name} url={b.url} size={28} />
              <span>
                <strong>{b.name}</strong>
                <small>
                  {bookmarkHostname(b.url)}
                  {b.readingState !== "none" ? ` · ${b.readingState}` : ""}
                </small>
              </span>
            </a>
            <button
              disabled={busy}
              aria-label={`${b.favorite ? "Unpin" : "Pin"} ${b.name}`}
              aria-pressed={b.favorite}
              type="button"
              onClick={() =>
                void run(() =>
                  bulk("favorite", [b.id], { favorite: !b.favorite }),
                )
              }
            >
              <Star size={16} fill={b.favorite ? "currentColor" : "none"} />
            </button>
            <button
              aria-label={`Edit bookmark ${b.name}`}
              type="button"
              onClick={() =>
                setEditing({
                  id: b.id,
                  revision: snapshot.revision,
                  bookmark: {
                    name: b.name,
                    url: b.url,
                    notes: b.notes,
                    favorite: b.favorite,
                    workspaceId: b.workspaceId,
                    collectionId: b.collectionId,
                    readingState: b.readingState,
                  },
                })
              }
            >
              <Pencil size={16} />
            </button>
            <button
              disabled={busy || visible[0]?.id === b.id}
              aria-label={`Move ${b.name} up`}
              type="button"
              onClick={() => move(b.id, -1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              disabled={busy || visible.at(-1)?.id === b.id}
              aria-label={`Move ${b.name} down`}
              type="button"
              onClick={() => move(b.id, 1)}
            >
              <ArrowDown size={15} />
            </button>
          </div>
        ))}
      </div>
      {!visible.length && (
        <p role="status">
          {query
            ? "No matching bookmarks."
            : trash
              ? "Trash is empty."
              : "Save a favorite site or import your browser bookmarks."}
        </p>
      )}
      {visible.length > 60 && (
        <div className="hp-actions">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page + 1} of {Math.ceil(visible.length / 60)}
          </span>
          <button
            disabled={(page + 1) * 60 >= visible.length}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
      </> : <BookmarkTree snapshot={snapshot} workspace={workspace} onEdit={(b) => setEditing({
        id: b.id, revision: snapshot.revision, bookmark: {
          name: b.name, url: b.url, notes: b.notes, favorite: b.favorite,
          workspaceId: b.workspaceId, collectionId: b.collectionId, readingState: b.readingState,
        },
      })} />}
      {editing && (
        <ModalSurface
          ariaLabel={editing.id ? "Edit bookmark" : "New bookmark"}
          backdropClassName="modal-backdrop"
          className="hp-modal"
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <h2>{editing.id ? "Edit bookmark" : "New bookmark"}</h2>
          <form
            aria-label={editing.id ? "Edit bookmark" : "New bookmark"}
            onSubmit={save}
          >
            <label>
              Name
              <input
                required
                maxLength={160}
                value={editing.bookmark.name}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    bookmark: { ...editing.bookmark, name: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Website address
              <input
                required
                type="url"
                maxLength={2000}
                value={editing.bookmark.url}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    bookmark: { ...editing.bookmark, url: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Workspace
              <select
                value={editing.bookmark.workspaceId}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    bookmark: {
                      ...editing.bookmark,
                      workspaceId: e.target.value as WorkspaceId,
                      collectionId: null,
                    },
                  })
                }
              >
                <option value="home">Home</option>
                <option value="work">Work</option>
              </select>
            </label>
            <label>
              Collection
              <select
                value={editing.bookmark.collectionId ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    bookmark: {
                      ...editing.bookmark,
                      collectionId: e.target.value || null,
                    },
                  })
                }
              >
                <option value="">Unfiled</option>
                {data.collections
                  .filter((c) => c.workspaceId === editing.bookmark.workspaceId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {collectionLabel(data, c.id)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Notes
              <textarea
                maxLength={20_000}
                value={editing.bookmark.notes}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    bookmark: { ...editing.bookmark, notes: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Reading state
              <select
                value={editing.bookmark.readingState}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    bookmark: {
                      ...editing.bookmark,
                      readingState: e.target
                        .value as BookmarkInput["readingState"],
                    },
                  })
                }
              >
                {["none", "unread", "reading", "done"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="hp-check">
              <input
                type="checkbox"
                checked={editing.bookmark.favorite}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    bookmark: {
                      ...editing.bookmark,
                      favorite: e.target.checked,
                    },
                  })
                }
              />{" "}
              Favorite
            </label>
            {(error || home.error) && <p role="alert">{error || home.error}</p>}
            <div className="hp-actions">
              <button className="primary-button" disabled={busy}>
                Save bookmark
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await home.refresh();
                  })
                }
              >
                Refresh saved data
              </button>
              {snapshot.revision !== editing.revision && (
                <button
                  type="button"
                  onClick={() =>
                    setEditing({ ...editing, revision: snapshot.revision })
                  }
                >
                  Keep draft against latest version
                </button>
              )}
            </div>
          </form>
        </ModalSurface>
      )}
      {collectionsOpen && (
        <CollectionEditor
          home={home}
          workspace={workspace}
          onClose={() => setCollectionsOpen(false)}
        />
      )}
      {copy !== null && (
        <CopyPreview text={copy} onClose={() => setCopy(null)} />
      )}
      {importPreview && (
        <ModalSurface
          ariaLabel="Import bookmarks"
          backdropClassName="modal-backdrop"
          className="hp-modal"
          onClose={() => setImportPreview(null)}
        >
          <h2>Import bookmarks</h2>
          <p>
            {importPreview.additions} new links · {importPreview.duplicates}{" "}
            duplicates skipped
          </p>
          <p>{importPreview.collections.length} folder paths</p>
          <ul>
            {importPreview.sample.map((b, i) => (
              <li key={i}>
                {b.name} — {b.url}
              </li>
            ))}
          </ul>
          <p role="alert">{error}</p>
          <div className="hp-actions">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = (await home.mutate(
                    "/api/homepage/bookmarks/import/apply",
                    { token: importPreview.token },
                  )) as HomepageSnapshot & { undoToken: string };
                  setUndoToken(result.undoToken);
                  setImportPreview(null);
                })
              }
            >
              Import {importPreview.additions} bookmarks
            </button>
            <button onClick={() => setImportPreview(null)}>Cancel</button>
          </div>
        </ModalSurface>
      )}
    </section>
  );
}
function CollectionEditor({
  home,
  workspace,
  onClose,
}: {
  home: HomepageController;
  workspace: WorkspaceId;
  onClose: () => void;
}) {
  const [base, setBase] = useState(home.snapshot!);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const data = structuredClone(base.data);
      const c = {
        id: id ?? newHomepageId(),
        workspaceId: workspace,
        name,
        parentId: parentId || null,
        sortOrder: data.collections.length,
      };
      if (id)
        data.collections = data.collections.map((item) =>
          item.id === id ? { ...c, sortOrder: item.sortOrder } : item,
        );
      else data.collections.push(c);
      const next = await home.saveData(data, base.revision);
      setBase(next);
      setName("");
      setParentId("");
      setId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }
  return (
    <ModalSurface
      ariaLabel="Manage collections"
      backdropClassName="modal-backdrop"
      className="hp-modal"
      onClose={onClose}
    >
      <h2>Manage collections</h2>
      <ul>
        {base.data.collections
          .filter((c) => c.workspaceId === workspace)
          .map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  setId(c.id);
                  setName(c.name);
                  setParentId(c.parentId ?? "");
                }}
              >
                {collectionLabel(base.data, c.id)}
              </button>
              <button
                onClick={async () => {
                  try {
                    const next = await home.saveData(
                      {
                        ...base.data,
                        collections: base.data.collections.filter(
                          (x) => x.id !== c.id,
                        ),
                      },
                      base.revision,
                    );
                    setBase(next);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Move bookmarks and child collections out before deleting.",
                    );
                  }
                }}
              >
                Delete
              </button>
            </li>
          ))}
      </ul>
      <form onSubmit={save}>
        <label>
          Collection name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Parent collection
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">Top level</option>
            {base.data.collections
              .filter((c) => c.workspaceId === workspace && c.id !== id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {collectionLabel(base.data, c.id)}
                </option>
              ))}
          </select>
        </label>
        <p role="alert">{error}</p>
        <div className="hp-actions">
          <button disabled={home.busy}>
            {id ? "Save collection" : "Add collection"}
          </button>
          <button
            type="button"
            onClick={() => {
              setId(null);
              setName("");
              setParentId("");
            }}
          >
            New collection
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </ModalSurface>
  );
}
