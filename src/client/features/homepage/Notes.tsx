import { useEffect, useRef, useState } from "react";
import { Plus, StickyNote } from "lucide-react";
import type { HomepageData, WorkspaceId } from "../../../shared/homepage";
import { ModalSurface } from "../../components/ModalSurface";
import { newHomepageId, type HomepageController } from "./useHomepage";

type Draft = { id: string; title: string; text: string; data: HomepageData; revision: number };

export function Notes({ home, workspace }: { home: HomepageController; workspace: WorkspaceId }) {
  const [scratch, setScratch] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [notice, setNotice] = useState("");
  const newNoteButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!editing && notice === "Note deleted") newNoteButton.current?.focus();
  }, [editing, notice]);
  const snapshot = home.snapshot!;
  const state = snapshot.data.workspaces[workspace];
  const notes = [
    ...(state.notes ? [{ id: "legacy-scratchpad", title: "Scratchpad", text: state.notes }] : []),
    ...state.savedNotes,
  ];
  function draft(note = { id: newHomepageId(), title: "", text: "" }): Draft {
    return { ...note, data: structuredClone(snapshot.data), revision: snapshot.revision };
  }
  async function save(value: Draft, remove = false) {
    try {
      const current = value.data.workspaces[workspace];
      const savedNotes = current.savedNotes.filter(n => n.id !== value.id);
      if (!remove) savedNotes.unshift({ id: value.id, title: value.title.trim() || value.text.trim().split("\n")[0].slice(0, 160), text: value.text });
      await home.saveData({ ...value.data, workspaces: { ...value.data.workspaces, [workspace]: {
        ...current, savedNotes, notes: value.id === "legacy-scratchpad" ? "" : current.notes,
      } } }, value.revision);
      if (editing) setEditing(null); else setScratch(null);
      setNotice(remove ? "Note deleted" : "Saved to your notes");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Could not save note"); }
  }
  function recover(value: Draft): Draft {
    return { ...value, data: structuredClone(snapshot.data), revision: snapshot.revision };
  }
  return <section className="hp-card hp-notes" aria-label="Notes">
    <div className="hp-card-title"><h3><StickyNote size={18} /> Notes <small>{notes.length}</small></h3>
      <button ref={newNoteButton} onClick={() => { setNotice(""); setEditing(draft()); }}><Plus size={15} /> New note</button>
    </div>
    <div className="hp-note-list">
      {notes.map((note, i) => <button key={note.id} className={`hp-note note-color-${i % 4}`} onClick={() => { setNotice(""); setEditing(draft(note)); }}>
        <strong>{note.title}</strong><span>{note.text}</span>
      </button>)}
    </div>
    {!notes.length && <p className="muted-copy">Ideas, reminders, little things to keep. Save one below.</p>}
    <label className="hp-scratch-label" htmlFor={`scratch-${workspace}`}>Scratchpad</label>
    <textarea id={`scratch-${workspace}`} aria-label="Workspace notes" rows={3} maxLength={50_000} placeholder="Capture a thought…" value={scratch?.text ?? ""}
      onChange={e => { setScratch({ ...(scratch ?? draft()), text: e.target.value }); setNotice("Unsaved draft"); }} />
    <div className="hp-actions">
      <button disabled={!scratch?.text.trim() || home.busy} onClick={() => scratch && void save(scratch)}>Save notes</button>
      {scratch && <button disabled={home.busy} onClick={() => { setScratch(null); setNotice(""); }}>Discard draft</button>}
      {scratch && scratch.revision !== snapshot.revision && <button disabled={home.busy} onClick={() => setScratch(recover(scratch))}>Keep draft against latest version</button>}
    </div>
    <p role="status">{notice}</p>
    {editing && <ModalSurface ariaLabel="Edit note" backdropClassName="modal-backdrop" className="hp-modal" onClose={() => { if (!home.busy) setEditing(null); }}>
      <h2>{notes.some(n => n.id === editing.id) ? "Edit note" : "New note"}</h2>
      <form onSubmit={e => { e.preventDefault(); void save(editing); }}>
        <label>Note title<input maxLength={160} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Give it a name" /></label>
        <label>Note text<textarea required rows={12} maxLength={50_000} value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} /></label>
        <p role="status">{notice}</p>
        <div className="hp-actions">
          <button className="primary-button" disabled={home.busy || !editing.text.trim()}>Save note</button>
          <button type="button" disabled={home.busy} onClick={() => setEditing(null)}>Close</button>
          {notes.some(n => n.id === editing.id) && <button type="button" disabled={home.busy} onClick={() => { if (window.confirm("Delete this note?")) void save(editing, true); }}>Delete note</button>}
          {editing.revision !== snapshot.revision && <button type="button" disabled={home.busy} onClick={() => setEditing(recover(editing))}>Keep draft against latest version</button>}
        </div>
      </form>
    </ModalSurface>}
  </section>;
}
