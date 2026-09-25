import { describe, expect, it } from "vitest";
import { defaultHomepage, homepageDataSchema } from "../src/shared/homepage";
import { emptyTimesheetDays, localWeekStart, mergeTimesheetDays, shiftDate, timesheetWeeksSchema, type TimesheetDraft } from "../src/shared/timesheet";

describe("weekly work notes", () => {
  it("defaults old workspaces without changing their saved layout or notes", () => {
    const legacy = JSON.parse(JSON.stringify(defaultHomepage()));
    delete legacy.workspaces.work.timesheetWeeks;
    legacy.workspaces.work.notes = "Keep this scratchpad";
    const parsed = homepageDataSchema.parse(legacy);
    expect(parsed.workspaces.work.timesheetWeeks).toEqual([]);
    expect(parsed.workspaces.work.notes).toBe(legacy.workspaces.work.notes);
    expect(parsed.workspaces.work.layout).toEqual(legacy.workspaces.work.layout);
    expect(homepageDataSchema.safeParse({ ...legacy, workspaces: { ...legacy.workspaces, home: { ...legacy.workspaces.home, timesheetWeeks: [] } } }).success).toBe(false);
  });

  it("uses the local Monday across weekends, year boundaries, and daylight-saving weeks", () => {
    expect(localWeekStart(new Date(2026, 0, 1, 0, 5))).toBe("2025-12-29");
    expect(localWeekStart(new Date(2026, 8, 27, 23, 59))).toBe("2026-09-21");
    expect(localWeekStart(new Date(2026, 8, 28, 0, 1))).toBe("2026-09-28");
    expect(shiftDate("2026-03-02", 7)).toBe("2026-03-09");
    expect(shiftDate("2026-12-28", 7)).toBe("2027-01-04");
  });

  it("rejects invalid dates, duplicate weeks, and oversized data without truncating notes", () => {
    const week = { weekStart: "2026-09-21", days: emptyTimesheetDays() };
    for (const value of [
      [{ ...week, weekStart: "2026-02-30" }], [{ ...week, weekStart: "2026-09-22" }],
      [{ ...week, weekStart: "2026-9-21" }], [week, week],
      [{ ...week, days: ["x".repeat(5001), "", "", "", ""] }], [{ ...week, days: [""] }],
      Array.from({ length: 521 }, (_, index) => ({ ...week, weekStart: shiftDate(week.weekStart, index * 7) })),
      Array.from({ length: 21 }, (_, index) => ({ ...week, weekStart: shiftDate(week.weekStart, index * 7), days: Array(5).fill("x".repeat(5000)) })),
    ]) expect(timesheetWeeksSchema.safeParse(value).success).toBe(false);
    expect(timesheetWeeksSchema.parse([week])).toEqual([week]);
  });

  it("merges independent days and identifies same-day conflicts including deletions", () => {
    const draft: TimesheetDraft = { weekStart: "2026-09-21", base: ["Original", "", "", "", ""], days: ["My edit", "", "", "", ""] };
    expect(mergeTimesheetDays(draft, ["Original", "Other day", "", "", ""])).toEqual({ days: ["My edit", "Other day", "", "", ""], conflicts: [] });
    expect(mergeTimesheetDays(draft, ["Other edit", "", "", "", ""]).conflicts).toEqual([0]);
    expect(mergeTimesheetDays(draft, emptyTimesheetDays()).conflicts).toEqual([0]);
    expect(mergeTimesheetDays(draft, draft.days).conflicts).toEqual([]);
  });
});
