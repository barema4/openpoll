// A `dateTo` filter is a date-only string (e.g. "2026-09-14") meant to
// include that whole day. Rather than guess at end-of-day, advance to the
// start of the next day and filter with `lt` — simpler and unambiguous
// regardless of what time-of-day the underlying timestamp column holds.
export function dayAfter(dateOnly: string): Date {
  const date = new Date(dateOnly);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}
