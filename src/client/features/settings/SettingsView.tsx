import { Download, ExternalLink, Gauge, RefreshCw, Save, User } from "lucide-react";
import { FormEvent, useState } from "react";
import { PageHeader } from "../../components/Primitives";
import { FormErrorBanner, runFormAction } from "../../lib/forms";
import { apiSend } from "../../lib/api";

export function SettingsView({
  username,
  authSource,
  onRefresh,
  onOpenBackup
}: {
  username: string;
  authSource: "env" | "database";
  onRefresh: () => Promise<void>;
  onOpenBackup: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setActionError("New passwords do not match");
      return;
    }
    await runFormAction(async () => {
      await apiSend("/api/auth/password", "POST", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }, setActionError, setSubmitting, "Password updated");
  }

  return (
    <main className="view-shell">
      <PageHeader title="Settings" subtitle="Account, data, and system tools" />

      <FormErrorBanner message={actionError} />

      <section className="settings-grid">
        <section className="table-panel">
          <h3><User size={16} /> Account</h3>
          <div className="key-value-grid">
            <span><span>Username</span><strong>{username}</strong></span>
            <span><span>Auth</span><strong>{authSource === "env" ? "Server env (ADMIN_PASSWORD)" : "Database"}</strong></span>
          </div>
          {authSource === "database" ? (
            <form className="inline-form settings-form-grid" onSubmit={changePassword}>
              <label>Current password<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
              <label>New password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} /></label>
              <label>Confirm new password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} /></label>
              <button className="primary-button" type="submit" disabled={submitting}><Save size={15} /> Update password</button>
            </form>
          ) : (
            <p className="muted-copy">Password is set via <code>ADMIN_PASSWORD</code> in docker-compose. Change it there and restart the container.</p>
          )}
          <p className="muted-copy">Multi-user accounts are not supported yet — one admin account per instance.</p>
        </section>

        <section className="table-panel">
          <h3><Gauge size={16} /> Data &amp; system</h3>
          <div className="settings-actions">
            <button className="icon-text-button" type="button" onClick={() => void onRefresh()}>
              <RefreshCw size={16} /> Sync all data
            </button>
            <button className="icon-text-button" type="button" onClick={onOpenBackup}>
              <Download size={16} /> Backup &amp; restore
            </button>
            <button
              className="icon-text-button"
              type="button"
              onClick={() => window.open("/status", "_blank", "noopener,noreferrer")}
            >
              <ExternalLink size={16} /> Public status page
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
