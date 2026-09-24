import { Settings2 } from "lucide-react";
import type { AppData } from "../types";
import { ServiceIcon } from "../../components/ServiceIcon";
import { statusFor } from "../../lib/format";

export function ServiceLauncher({ data, onManage }: { data: AppData; onManage: () => void }) {
  const resources = data.resources.filter(r => r.purpose !== "bookmark");
  const groups = [...data.groups, { id: "ungrouped", name: "Other services" }];
  return <main className="view-shell service-launcher">
    <header className="hp-card-title"><div><span className="hp-eyebrow">Your homelab</span><h2>Services</h2></div><button className="icon-text-button" onClick={onManage}><Settings2 size={16} /> Manage services</button></header>
    {groups.map(group => {
      const items = resources.filter(r => (r.groupId ?? "ungrouped") === group.id);
      if (!items.length) return null;
      return <section className="launcher-group" key={group.id}><h3>{group.name}</h3><div className="launcher-grid">
        {items.map(r => <article key={r.id} className="launcher-service">
          <ServiceIcon resource={r} size={38} />
          <div>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a> : <strong>{r.name}</strong>}<p>{r.description || r.kind}</p></div>
          <span className={`svc-dot dot-${statusFor(r)}`} role="img" aria-label={`${r.name}: ${statusFor(r)}`} />
        </article>)}
      </div></section>;
    })}
    {!resources.length && <section className="hp-card"><h3>Your services, one click away</h3><p>Add your first service to get started.</p><button className="primary-button" onClick={onManage}>Add a service</button></section>}
  </main>;
}
