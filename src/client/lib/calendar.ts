import type { AgendaEventDto } from "../../shared/types";

export function calendarEventStart(event: AgendaEventDto): Date {
  // All-day dates are calendar dates, not UTC instants.
  return new Date(event.allDay ? `${event.start.slice(0, 10)}T00:00:00` : event.start);
}

function calendarEventEnd(event: AgendaEventDto): Date {
  if (event.end) return new Date(event.allDay ? `${event.end.slice(0, 10)}T00:00:00` : event.end);
  const end = calendarEventStart(event);
  if (event.allDay) end.setDate(end.getDate() + 1);
  return end;
}

export function calendarEventsOnDay(events: AgendaEventDto[], day: Date): AgendaEventDto[] {
  const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const endOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  return events.filter((event) => {
    const start = calendarEventStart(event).getTime();
    const end = calendarEventEnd(event).getTime();
    // An event ending at midnight does not occupy the following day.
    return end > start
      ? start < endOfDay && end > startOfDay
      : start >= startOfDay && start < endOfDay;
  });
}

export function upcomingCalendarEvents(events: AgendaEventDto[], now: Date): AgendaEventDto[] {
  return events.filter((event) => {
    const start = calendarEventStart(event).getTime();
    const end = calendarEventEnd(event).getTime();
    return end > start ? end > now.getTime() : start >= now.getTime();
  }).sort((left, right) => calendarEventStart(left).getTime() - calendarEventStart(right).getTime());
}
