import { ArrowDown, ArrowUp, Columns3, Settings2 } from "lucide-react";
import type { DashboardWidgetDto } from "../lib/api";
import { apiSend } from "../lib/api";
import { pushToast } from "../lib/toast";

const widthCycle = [4, 6, 8, 12];

function sortWidgets(widgets: DashboardWidgetDto[]) {
  return [...widgets].sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title));
}

function uniqueWidgetsByType(widgets: DashboardWidgetDto[]) {
  const seen = new Set<string>();
  return sortWidgets(widgets).filter((widget) => {
    if (seen.has(widget.type)) {
      return false;
    }
    seen.add(widget.type);
    return true;
  });
}

export function WidgetSettings({
  widgets,
  onRefresh
}: {
  widgets: DashboardWidgetDto[];
  onRefresh: () => Promise<void>;
}) {
  const orderedWidgets = uniqueWidgetsByType(widgets);

  async function updateWidget(widget: DashboardWidgetDto, body: Partial<Pick<DashboardWidgetDto, "enabled" | "sortOrder" | "w">>) {
    await apiSend(`/api/dashboard/widgets/${widget.id}`, "PATCH", body);
  }

  async function toggleWidget(widget: DashboardWidgetDto) {
    try {
      await updateWidget(widget, { enabled: !widget.enabled });
      pushToast(widget.enabled ? `Hidden ${widget.title}` : `Showing ${widget.title}`);
      await onRefresh();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Update failed", "error");
    }
  }

  async function moveWidget(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (!orderedWidgets[targetIndex]) {
      return;
    }

    const nextOrder = [...orderedWidgets];
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];

    try {
      await Promise.all(nextOrder.map((widget, sortOrder) => updateWidget(widget, { sortOrder })));
      pushToast("Widget order updated");
      await onRefresh();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Reorder failed", "error");
    }
  }

  async function cycleWidgetWidth(widget: DashboardWidgetDto) {
    const normalizedWidth = widthCycle.find((width) => width >= widget.w) ?? 4;
    const currentIndex = widthCycle.indexOf(normalizedWidth);
    const nextWidth = widthCycle[(currentIndex + 1) % widthCycle.length];

    try {
      await updateWidget(widget, { w: nextWidth });
      pushToast(`${widget.title} width updated`);
      await onRefresh();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Resize failed", "error");
    }
  }

  return (
    <details className="widget-settings">
      <summary>
        <Settings2 size={15} />
        Customize widgets
      </summary>
      <div className="widget-settings-list">
        {orderedWidgets.map((widget, index) => (
          <div className="widget-settings-row" key={widget.id}>
            <label className="checkbox-row">
              <input type="checkbox" checked={widget.enabled} onChange={() => void toggleWidget(widget)} />
              <span>
                <strong>{widget.title}</strong>
                <small>{widget.w >= 12 ? "Full width" : widget.w >= 8 ? "Wide" : widget.w >= 6 ? "Medium" : "Compact"}</small>
              </span>
            </label>
            <div className="widget-settings-actions">
              <button
                className="icon-button"
                type="button"
                title="Move widget up"
                disabled={index === 0}
                onClick={() => void moveWidget(index, -1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                className="icon-button"
                type="button"
                title="Move widget down"
                disabled={index === orderedWidgets.length - 1}
                onClick={() => void moveWidget(index, 1)}
              >
                <ArrowDown size={15} />
              </button>
              <button
                className="icon-button"
                type="button"
                title="Cycle widget width"
                onClick={() => void cycleWidgetWidth(widget)}
              >
                <Columns3 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
