import { ArrowUpRight, Search, Settings2 } from "lucide-react";
import { useState } from "react";
import type { AppData } from "../types";
import { ServiceIcon } from "../../components/ServiceIcon";
import { statusFor } from "../../lib/format";

export function ServiceLauncher({ data, onManage }: { data: AppData; onManage: () => void }) {
  const [query, setQuery] = useState("");
  const resources = data.resources.filter(r => r.purpose !== "bookmark");
  const matches = resources.filter(r => `${r.name} ${r.description ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const groups = [...data.groups, { id: "ungrouped", name: "Other services" }];
  return <main className="view-shell service-launcher">
    <header className="hp-card-title"><div><span className="hp-eyebrow">Your homelab</span><h2>Services</h2></div><button className="icon-text-button" onClick={onManage}><Settings2 size={16} /> Manage services</button></header>
    {resources.length > 0 && <div className="launcher-toolbar"><label><Search size={17} aria-hidden="true" /><input aria-label="Find a service" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a service…" /></label><span>{resources.length} services · Links open in a new tab</span></div>}
    {groups.map(group => {
      const items = matches.filter(r => (r.groupId ?? "ungrouped") === group.id);
      if (!items.length) return null;
      return <section className="launcher-group" key={group.id}>{group.id !== "ungrouped" && <h3>{group.name}</h3>}<div className="launcher-grid">
        {items.map(r => <article key={r.id} className="launcher-service">
          {r.url ? <a className="launcher-open" href={r.url} target="_blank" rel="noopener noreferrer"><ServiceIcon resource={r} size={34} /><span><strong>{r.name}</strong><small>{r.description || r.kind}</small></span><ArrowUpRight size={15} aria-hidden="true" /></a> : <div className="launcher-open"><ServiceIcon resource={r} size={34} /><span><strong>{r.name}</strong><small>{r.description || r.kind}</small></span></div>}
          <span className={`svc-dot dot-${statusFor(r)}`} role="img" aria-label={`${r.name}: ${statusFor(r)}`} />
        </article>)}
      </div></section>;
    })}
    {resources.length > 0 && !matches.length && <div className="launcher-empty"><h3>No matching services</h3><p>Try another name or clear your search.</p><button className="icon-text-button" onClick={() => setQuery("")}>Clear search</button></div>}
    {!resources.length && <section className="hp-card"><h3>Your services, one click away</h3><p>Add your first service to get started.</p><button className="primary-button" onClick={onManage}>Add a service</button></section>}
  </main>;
}
