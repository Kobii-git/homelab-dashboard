import { describe, expect, it } from "vitest";
import type { AgendaEventDto } from "../src/shared/types";
import { calendarEventsOnDay, calendarEventStart, upcomingCalendarEvents } from "../src/client/lib/calendar";

function event(patch: Partial<AgendaEventDto>): AgendaEventDto {
  return { id: "event", title: "Event", start: "2026-08-29", end: "2026-08-31", allDay: true, calendarName: "Primary", color: null, url: null, ...patch };
}

describe("Launchpad calendar dates", () => {
  it("keeps all-day dates local and includes an ongoing multi-day event", () => {
    const holiday = event({});
    const start = calendarEventStart(holiday);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 7, 29, 0]);
    expect(upcomingCalendarEvents([holiday], new Date(2026, 7, 30, 15))).toEqual([holiday]);
    expect(calendarEventsOnDay([holiday], new Date(2026, 7, 30))).toEqual([holiday]);
    expect(calendarEventsOnDay([holiday], new Date(2026, 7, 31))).toEqual([]);
    expect(upcomingCalendarEvents([holiday], new Date(2026, 7, 31))).toEqual([]);
  });

  it("uses local days for timed events and excludes the midnight end boundary", () => {
    const overnight = event({ allDay: false, start: new Date(2026, 7, 29, 23).toISOString(), end: new Date(2026, 7, 31).toISOString() });
    expect(calendarEventsOnDay([overnight], new Date(2026, 7, 29))).toEqual([overnight]);
    expect(calendarEventsOnDay([overnight], new Date(2026, 7, 30))).toEqual([overnight]);
    expect(calendarEventsOnDay([overnight], new Date(2026, 7, 31))).toEqual([]);
  });

  it("sorts upcoming events and removes finished events without changing the provider list", () => {
    const later = event({ id: "later", allDay: false, start: new Date(2026, 7, 30, 18).toISOString(), end: null });
    const ongoing = event({ id: "ongoing" });
    const finished = event({ id: "finished", end: "2026-08-30" });
    const events = [later, finished, ongoing];
    expect(upcomingCalendarEvents(events, new Date(2026, 7, 30, 12)).map((item) => item.id)).toEqual(["ongoing", "later"]);
    expect(events.map((item) => item.id)).toEqual(["later", "finished", "ongoing"]);
  });

  it("treats an all-day event without an end as one calendar day", () => {
    const singleDay = event({ start: "2026-03-08", end: null });
    expect(upcomingCalendarEvents([singleDay], new Date(2026, 2, 8, 23, 59))).toEqual([singleDay]);
    expect(calendarEventsOnDay([singleDay], new Date(2026, 2, 9))).toEqual([]);
    expect(upcomingCalendarEvents([singleDay], new Date(2026, 2, 9))).toEqual([]);
  });
});
