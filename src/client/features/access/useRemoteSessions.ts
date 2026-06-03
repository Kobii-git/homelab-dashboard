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
  const [activeTabIds, setActiveTabIds] = useState<Record<Protocol, string | null>>({
    ssh: null,
    rdp: null
  });

  const getActiveTabId = useCallback((protocol: Protocol) => activeTabIds[protocol], [activeTabIds]);

  const setActiveTabId = useCallback((protocol: Protocol, tabId: string | null) => {
    setActiveTabIds((current) => ({ ...current, [protocol]: tabId }));
  }, []);

  const reset = useCallback(() => {
    setTabs([]);
    setActiveTabIds({ ssh: null, rdp: null });
  }, []);

  return { tabs, setTabs, getActiveTabId, setActiveTabId, reset };
}
