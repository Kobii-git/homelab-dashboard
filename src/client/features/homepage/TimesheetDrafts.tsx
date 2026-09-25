import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { TimesheetDraft } from "../../../shared/timesheet";

const DraftContext = createContext<{
  draft: TimesheetDraft | null;
  setDraft: Dispatch<SetStateAction<TimesheetDraft | null>>;
} | null>(null);

// Keep unsaved edits across in-app navigation, without writing private drafts to browser storage.
export function useTimesheetDraftState() {
  const [draft, setDraft] = useState<TimesheetDraft | null>(null);
  useEffect(() => {
    if (!draft) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [draft]);
  return { draft, setDraft };
}

export function TimesheetDraftProvider({ children, value }: { children: ReactNode; value: ReturnType<typeof useTimesheetDraftState> }) {
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useTimesheetDraft() {
  const state = useContext(DraftContext);
  if (!state) throw new Error("Timesheet draft provider is missing");
  return state;
}
