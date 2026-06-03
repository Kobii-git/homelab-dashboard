import { Settings2 } from "lucide-react";
import type { DashboardWidgetDto } from "../lib/api";
import { apiSend } from "../lib/api";
import { pushToast } from "../lib/toast";

export function WidgetSettings({
  widgets,
  onRefresh
}: {
  widgets: DashboardWidgetDto[];
  onRefresh: () => Promise<void>;
}) {
  async function toggleWidget(widget: DashboardWidgetDto) {
    try {
      await apiSend(`/api/dashboard/widgets/${widget.id}`, "PATCH", { enabled: !widget.enabled });
      pushToast(widget.enabled ? `Hidden ${widget.title}` : `Showing ${widget.title}`);
      await onRefresh();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Update failed", "error");
    }
  }

  return (
    <details className="widget-settings">
      <summary>
        <Settings2 size={15} />
        Customize widgets
      </summary>
      <div className="widget-settings-list">
        {widgets.map((widget) => (
          <label className="checkbox-row" key={widget.id}>
            <input type="checkbox" checked={widget.enabled} onChange={() => void toggleWidget(widget)} />
            {widget.title}
          </label>
        ))}
      </div>
    </details>
  );
}
