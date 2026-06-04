import { useCallback, useState } from "react";
import type { SessionLaunchDto } from "../../lib/api";
import type { Protocol } from "./accessUtils";

export type RemoteTab = {
  id: string;
  connectionId: string;
  protocol: Protocol;
  title: string;
  state: "launching" | "connected" | "failed" | "closed";
  fullscreen: boolean;
  startedAt: string;
  session?: SessionLaunchDto;
  error?: string;
};

export function useRemoteSessions() {
  const [tabs, setTabs] = useState<RemoteTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  return { tabs, setTabs, activeTabId, setActiveTabId, reset };
}
