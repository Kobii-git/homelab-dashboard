import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { HomepageData, HomepageSnapshot } from "../../../shared/homepage";
import { apiGet, apiSend } from "../../lib/api";

let cachedSnapshot: HomepageSnapshot | null = null;
let snapshotRequest: Promise<HomepageSnapshot> | null = null;
let cacheGeneration = 0;
const snapshotListeners = new Set<() => void>();

export type HomepageChangedDetail = {
  source: "local";
  revision: number;
  bookmarksChanged: boolean;
};

function subscribeSnapshot(listener: () => void) {
  snapshotListeners.add(listener);
  return () => { snapshotListeners.delete(listener); };
}

function publishSnapshot(update: SetStateAction<HomepageSnapshot | null>) {
  const next = typeof update === "function" ? update(cachedSnapshot) : update;
  if (next === cachedSnapshot) return;
  cachedSnapshot = next;
  snapshotListeners.forEach((listener) => listener());
}

function fetchSnapshot() {
  if (!snapshotRequest) {
    const request = apiGet<HomepageSnapshot>("/api/homepage");
    snapshotRequest = request;
    void request.then(
      () => { if (snapshotRequest === request) snapshotRequest = null; },
      () => { if (snapshotRequest === request) snapshotRequest = null; }
    );
  }
  return snapshotRequest;
}

export function clearHomepageCache() {
  cacheGeneration += 1;
  snapshotRequest = null;
  publishSnapshot(null);
}

export function useHomepage() {
  const snapshot = useSyncExternalStore(subscribeSnapshot, () => cachedSnapshot, () => null);
  const setSnapshot: Dispatch<SetStateAction<HomepageSnapshot | null>> = publishSnapshot;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const mutating = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current || mutating.current) return;
    pending.current = true;
    const generation = cacheGeneration;
    try {
      const next = await fetchSnapshot();
      if (mounted.current && !mutating.current && generation === cacheGeneration) {
        publishSnapshot((current) =>
          !current || next.revision >= current.revision ? next : current,
        );
        setError(null);
      }
    } catch (e) {
      if (mounted.current && generation === cacheGeneration)
        setError(
          e instanceof Error
            ? e.message
            : "Connection unavailable; your drafts are preserved.",
        );
    } finally {
      pending.current = false;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const update = () => {
      if (!document.hidden) void refresh();
    };
    const timer = setInterval(update, 30_000);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<HomepageChangedDetail>).detail?.source !== "local") update();
    };
    window.addEventListener("homepage:changed", onChanged);
    document.addEventListener("visibilitychange", update);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      window.removeEventListener("homepage:changed", onChanged);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
  async function mutate(path: string, body: object): Promise<HomepageSnapshot> {
    if (mutating.current) throw new Error("A save is already in progress");
    mutating.current = true;
    const generation = cacheGeneration;
    setBusy(true);
    setError(null);
    try {
      const base = cachedSnapshot;
      const isStateSave = path === "/api/homepage/state" && base !== null;
      const next = isStateSave
        ? {
            ...base,
            ...await apiSend<Pick<HomepageSnapshot, "revision" | "data">>(
              path, "POST", body, { Prefer: "return=minimal" },
            ),
          }
        : await apiSend<HomepageSnapshot>(path, "POST", body);
      if (generation === cacheGeneration) {
        setSnapshot((current) => current && current.revision > next.revision ? current : next);
        window.dispatchEvent(new CustomEvent<HomepageChangedDetail>("homepage:changed", {
          detail: { source: "local", revision: next.revision, bookmarksChanged: path.startsWith("/api/homepage/bookmarks") },
        }));
      }
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      throw e;
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  return {
    snapshot,
    setSnapshot,
    refresh,
    mutate,
    busy,
    error,
    saveData: (data: HomepageData, revision: number) =>
      mutate("/api/homepage/state", { data, revision }),
  };
}
export type HomepageController = ReturnType<typeof useHomepage>;
export function download(name: string, body: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 16_384)
    text += String.fromCharCode(...bytes.subarray(i, i + 16_384));
  return btoa(text);
}

// getRandomValues remains available on the supported private HTTP origin.
export function newHomepageId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}
