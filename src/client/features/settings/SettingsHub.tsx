import { type ReactNode } from "react";
import { PageHeader } from "../../components/Primitives";
import { BookmarkManager } from "../homepage/BookmarkManager";
import { DataBackups } from "../homepage/DataBackups";
import { HomepagePreferences } from "../homepage/HomepagePreferences";
import { useHomepage } from "../homepage/useHomepage";
import { useHomepageWorkspace } from "../homepage/useHomepageWorkspace";

export type SettingsSection = "homepage" | "bookmarks" | "services" | "integrations" | "backups";
const sections: { id: SettingsSection; label: string }[] = [
  { id: "homepage", label: "Appearance & widgets" }, { id: "bookmarks", label: "Bookmarks & folders" },
  { id: "services", label: "Services & checks" }, { id: "integrations", label: "Integrations & system" },
  { id: "backups", label: "Data & backups" },
];
export function SettingsHub({ section, onSection, services, system, onRestored }: {
  section: SettingsSection; onSection: (section: SettingsSection) => void;
  services: ReactNode; system: ReactNode; onRestored: () => Promise<void>;
}) {
  const home = useHomepage();
  const [workspace, setWorkspace] = useHomepageWorkspace();
  return <main className="view-shell settings-hub">
    <PageHeader title="Settings" subtitle="A space that works the way you do." />
    <div className="settings-layout">
    <nav className="settings-sections" aria-label="Settings sections">
      {sections.map(item => <button key={item.id} className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => onSection(item.id)}>{item.label}</button>)}
    </nav>
    <div className="settings-content">
    {(section === "homepage" || section === "bookmarks") && <>
      <div className="segmented-control settings-workspace" role="group" aria-label="Workspace settings">
        {(["home", "work"] as const).map(id => <button key={id} aria-pressed={workspace === id} className={workspace === id ? "active" : ""} onClick={() => setWorkspace(id)}>{id === "home" ? "Home" : "Work"}</button>)}
      </div>
      {home.error && <div className="hp-notice" role="alert">{home.error} <button onClick={() => void home.refresh()}>Reload saved data</button></div>}
      {section === "homepage" ? <HomepagePreferences key={workspace} home={home} workspace={workspace} /> : home.snapshot ? <BookmarkManager key={workspace} home={home} workspace={workspace} manage /> : <p role="status">Loading bookmarks…</p>}
    </>}
    {section === "services" && services}
    {section === "integrations" && system}
    {section === "backups" && <DataBackups onRestored={onRestored} />}
    </div>
    </div>
  </main>;
}
