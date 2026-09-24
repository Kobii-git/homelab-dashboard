import { useState } from "react";
import { apiSend } from "../../lib/api";
import { download, fileBase64 } from "./useHomepage";
type Preview = {
  token: string;
  revision: number;
  counts: Record<string, number>;
  requiredEnvironment: string[];
  warnings: string[];
};
export function DataBackups({
  onRestored,
}: {
  onRestored: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [exportToken, setExportToken] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function exportConfig() {
    setBusy(true);
    setError("");
    try {
      const result = await apiSend<{
        archive: string;
        filename: string;
        exportToken: string;
      }>("/api/config/export", "POST");
      const bytes = Uint8Array.from(atob(result.archive), (c) =>
        c.charCodeAt(0),
      );
      download(result.filename, bytes, "application/zip");
      setExportToken(result.exportToken);
      setNotice(
        "Download started. Confirm that the file was saved before restoring.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="table-panel hp-backups" aria-label="Data and backups">
      <h3>Data &amp; backups</h3>
      <p>
        Export your workspaces, bookmarks, notes, prompts, layouts, backgrounds,
        and service configuration. The archive contains private content. Store
        it somewhere safe.
      </p>
      <p className="muted-copy">
        Passwords, secret values, server security settings, monitoring history,
        and browser-local drafts/timers are excluded. Use the operator
        database-backup procedure for full disaster recovery.
      </p>
      <div className="hp-actions">
        <button disabled={busy} onClick={() => void exportConfig()}>
          Export configuration
        </button>
        <label className="hp-file">
          Preview configuration restore
          <input
            disabled={busy}
            type="file"
            accept=".zip,application/zip"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError("");
              setPreview(null);
              setConfirmed(false);
              try {
                if (file.size > 32 * 1024 * 1024 + 64_000)
                  throw new Error("Archive exceeds 32 MiB");
                setPreview(
                  await apiSend("/api/config/import/preview", "POST", {
                    archive: await fileBase64(file),
                  }),
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "Preview failed");
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </div>
      <p role="status">{busy ? "Working…" : notice}</p>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <div className="hp-restore-preview">
          <h4>Review replacement</h4>
          <dl>
            {Object.entries(preview.counts).map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <ul>
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {preview.requiredEnvironment.length > 0 && (
            <p>
              Required environment variable names:{" "}
              {preview.requiredEnvironment.join(", ")}. Values are never
              imported.
            </p>
          )}
          <p>
            Export the current configuration, verify the download, then confirm
            replacement. Monitoring history for replaced definitions will be
            removed.
          </p>
          <label className="hp-check">
            <input
              type="checkbox"
              disabled={!exportToken || busy}
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I saved the current configuration archive and want to replace the
            portable configuration.
          </label>
          <div className="hp-actions">
            <button disabled={busy} onClick={() => void exportConfig()}>
              Download current configuration first
            </button>
            <button
              className="danger-button"
              disabled={busy || !exportToken || !confirmed}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await apiSend("/api/config/import/apply", "POST", {
                    token: preview.token,
                    exportToken,
                    downloaded: true,
                  });
                  setPreview(null);
                  setExportToken(null);
                  setConfirmed(false);
                  setNotice(
                    "Configuration restored. Review and re-enable monitoring and credential bindings in Settings.",
                  );
                  window.dispatchEvent(new Event("homepage:changed"));
                  await onRestored();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Restore failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Replace configuration
            </button>
            <button disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
