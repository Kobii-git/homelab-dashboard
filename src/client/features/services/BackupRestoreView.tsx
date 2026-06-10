import { AlertTriangle, Download, FileUp, RefreshCw, Shield, Upload } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import type { ImportPreview, ImportResult } from "../../../shared/backup";
import { EmptyPanel, MetricCard } from "../../components/Primitives";
import { apiGet, apiSend } from "../../lib/api";
import { FormErrorBanner, runFormAction } from "../../lib/forms";
import { pushToast } from "../../lib/toast";

type ImportMode = "merge" | "replace";

function countSummary(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

export function BackupRestoreView({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [payload, setPayload] = useState<unknown | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [password, setPassword] = useState("");
  const [confirmReplace, setConfirmReplace] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function exportBackup() {
    setExporting(true);
    try {
      const backup = await apiGet<Record<string, unknown>>("/api/export");
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `homelab-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      pushToast("Backup exported — store this file securely");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Export failed", "error");
    } finally {
      setExporting(false);
    }
  }

  async function loadFile(file: File) {
    setResult(null);
    setActionError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      setPayload(parsed);
      const nextPreview = await apiSend<ImportPreview>("/api/import/preview", "POST", { payload: parsed });
      setPreview(nextPreview);
    } catch (error) {
      setPayload(null);
      setPreview(null);
      setActionError(error instanceof Error ? error.message : "Could not read backup file");
    }
  }

  async function importBackup(event: FormEvent) {
    event.preventDefault();
    if (!payload) return;

    await runFormAction(async () => {
      const response = await apiSend<ImportResult>("/api/import", "POST", {
        password,
        mode,
        payload,
        ...(mode === "replace" ? { confirmReplace: confirmReplace as "REPLACE" } : {})
      });
      setResult(response);
      setPassword("");
      setConfirmReplace("");
      await onRefresh();
    }, setActionError, setSubmitting, mode === "replace" ? "Services restored from backup" : "Backup merged");
  }

  return (
    <section className="backup-restore-view">
      <div className="backup-security-banner">
        <Shield size={18} />
        <div>
          <strong>Treat backup files like secrets.</strong>
          <p>
            Backups include encrypted alert webhook and SMTP configs. Store offline, encrypt at rest, and use the same
            <code>HOMELAB_VAULT_KEY</code> when restoring on another instance.
          </p>
        </div>
      </div>

      <div className="backup-grid">
        <section className="backup-panel">
          <h3><Download size={16} /> Export</h3>
          <p>Download a JSON snapshot of groups, resources, checks, alerts, maintenance windows, notes, tags, and widgets.</p>
          <ul className="backup-list">
            <li>Includes encrypted alert config blobs, not plaintext webhook URLs or SMTP settings</li>
            <li>Does not include incidents, check results, alert deliveries, or audit logs</li>
            <li>Safe to schedule regularly for disaster recovery</li>
          </ul>
          <button className="primary-button" type="button" disabled={exporting} onClick={() => void exportBackup()}>
            {exporting ? <RefreshCw className="spin" size={15} /> : <Download size={15} />}
            Download backup
          </button>
        </section>

        <section className="backup-panel">
          <h3><Upload size={16} /> Import</h3>
          <p>Restore from a backup file. Preview validates structure before anything is written.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = "";
            }}
          />
          <button className="icon-text-button" type="button" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={15} />
            Choose backup file
          </button>
          {fileName ? <p className="backup-file-name">Selected: {fileName}</p> : null}
        </section>
      </div>

      <FormErrorBanner message={actionError} />

      {preview ? (
        <section className="backup-preview">
          <div className="section-heading">
            <h3>Preview</h3>
            <span className={preview.valid ? "backup-valid" : "backup-invalid"}>
              {preview.valid ? "Valid backup" : "Invalid backup"}
            </span>
          </div>
          {preview.exportedAt ? <p className="muted-copy">Exported {new Date(preview.exportedAt).toLocaleString()} · format {preview.version}</p> : null}
          {preview.warnings.length > 0 ? (
            <div className="backup-warning-box">
              {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          ) : null}
          {preview.errors.length > 0 ? (
            <div className="backup-error-box">
              {preview.errors.map((error) => <p key={error}>{error}</p>)}
            </div>
          ) : null}
          <div className="backup-preview-metrics">
            {Object.entries(preview.counts).map(([key, value]) => (
              <MetricCard key={key} icon={<Shield size={16} />} label={key} value={value} />
            ))}
          </div>
        </section>
      ) : null}

      {preview?.valid ? (
        <form className="backup-import-form" onSubmit={importBackup}>
          <label>
            Import mode
            <select value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}>
              <option value="merge">Merge — add items that do not already exist</option>
              <option value="replace">Replace - wipe services/config and restore from backup</option>
            </select>
          </label>
          {mode === "replace" ? (
            <div className="backup-replace-warning">
              <AlertTriangle size={16} />
              <span>Replace deletes all resources, checks, alerts, maintenance windows, notes, tags, groups, widgets, and related runtime history before importing.</span>
            </div>
          ) : null}
          <label>
            Confirm with your password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
          </label>
          {mode === "replace" ? (
            <label>
              Type REPLACE to confirm
              <input value={confirmReplace} onChange={(event) => setConfirmReplace(event.target.value)} placeholder="REPLACE" required />
            </label>
          ) : null}
          <button className="primary-button" type="submit" disabled={submitting || (mode === "replace" && confirmReplace !== "REPLACE")}>
            {submitting ? <RefreshCw className="spin" size={15} /> : <Upload size={15} />}
            {mode === "replace" ? "Restore backup" : "Merge backup"}
          </button>
        </form>
      ) : null}

      {result?.applied ? (
        <section className="backup-result">
          <h3>Import complete</h3>
          <p>
            {result.mode === "replace"
              ? `Restored ${countSummary(result.created)} items from backup.`
              : `Created ${countSummary(result.created)} items, skipped ${countSummary(result.skipped)} existing items.`}
          </p>
        </section>
      ) : null}

      {!preview && !result ? (
        <EmptyPanel
          icon={<Shield size={36} />}
          title="No backup loaded"
          body="Export a backup to secure your config, or choose a JSON backup file to preview and import."
        />
      ) : null}
    </section>
  );
}
