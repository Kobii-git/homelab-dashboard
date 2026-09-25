import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { emptyTimesheetDays, localWeekStart, mergeTimesheetDays, shiftDate, weekdays, type TimesheetDays } from "../../../shared/timesheet";
import { ApiResponseError } from "../../lib/api";
import { CopyPreview } from "./BookmarkManager";
import { useTimesheetDraft } from "./TimesheetDrafts";
import type { HomepageController } from "./useHomepage";

function dateLabel(date: string, year = false) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export function WorkTimesheet({ home, now }: { home: HomepageController; now: Date }) {
  const { draft, setDraft } = useTimesheetDraft();
  const [week, setWeek] = useState(() => draft?.weekStart ?? localWeekStart(now));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copy, setCopy] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const dayButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const saving = useRef(false);
  const snapshot = home.snapshot!;
  const weeks = snapshot.data.workspaces.work.timesheetWeeks;
  const saved = weeks.find(value => value.weekStart === week)?.days ?? emptyTimesheetDays();
  const current = draft?.weekStart === week ? draft : null;
  const { days, conflicts } = current ? mergeTimesheetDays(current, saved) : { days: saved, conflicts: [] };
  const currentWeek = localWeekStart(now);

  async function save() {
    if (!current || saving.current || home.busy || conflicts.length) return;
    const savingDraft = current;
    const sentDays = days;
    saving.current = true;
    setError("");
    setNotice("Saving…");
    try {
      const timesheetWeeks = weeks.filter(value => value.weekStart !== week);
      if (sentDays.some(text => text.trim())) timesheetWeeks.push({ weekStart: week, days: sentDays });
      timesheetWeeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
      await home.saveData({ ...snapshot.data, workspaces: { ...snapshot.data.workspaces, work: {
        ...snapshot.data.workspaces.work, timesheetWeeks,
      } } }, snapshot.revision);
      // Typing while a request is in flight must remain a new, unsaved edit.
      setDraft(latest => latest === savingDraft ? null : latest && latest.weekStart === week ? {
        ...latest, base: sentDays,
        days: latest.days.map((text, index) => text === savingDraft.days[index] ? sentDays[index] : text) as TimesheetDays,
      } : latest);
      setNotice("All changes saved");
    } catch (failure) {
      if (failure instanceof ApiResponseError && failure.status === 409) {
        await home.refresh();
        setError("Saved data changed. Your edits are preserved; review them and retry saving.");
      } else {
        setError(failure instanceof ApiResponseError && failure.status === 400 ? failure.message : "Could not save your week. Your edits are kept while this app stays open. Retry when connected.");
      }
      setNotice("");
    } finally {
      saving.current = false;
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!current || error || home.busy || conflicts.length) return;
    const timer = setTimeout(() => void saveRef.current(), 900);
    return () => clearTimeout(timer);
  }, [current, error, home.busy, snapshot.revision, conflicts.length]);

  function changeWeek(next: string) {
    if (draft || home.busy) return;
    setWeek(next);
    setActiveDay(null);
    setNotice("");
    setError("");
  }

  return <section className="hp-timesheet" aria-labelledby="timesheet-title">
    <div className="hp-card-title">
      <div><h3 id="timesheet-title"><CalendarDays size={18} aria-hidden="true" /> Timesheet notes</h3><p className="muted-copy">A few lines each day. Your week, ready to reference.</p></div>
      <div className="hp-actions">
        <button aria-label="Previous timesheet week" disabled={Boolean(draft) || home.busy} onClick={() => changeWeek(shiftDate(week, -7))}><ChevronLeft size={16} /></button>
        <span className="hp-timesheet-range">{dateLabel(week, true)} – {dateLabel(shiftDate(week, 4), true)}</span>
        <button aria-label="Next timesheet week" disabled={Boolean(draft) || home.busy} onClick={() => changeWeek(shiftDate(week, 7))}><ChevronRight size={16} /></button>
        <button disabled={week === currentWeek || Boolean(draft) || home.busy} onClick={() => changeWeek(currentWeek)}>This week</button>
      </div>
    </div>
    <div className="hp-timesheet-weekdays" role="group" aria-label="Timesheet weekdays">
      {weekdays.map((day, index) => <button key={day} ref={element => { dayButtons.current[index] = element; }} type="button" aria-label={day}
        aria-expanded={activeDay === index} aria-controls={`timesheet-panel-${index}`} aria-describedby={`timesheet-day-state-${index}`}
        className={`${week === currentWeek && now.getDay() === index + 1 ? "is-today" : ""} ${conflicts.includes(index) ? "has-conflict" : ""}`}
        onClick={() => setActiveDay(activeDay === index ? null : index)}>
        <span className="hp-weekday-full">{day}</span><span className="hp-weekday-short" aria-hidden="true">{day.slice(0, 3)}</span>
        {days[index].trim() && <span className="hp-day-dot" aria-hidden="true" />}
        <span className="hp-sr-only" id={`timesheet-day-state-${index}`}>{conflicts.includes(index) ? "Needs conflict review" : days[index].trim() ? "Has notes" : "No notes"}{week === currentWeek && now.getDay() === index + 1 ? ", today" : ""}</span>
      </button>)}
    </div>
    {weekdays.map((day, index) => <div id={`timesheet-panel-${index}`} hidden={activeDay !== index} className="hp-timesheet-day" key={day}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setActiveDay(null); dayButtons.current[index]?.focus(); } }}>
      {activeDay === index && <>
        <label htmlFor={`timesheet-${day}`}><strong>{day}</strong><span>{dateLabel(shiftDate(week, index))}</span></label>
        <textarea id={`timesheet-${day}`} aria-label={`${day} work notes`} rows={4} maxLength={5000} placeholder="What did you work on?" value={days[index]}
          onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void save(); } }}
          onChange={event => {
            const next = [...days] as TimesheetDays;
            next[index] = event.target.value;
            const base = current ? current.base.map((text, i) => current.days[i] === text ? saved[i] : text) as TimesheetDays : saved;
            setDraft({ weekStart: week, base, days: next });
            setNotice("");
          }} />
        {conflicts.includes(index) && <p className="hp-timesheet-conflict"><strong>Saved elsewhere:</strong> {saved[index] || "(empty)"}</p>}
      </>}
    </div>)}
    <div className="hp-timesheet-footer">
      <p role="status">{conflicts.length ? `Review changes to ${conflicts.map(index => weekdays[index]).join(", ")}.` : current ? (home.busy ? "Saving…" : "Unsaved changes") : notice || "Changes save automatically"}</p>
      <div className="hp-actions">
        {current && <button disabled={home.busy || Boolean(conflicts.length)} onClick={() => void save()}>{error ? "Retry save" : "Save now"}</button>}
        {Boolean(conflicts.length) && <button disabled={home.busy} onClick={() => { setDraft({ weekStart: week, base: saved, days }); setError(""); }}>Keep my edits</button>}
        {current && <button disabled={home.busy} onClick={() => { if (window.confirm("Discard unsaved timesheet edits and use the saved week?")) { setDraft(null); setError(""); setNotice("Saved week restored"); } }}>Discard edits</button>}
        <button disabled={!days.some(text => text.trim())} onClick={() => setCopy(`Week of ${dateLabel(week, true)}${current ? " (unsaved edits included)" : ""}\n\n${weekdays.map((day, index) => `${day} · ${dateLabel(shiftDate(week, index))}\n${days[index].trim() || "—"}`).join("\n\n")}`)}><Copy size={15} aria-hidden="true" /> Copy week</button>
      </div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {copy !== null && <CopyPreview text={copy} title="Copy timesheet week" description="Copy these notes into your weekly timesheet. Nothing is submitted automatically." copiedMessage="Copied. Ready to paste into your timesheet." onClose={() => setCopy(null)} />}
  </section>;
}
