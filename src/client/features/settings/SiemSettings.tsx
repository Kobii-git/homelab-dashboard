import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiSend } from "../../lib/api";

type Destination = { enabled: boolean; host: string; port: number; transport: "tcp" | "tls" };
type Config = { wazuh: Destination & { transport: "tcp" }; sentinel: Destination };
type Delivery = { sent: number; failed: number; dropped: number; lastSentAt: string | null; lastFailureAt: string | null };
type Status = { config: Config; delivery: { wazuh: Delivery; sentinel: Delivery }; queued: number };
type Name = keyof Config;

export function SiemSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void apiGet<Status>("/api/siem").then(value => { setStatus(value); setDraft(value.config); })
      .catch(error => setMessage(error instanceof Error ? error.message : "Could not load SIEM settings"));
  }, []);

  function update(name: Name, patch: Partial<Destination>) {
    setDraft(current => current ? { ...current, [name]: { ...current[name], ...patch } } as Config : current);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setMessage("");
    try {
      const value = await apiSend<Status>("/api/siem", "PATCH", draft);
      setStatus(value); setDraft(value.config); setMessage("SIEM destinations saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save SIEM settings"); }
    finally { setBusy(false); }
  }

  async function test(name: Name) {
    setBusy(true); setMessage("");
    try {
      await apiSend("/api/siem/test", "POST", { destination: name });
      setMessage(`Test event sent to ${name === "wazuh" ? "Wazuh" : "Sentinel"}. Check the receiver for ingestion.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Test delivery failed"); }
    finally {
      try { setStatus(await apiGet<Status>("/api/siem")); } catch { /* Keep the delivery message. */ }
      setBusy(false);
    }
  }

  async function refreshStatus() {
    setBusy(true); setMessage("");
    try { setStatus(await apiGet<Status>("/api/siem")); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not refresh delivery status"); }
    finally { setBusy(false); }
  }

  if (!draft || !status) return <p role="status">{message || "Loading SIEM settings…"}</p>;
  const changed = JSON.stringify(draft) !== JSON.stringify(status.config);
  return <>
    <h3>Authentication events</h3>
    <p className="muted-copy">Forward successful and failed sign-ins, password confirmations, sign-outs, and password changes. Events include time, result, and client IP, with no password or session data. Delivery is best effort; use a trusted LAN or VPN for plain TCP syslog.</p>
    <form className="inline-form" onSubmit={save}>
      {(["wazuh", "sentinel"] as const).map(name => <fieldset key={name} className="siem-destination">
        <legend>{name === "wazuh" ? "Wazuh manager" : "Microsoft Sentinel syslog forwarder"}</legend>
        <label className="checkbox-row"><input type="checkbox" checked={draft[name].enabled} onChange={event => update(name, { enabled: event.target.checked })} /> Enable forwarding</label>
        <div className="settings-form-grid">
          <label>Receiver hostname or IP<input value={draft[name].host} onChange={event => update(name, { host: event.target.value })} required={draft[name].enabled} placeholder="siem.example.lan" autoComplete="off" /></label>
          <label>Port<input type="number" min="1" max="65535" value={draft[name].port} onChange={event => update(name, { port: Number(event.target.value) })} required /></label>
          {name === "sentinel" ? <label>Transport<select value={draft.sentinel.transport} onChange={event => update("sentinel", { transport: event.target.value as "tcp" | "tls" })}><option value="tcp">TCP</option><option value="tls">TLS</option></select></label> : null}
        </div>
        <p className="muted-copy">{name === "wazuh" ? "Configure the manager’s TCP syslog listener and allow this app’s source IP." : "Configure Syslog via AMA and a Linux syslog forwarder. Collect local0 informational and higher severity events."}</p>
        <p className="muted-copy">Sent {status.delivery[name].sent} · failed {status.delivery[name].failed} · dropped {status.delivery[name].dropped}{status.delivery[name].lastFailureAt ? ` · last failure ${new Date(status.delivery[name].lastFailureAt).toLocaleString()}` : ""}</p>
        <button type="button" className="icon-text-button" disabled={busy || changed || !status.config[name].enabled} onClick={() => void test(name)}>Send test event</button>
      </fieldset>)}
      <button type="submit" className="primary-button" disabled={busy || !changed}>Save destinations</button>
    </form>
    <button type="button" className="icon-text-button" disabled={busy} onClick={() => void refreshStatus()}>Refresh delivery status</button>
    {message ? <p role="status">{message}</p> : null}
  </>;
}
