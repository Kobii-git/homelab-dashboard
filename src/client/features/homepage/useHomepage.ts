import { useCallback, useEffect, useRef, useState } from "react";
import type { HomepageData, HomepageSnapshot } from "../../../shared/homepage";
import { apiGet, apiSend } from "../../lib/api";
export function useHomepage() {
  const [snapshot, setSnapshot] = useState<HomepageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const mutating = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current || mutating.current) return;
    pending.current = true;
    try {
      const next = await apiGet<HomepageSnapshot>("/api/homepage");
      if (mounted.current && !mutating.current) {
        setSnapshot((current) =>
          !current || next.revision >= current.revision ? next : current,
        );
        setError(null);
      }
    } catch (e) {
      if (mounted.current)
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
    window.addEventListener("homepage:changed", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      window.removeEventListener("homepage:changed", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
  async function mutate(path: string, body: object): Promise<HomepageSnapshot> {
    if (mutating.current) throw new Error("A save is already in progress");
    mutating.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await apiSend<HomepageSnapshot>(path, "POST", body);
      setSnapshot(next);
      window.dispatchEvent(new Event("homepage:changed"));
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
