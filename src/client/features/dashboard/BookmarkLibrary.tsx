import { Bookmark, Pencil, Plus, Search, Star } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { DashboardResource } from "../../../shared/types";
import { ServiceIcon } from "../../components/ServiceIcon";
import { apiSend } from "../../lib/api";
import { bookmarkHostname, isBookmark } from "../../lib/bookmarks";
import { runFormSubmit } from "../../lib/forms";

export function BookmarkLibrary({ resources, groups, onRefresh, onEdit, onFavorite }: {
  resources: DashboardResource[];
  groups: { id: string; name: string }[];
  onRefresh: () => Promise<void>;
  onEdit: (resource: DashboardResource) => void;
  onFavorite: (resource: DashboardResource) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const wasAdding = useRef(false);
  useEffect(() => {
    if (!adding && wasAdding.current) addButton.current?.focus();
    wasAdding.current = adding;
  }, [adding]);
  const bookmarks = resources.filter(isBookmark);
  const visible = bookmarks.filter((item) =>
    (collection === "all" || (item.groupId ?? "ungrouped") === collection) &&
    [item.name, item.url, item.description].join(" ").toLowerCase().includes(query.trim().toLowerCase())
  );
  const collections = groups.filter((group) => bookmarks.some((item) => item.groupId === group.id));

  function closeForm() {
    setAdding(false);
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    const success = await runFormSubmit(event, async (form) => {
      const url = new URL(String(form.get("url")).trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("Use an HTTP or HTTPS website address without a username or password.");
      }
      await apiSend("/api/resources", "POST", {
        name: String(form.get("name")).trim(), url: url.href,
        kind: "website", monitoringMode: "disabled", favorite: form.get("favorite") === "on",
        groupId: form.get("groupId") || null
      });
    }, setError, setSaving, "Bookmark saved");
    if (success) {
      closeForm();
      setCollection("all");
      setQuery("");
      try { await onRefresh(); }
      catch { setError("Bookmark saved. Refresh the page to see it."); }
    }
  }

  return (
    <section className="bookmark-library" aria-labelledby="bookmarks-heading">
      <div className="launchpad-section-heading">
        <h3 id="bookmarks-heading"><Bookmark size={17} /> Bookmarks <span className="bookmark-count">{bookmarks.length}</span></h3>
        <button ref={addButton} type="button" className="icon-text-button" aria-expanded={adding} aria-controls={adding ? "bookmark-form" : undefined} disabled={saving} onClick={() => adding ? closeForm() : setAdding(true)}><Plus size={16} /> Add bookmark</button>
      </div>
      {adding ? (
        <form id="bookmark-form" className="bookmark-form" aria-label="New bookmark" onSubmit={save} onKeyDown={(event) => { if (event.key === "Escape" && !saving) closeForm(); }}>
          <label>Name<input autoFocus name="name" required maxLength={160} placeholder="A site you love" /></label>
          <label>Website address<input name="url" type="url" maxLength={500} required placeholder="https://example.com" /></label>
          <label>Collection<select name="groupId" defaultValue={collection === "all" || collection === "ungrouped" ? "" : collection}><option value="">Unsorted</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label className="checkbox-row"><input name="favorite" type="checkbox" defaultChecked /> Pin to favorites</label>
          <div className="form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save bookmark"}</button><button className="icon-text-button" type="button" onClick={closeForm} disabled={saving}>Cancel</button></div>
        </form>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {bookmarks.length > 0 ? <>
        <div className="bookmark-toolbar">
          <div className="bookmark-collections" role="group" aria-label="Bookmark collections">
            {[{ id: "all", name: "All bookmarks" }, ...collections, ...(bookmarks.some((item) => !item.groupId) ? [{ id: "ungrouped", name: "Unsorted" }] : [])].map((group) => <button key={group.id} type="button" className={collection === group.id ? "active" : ""} aria-pressed={collection === group.id} onClick={() => setCollection(group.id)}>{group.name}</button>)}
          </div>
          <label className="search-box bookmark-filter"><Search size={16} /><input aria-label="Filter bookmarks" placeholder="Find a bookmark…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        </div>
        <div className="bookmark-grid">
          {visible.map((resource) => <article className="bookmark-card" key={resource.id}>
            <a href={resource.url!} target="_blank" rel="noopener noreferrer"><ServiceIcon resource={resource} size={32} /><span><strong>{resource.name}</strong><small>{bookmarkHostname(resource.url!)}</small></span></a>
            <div className="bookmark-actions">
              <button type="button" className="icon-button" aria-label={`${resource.favorite ? "Unpin" : "Pin"} ${resource.name}`} aria-pressed={resource.favorite} onClick={() => { void onFavorite(resource).catch(() => setError("Could not update favorite. Please try again.")); }}><Star size={14} fill={resource.favorite ? "currentColor" : "none"} /></button>
              <button type="button" className="icon-button" aria-label={`Edit bookmark ${resource.name}`} onClick={() => onEdit(resource)}><Pencil size={14} /></button>
            </div>
          </article>)}
        </div>
        {visible.length === 0 ? <p className="home-empty" role="status">No matching bookmarks. Try another collection or search.</p> : null}
      </> : <div className="bookmark-empty"><Bookmark size={24} /><div><strong>Make yourself at home</strong><p>Save your daily reads, work tools, and favorite corners of the web here.</p></div></div>}
    </section>
  );
}
