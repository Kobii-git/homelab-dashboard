import { PageHeader } from "../../components/Primitives";
import { Notes } from "./Notes";
import { useHomepage } from "./useHomepage";
import { useHomepageWorkspace } from "./useHomepageWorkspace";

export function NotesPage() {
  const home = useHomepage();
  const [workspace, setWorkspace] = useHomepageWorkspace();
  return <main className="view-shell notes-page">
    <PageHeader title="Your notes" subtitle="A thought now. Easy to find later." />
    <div className="segmented-control notes-workspace" role="group" aria-label="Notes workspace">
      {(["home", "work"] as const).map(id => <button key={id} aria-pressed={workspace === id} className={workspace === id ? "active" : ""} onClick={() => setWorkspace(id)}>{id === "home" ? "Home" : "Work"}</button>)}
    </div>
    {home.error && <div className="hp-notice" role="alert">{home.error} <button onClick={() => void home.refresh()}>Reload saved data</button></div>}
    {home.snapshot ? <Notes key={workspace} home={home} workspace={workspace} /> : <p role="status">Loading your notes…</p>}
  </main>;
}
