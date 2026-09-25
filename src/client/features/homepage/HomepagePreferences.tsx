import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { defaultLayout, type HomeLayout, type HomepageData, type HomepageSnapshot, type WorkspaceId } from "../../../shared/homepage";
import { apiSend } from "../../lib/api";
import { fileBase64, type HomepageController } from "./useHomepage";
import { widgetTitles as titles } from "./widgetTitles";
import { balancedLayout } from "./balancedLayout";
import { ShortcutPicker } from "./ShortcutPicker";
import { BackgroundPicker } from "./BackgroundPicker";
import { backgroundImage } from "./backgrounds";
export function HomepagePreferences({ home, workspace }: { home: HomepageController; workspace: WorkspaceId }) {
  const [customize, setCustomize] = useState<{ data: HomepageData; revision: number } | null>(null);
  const [customError, setCustomError] = useState("");
  const snapshot = home.snapshot;
  if (!snapshot) return <p role="status">{home.error || "Loading preferences…"}</p>;
  const layout = customize?.data.workspaces[workspace].layout ?? snapshot.data.workspaces[workspace].layout;
  function updateLayout(next: HomeLayout) {
    if (customize)
      setCustomize({
        ...customize,
        data: {
          ...customize.data,
          workspaces: {
            ...customize.data.workspaces,
            [workspace]: {
              ...customize.data.workspaces[workspace],
              layout: next,
            },
          },
        },
      });
  }
  async function saveLayout() {
    if (!customize) return;
    try {
      await home.saveData(customize.data, customize.revision);
      setCustomize(null);
      setCustomError("");
    } catch (e) {
      setCustomError(e instanceof Error ? e.message : "Could not save layout");
    }
  }
  return <div style={{ backgroundImage: backgroundImage(layout.background) }} className={`homepage-preferences hp-accent-${layout.accent} hp-bg-${layout.background.split(":")[0]}`}>
    {!customize && <section className="hp-card"><h3>Make this space yours</h3><p className="muted-copy">Choose your colors, background, and the widgets you want in this workspace.</p><button className="primary-button" onClick={() => { setCustomError(""); setCustomize({ data: structuredClone(snapshot.data), revision: snapshot.revision }); }}>Customize {workspace}</button></section>}
      {customize && (
        <section
          className="hp-card hp-customize"
          aria-label="Customize homepage"
        >
          <h3>Make it yours</h3>
          <p>Choose what appears in this workspace. Your changes apply when you save.</p>
          <p className="muted-copy">Choose your shortcuts and keep each section open or tucked into a dropdown.</p>
          <div className="hp-actions">
            <label>
              Accent
              <select
                aria-label="Accent"
                value={layout.accent}
                onChange={(e) =>
                  updateLayout({
                    ...layout,
                    accent: e.target.value as HomeLayout["accent"],
                  })
                }
              >
                {["blue", "green", "violet", "amber"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Clock
              <select
                aria-label="Clock"
                value={layout.clock}
                onChange={(e) =>
                  updateLayout({
                    ...layout,
                    clock: e.target.value as HomeLayout["clock"],
                  })
                }
              >
                <option value="digital">Digital</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
            <label>Spacing<select aria-label="Spacing" value={layout.spacing} onChange={e => updateLayout({ ...layout, spacing: e.target.value as HomeLayout["spacing"] })}>
              <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
            </select></label>
          </div>
          <BackgroundPicker value={layout.background} assets={snapshot.assets} onChange={background => updateLayout({ ...layout, background })} />
          <label className="hp-file">
            Upload PNG background (up to 4 MiB / 4 megapixels)
            <input
              type="file"
              accept="image/png"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  if (file.size > 4 * 1024 * 1024)
                    throw new Error("Choose a PNG under 4 MiB");
                  const result = await apiSend<{
                    id: string;
                    snapshot: HomepageSnapshot;
                  }>("/api/homepage/assets", "POST", {
                    revision: customize.revision,
                    body: await fileBase64(file),
                  });
                  home.setSnapshot(result.snapshot);
                  setCustomize({
                    ...customize,
                    revision: result.snapshot.revision,
                    data: {
                      ...customize.data,
                      workspaces: {
                        ...customize.data.workspaces,
                        [workspace]: {
                          ...customize.data.workspaces[workspace],
                          layout: {
                            ...layout,
                            background: `asset:${result.id}`,
                          },
                        },
                      },
                    },
                  });
                } catch (e) {
                  setCustomError(
                    e instanceof Error ? e.message : "Upload failed",
                  );
                }
              }}
            />
          </label>
          <ShortcutPicker snapshot={snapshot} workspace={workspace} layout={layout} onChange={updateLayout} />
          <div className="hp-card-title"><h3>Arrange your widgets</h3><button type="button" onClick={() => updateLayout(balancedLayout(layout))}>Balanced arrangement</button></div>
          <p className="muted-copy">Balanced arrangement previews new order and widths while preserving enabled widgets and other preferences. Save layout applies the preview.</p>
          <div className="hp-widget-options">
            {layout.widgets.map((w, i) => (
              <div key={w.id}>
                <label className="hp-check">
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    onChange={(e) =>
                      updateLayout({
                        ...layout,
                        widgets: layout.widgets.map((x) =>
                          x.id === w.id
                            ? { ...x, enabled: e.target.checked }
                            : x,
                        ),
                      })
                    }
                  />
                  {titles[w.id]}
                </label>
                {w.id !== "bookmarks" && <>
                <select
                  className="hp-presentation"
                  aria-label={`${titles[w.id]} display`}
                  value={w.presentation}
                  onChange={e => updateLayout({ ...layout, widgets: layout.widgets.map(x => x.id === w.id ? { ...x, presentation: e.target.value as "section" | "dropdown" } : x) })}
                >
                  <option value="section">Always open</option>
                  <option value="dropdown">Dropdown</option>
                </select>
                <select
                  aria-label={`${titles[w.id]} width`}
                  value={w.size}
                  onChange={(e) =>
                    updateLayout({
                      ...layout,
                      widgets: layout.widgets.map((x) =>
                        x.id === w.id
                          ? { ...x, size: e.target.value as "normal" | "wide" }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="wide">Wide</option>
                </select>
                {[-1, 1].map((delta) => (
                  <button
                    key={delta}
                    aria-label={`Move ${titles[w.id]} ${delta < 0 ? "up" : "down"}`}
                    disabled={
                      i + delta < 0 || i + delta >= layout.widgets.length
                    }
                    onClick={() => {
                      const widgets = [...layout.widgets];
                      [widgets[i], widgets[i + delta]] = [
                        widgets[i + delta],
                        widgets[i],
                      ];
                      updateLayout({ ...layout, widgets });
                    }}
                  >
                    {delta < 0 ? (
                      <ArrowUp size={14} />
                    ) : (
                      <ArrowDown size={14} />
                    )}
                  </button>
                ))}</>}
              </div>
            ))}
          </div>
          {snapshot.assets.length > 0 && (
            <details>
              <summary>Remove unused backgrounds</summary>
              {snapshot.assets.map((a, i) => (
                <button
                  key={a.id}
                  disabled={
                    Object.values(snapshot.data.workspaces).some(
                      (w) => w.layout.background === `asset:${a.id}`,
                    ) || layout.background === `asset:${a.id}`
                  }
                  onClick={async () => {
                    try {
                      const next = await home.mutate(
                        `/api/homepage/assets/${a.id}/delete`,
                        { revision: customize.revision },
                      );
                      setCustomize({ ...customize, revision: next.revision });
                    } catch (e) {
                      setCustomError(
                        e instanceof Error ? e.message : "Could not delete",
                      );
                    }
                  }}
                >
                  Remove background {i + 1}
                </button>
              ))}
            </details>
          )}
          <p role="alert">{customError}</p>
          <div className="hp-actions">
            <button
              disabled={home.busy}
              className="primary-button"
              onClick={() => void saveLayout()}
            >
              Save layout
            </button>
            <button onClick={() => setCustomize(null)}>Cancel preview</button>
            <button
              onClick={() => updateLayout(defaultLayout(workspace === "work"))}
            >
              Reset preview
            </button>
            {snapshot.revision !== customize.revision && (
              <button
                onClick={() =>
                  setCustomize({
                    data: {
                      ...snapshot.data,
                      workspaces: {
                        ...snapshot.data.workspaces,
                        [workspace]: {
                          ...snapshot.data.workspaces[workspace],
                          layout,
                        },
                      },
                    },
                    revision: snapshot.revision,
                  })
                }
              >
                Use latest version with this draft
              </button>
            )}
          </div>
        </section>
      )}
  </div>;
}
