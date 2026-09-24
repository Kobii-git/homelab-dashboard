import { useSyncExternalStore } from "react";
import type { WorkspaceId } from "../../../shared/homepage";

const eventName = "homepage:workspace";
function subscribe(update: () => void) {
  window.addEventListener(eventName, update);
  window.addEventListener("storage", update);
  return () => {
    window.removeEventListener(eventName, update);
    window.removeEventListener("storage", update);
  };
}
function current(): WorkspaceId {
  return localStorage.getItem("homepage-workspace") === "work" ? "work" : "home";
}
function select(workspace: WorkspaceId) {
  localStorage.setItem("homepage-workspace", workspace);
  window.dispatchEvent(new Event(eventName));
}
export function useHomepageWorkspace() {
  return [useSyncExternalStore(subscribe, current), select] as const;
}
