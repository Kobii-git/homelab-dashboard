import { z } from "zod";

export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export type TimesheetDays = [string, string, string, string, string];
export const emptyTimesheetDays = (): TimesheetDays => ["", "", "", "", ""];

// Calendar dates are stored without a timezone. UTC arithmetic avoids DST shifts.
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function localWeekStart(now: Date): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return shiftDate(date, -((now.getDay() + 6) % 7));
}

export const timesheetWeekSchema = z.object({
  weekStart: z.iso.date().refine(value => new Date(`${value}T12:00:00Z`).getUTCDay() === 1, "Week must start on Monday"),
  days: z.tuple([z.string().max(5000), z.string().max(5000), z.string().max(5000), z.string().max(5000), z.string().max(5000)]),
}).strict();

export const timesheetWeeksSchema = z.array(timesheetWeekSchema).max(520).default([]).superRefine((weeks, ctx) => {
  if (new Set(weeks.map(week => week.weekStart)).size !== weeks.length)
    ctx.addIssue({ code: "custom", message: "Duplicate timesheet weeks" });
  if (weeks.reduce((total, week) => total + week.days.join("").length, 0) > 500_000)
    ctx.addIssue({ code: "custom", message: "Timesheet notes exceed the text limit" });
});

export type TimesheetDraft = { weekStart: string; base: TimesheetDays; days: TimesheetDays };

// Merge untouched days, but require a deliberate choice for edits to the same day.
export function mergeTimesheetDays(draft: TimesheetDraft, saved: TimesheetDays) {
  const conflicts: number[] = [];
  const days = draft.days.map((text, index) => {
    if (text === draft.base[index]) return saved[index];
    if (saved[index] !== draft.base[index] && saved[index] !== text) conflicts.push(index);
    return text;
  }) as TimesheetDays;
  return { days, conflicts };
}
