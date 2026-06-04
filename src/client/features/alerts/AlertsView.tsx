import { Bell, Mail, Play, Plus, RadioTower, RefreshCw, RotateCcw, Trash2, Webhook, Zap } from "lucide-react";
import { FormEvent, useState } from "react";
import { MetricCard, PageHeader } from "../../components/Primitives";
import type { AlertChannelDto, AlertDeliveryDto, AlertRuleDto } from "../../lib/api";
import { apiSend, emptyToNull } from "../../lib/api";
import { FormErrorBanner, runFormAction } from "../../lib/forms";
import { formatDateTime } from "../../lib/format";
import type { V2Data } from "../types";

export function AlertsView({ data, onRefresh }: { data: V2Data; onRefresh: () => Promise<void> }) {
  const [channelType, setChannelType] = useState("webhook");
  const [webhookPreset, setWebhookPreset] = useState("custom");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const webhookPresets: Record<string, string> = {
    custom: "",
    discord: "https://discord.com/api/webhooks/…",
    slack: "https://hooks.slack.com/services/…",
    ntfy: "https://ntfy.sh/your-topic"
  };

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const type = String(form.get("type"));
      const config =
        type === "webhook"
          ? { url: emptyToNull(form.get("url")), method: "POST" }
          : {
              smtpHost: emptyToNull(form.get("smtpHost")),
              smtpPort: Number(form.get("smtpPort") || 587),
              from: emptyToNull(form.get("from")),
              to: emptyToNull(form.get("to"))
            };
      await apiSend("/api/alert-channels", "POST", { name: emptyToNull(form.get("name")), type, config, enabled: true });
      formElement.reset();
      setChannelType("webhook");
      await onRefresh();
    }, setActionError, setSubmitting, "Alert channel added");
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
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
    }, setActionError, setSubmitting, "Alert rule added");
  }

  async function toggleChannel(channel: AlertChannelDto) {
    await apiSend(`/api/alert-channels/${channel.id}`, "PATCH", { enabled: !channel.enabled });
    await onRefresh();
  }

  async function deleteChannel(channel: AlertChannelDto) {
    if (!window.confirm(`Delete channel "${channel.name}"? Associated rules will also be removed.`)) return;
    await apiSend(`/api/alert-channels/${channel.id}`, "DELETE");
    await onRefresh();
  }

  async function testChannel(channel: AlertChannelDto) {
    await apiSend(`/api/alert-channels/${channel.id}/test`, "POST");
    await onRefresh();
  }

  async function toggleRule(rule: AlertRuleDto) {
    await apiSend(`/api/alert-rules/${rule.id}`, "PATCH", { enabled: !rule.enabled });
    await onRefresh();
  }

  async function deleteRule(rule: AlertRuleDto) {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    await apiSend(`/api/alert-rules/${rule.id}`, "DELETE");
    await onRefresh();
  }

  async function retryDelivery(delivery: AlertDeliveryDto) {
    await apiSend(`/api/alert-deliveries/${delivery.id}/retry`, "POST");
    await onRefresh();
  }

  const failedCount = data.alertDeliveries.filter((d) => d.status === "failed").length;

  return (
    <main className="view-shell">
      <PageHeader
        title="Alerts"
        subtitle={`${data.alertChannels.length} channels · ${data.alertRules.length} rules · ${failedCount} failed`}
        actions={
          <button className="icon-text-button" type="button" onClick={onRefresh}>
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />

      <FormErrorBanner message={actionError} />

      <section className="dashboard-overview">
        <MetricCard icon={<Webhook size={18} />} label="Channels" value={data.alertChannels.length} tone="accent" />
        <MetricCard icon={<Bell size={18} />} label="Rules" value={data.alertRules.length} />
        <MetricCard icon={<RadioTower size={18} />} label="Deliveries" value={data.alertDeliveries.length} />
        <MetricCard icon={<Mail size={18} />} label="Failed" value={failedCount} tone={failedCount ? "offline" : "neutral"} />
      </section>

      <section className="split-grid">
        <form className="tool-panel tool-panel-dense" onSubmit={createChannel}>
          <h3>New channel</h3>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Type
            <select name="type" value={channelType} onChange={(e) => setChannelType(e.target.value)}>
              <option value="webhook">Webhook</option>
              <option value="email">Email (SMTP)</option>
            </select>
          </label>
          {channelType === "webhook" ? (
            <>
              <label>
                Preset
                <select
                  value={webhookPreset}
                  onChange={(event) => {
                    const preset = event.target.value;
                    setWebhookPreset(preset);
                    if (preset !== "custom") {
                      setWebhookUrl(webhookPresets[preset] ?? "");
                    }
                  }}
                >
                  <option value="custom">Custom URL</option>
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                  <option value="ntfy">ntfy</option>
                </select>
              </label>
              <label>
                Webhook URL
                <input name="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://hooks.example.com/…" />
              </label>
            </>
          ) : (
            <>
              <label>SMTP host<input name="smtpHost" placeholder="smtp.example.com" /></label>
              <label>SMTP port<input name="smtpPort" type="number" placeholder="587" /></label>
              <label>From<input name="from" placeholder="alerts@example.com" /></label>
              <label>To<input name="to" placeholder="you@example.com" /></label>
            </>
          )}
          <button className="primary-button" type="submit" disabled={submitting}>
            <Plus size={16} />
            Add channel
          </button>
        </form>

        <form className="tool-panel tool-panel-dense" onSubmit={createRule}>
          <h3>New rule</h3>
          <label>Name<input name="name" required /></label>
          <label>
            Channel
            <select name="channelId" required>
              <option value="">Select channel</option>
              {data.alertChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
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
          <label>Cooldown (seconds)<input name="cooldownSeconds" type="number" placeholder="900" /></label>
          <button className="primary-button" type="submit" disabled={submitting}>
            <Plus size={16} />
            Add rule
          </button>
        </form>

        <section className="table-panel">
          <h3>Channels</h3>
          <div className="row-list">
            {data.alertChannels.map((channel) => (
              <div className="data-row incident-row" key={channel.id}>
                <span>
                  <strong>{channel.name}</strong>
                  <small>{channel.type} · {channel.enabled ? "enabled" : "disabled"}</small>
                </span>
                <button
                  className={`icon-button ${channel.enabled ? "is-active" : ""}`}
                  type="button"
                  title={channel.enabled ? "Disable" : "Enable"}
                  onClick={() => toggleChannel(channel)}
                >
                  <Zap size={14} />
                </button>
                <button className="icon-button" type="button" title="Test" onClick={() => testChannel(channel)}>
                  <Play size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => deleteChannel(channel)}>
                  <Trash2 size={14} />
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
              <div className="data-row incident-row" key={rule.id}>
                <span>
                  <strong>{rule.name}</strong>
                  <small>{rule.event} · cooldown {rule.cooldownSeconds}s · {rule.enabled ? "on" : "off"}</small>
                </span>
                <button
                  className={`icon-button ${rule.enabled ? "is-active" : ""}`}
                  type="button"
                  title={rule.enabled ? "Disable" : "Enable"}
                  onClick={() => toggleRule(rule)}
                >
                  <Zap size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => deleteRule(rule)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {data.alertRules.length === 0 ? <p className="muted-copy">No alert rules.</p> : null}
          </div>
        </section>

        <section className="table-panel">
          <h3>Deliveries</h3>
          <div className="row-list">
            {data.alertDeliveries.map((delivery) => (
              <div className="data-row data-row-wide" key={delivery.id}>
                <span>
                  <strong>{delivery.event}</strong>
                  <small>
                    <span className={delivery.status === "failed" ? "strip-danger" : ""}>{delivery.status}</span>
                    {" · "}{formatDateTime(delivery.createdAt)}
                  </small>
                </span>
                {delivery.status === "failed" ? (
                  <button className="icon-button" type="button" title="Retry" onClick={() => retryDelivery(delivery)}>
                    <RotateCcw size={14} />
                  </button>
                ) : null}
              </div>
            ))}
            {data.alertDeliveries.length === 0 ? <p className="muted-copy">No deliveries yet.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
