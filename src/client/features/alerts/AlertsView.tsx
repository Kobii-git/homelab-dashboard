import { Bell, Mail, Play, Plus, RadioTower, RefreshCw, Webhook } from "lucide-react";
import { FormEvent } from "react";
import { MetricCard } from "../../components/Primitives";
import { apiSend, emptyToNull } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { V2Data } from "../types";

export function AlertsView({ data, onRefresh }: { data: V2Data; onRefresh: () => Promise<void> }) {
  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const type = String(form.get("type"));
    const config =
      type === "webhook"
        ? {
            url: emptyToNull(form.get("url")),
            method: "POST"
          }
        : {
            smtpHost: emptyToNull(form.get("smtpHost")),
            smtpPort: Number(form.get("smtpPort") || 587),
            from: emptyToNull(form.get("from")),
            to: emptyToNull(form.get("to"))
          };

    await apiSend("/api/alert-channels", "POST", {
      name: emptyToNull(form.get("name")),
      type,
      config,
      enabled: true
    });
    formElement.reset();
    await onRefresh();
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await apiSend("/api/alert-rules", "POST", {
      name: emptyToNull(form.get("name")),
      channelId: form.get("channelId"),
      event: form.get("event"),
      cooldownSeconds: Number(form.get("cooldownSeconds") || 900),
      enabled: true
    });
    formElement.reset();
    await onRefresh();
  }

  async function testChannel(id: string) {
    await apiSend(`/api/alert-channels/${id}/test`, "POST");
    await onRefresh();
  }

  return (
    <main className="view-shell">
      <header className="view-header">
        <div>
          <h2>Alerts</h2>
          <span>{data.alertChannels.length} channels · {data.alertRules.length} rules</span>
        </div>
        <button className="icon-text-button" type="button" onClick={onRefresh}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>

      <section className="dashboard-overview">
        <MetricCard icon={<Webhook size={18} />} label="Channels" value={data.alertChannels.length} tone="accent" />
        <MetricCard icon={<Bell size={18} />} label="Rules" value={data.alertRules.length} />
        <MetricCard icon={<RadioTower size={18} />} label="Deliveries" value={data.alertDeliveries.length} />
        <MetricCard
          icon={<Mail size={18} />}
          label="Failed"
          value={data.alertDeliveries.filter((delivery) => delivery.status === "failed").length}
          tone="offline"
        />
      </section>

      <section className="split-grid">
        <form className="tool-panel" onSubmit={createChannel}>
          <h3>Channel</h3>
          <label>
            Name
            <input name="name" />
          </label>
          <label>
            Type
            <select name="type" defaultValue="webhook">
              <option value="webhook">Webhook</option>
              <option value="email">Email</option>
            </select>
          </label>
          <label>
            Webhook URL
            <input name="url" placeholder="https://hooks.example" />
          </label>
          <label>
            SMTP host
            <input name="smtpHost" placeholder="smtp.example.com" />
          </label>
          <label>
            SMTP port
            <input name="smtpPort" type="number" placeholder="587" />
          </label>
          <label>
            From
            <input name="from" />
          </label>
          <label>
            To
            <input name="to" />
          </label>
          <button className="primary-button" type="submit">
            <Plus size={16} />
            Add channel
          </button>
        </form>

        <form className="tool-panel" onSubmit={createRule}>
          <h3>Rule</h3>
          <label>
            Name
            <input name="name" />
          </label>
          <label>
            Channel
            <select name="channelId">
              <option value="">Select</option>
              {data.alertChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Event
            <select name="event" defaultValue="incident.opened">
              <option value="incident.opened">Incident opened</option>
              <option value="incident.acknowledged">Incident acknowledged</option>
              <option value="incident.resolved">Incident resolved</option>
            </select>
          </label>
          <label>
            Cooldown seconds
            <input name="cooldownSeconds" type="number" placeholder="900" />
          </label>
          <button className="primary-button" type="submit">
            <Plus size={16} />
            Add rule
          </button>
        </form>

        <section className="table-panel">
          <h3>Channels</h3>
          <div className="row-list">
            {data.alertChannels.map((channel) => (
              <div className="data-row data-row-wide" key={channel.id}>
                <span>
                  <strong>{channel.name}</strong>
                  <small>{channel.type} · {channel.enabled ? "enabled" : "disabled"}</small>
                </span>
                <button className="icon-button" type="button" title="Test" onClick={() => testChannel(channel.id)}>
                  <Play size={15} />
                </button>
              </div>
            ))}
            {data.alertChannels.length === 0 ? <p className="muted-copy">No alert channels.</p> : null}
          </div>
        </section>
      </section>

      <section className="split-grid">
        <section className="table-panel">
          <h3>Rules</h3>
          <div className="row-list">
            {data.alertRules.map((rule) => (
              <div className="data-row" key={rule.id}>
                <span>
                  <strong>{rule.name}</strong>
                  <small>{rule.event} · cooldown {rule.cooldownSeconds}s</small>
                </span>
              </div>
            ))}
            {data.alertRules.length === 0 ? <p className="muted-copy">No alert rules.</p> : null}
          </div>
        </section>
        <section className="table-panel">
          <h3>Deliveries</h3>
          <div className="row-list">
            {data.alertDeliveries.map((delivery) => (
              <div className="data-row" key={delivery.id}>
                <span>
                  <strong>{delivery.event}</strong>
                  <small>{delivery.status} · {formatDateTime(delivery.createdAt)}</small>
                </span>
              </div>
            ))}
            {data.alertDeliveries.length === 0 ? <p className="muted-copy">No deliveries yet.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
