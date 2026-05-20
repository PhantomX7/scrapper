// Working hours: 9 AM (inclusive) – 5 PM (exclusive) in GMT+7. Drives the
// "working-hour reply time" metric on the contacts page — the wait is counted
// only while the clock is inside the window, regardless of when the chat
// starts. So a chat at 8 PM replied to at 9:30 AM next day scores 30 minutes
// (the 09:00–09:30 sliver), and a chat at 14:05 replied to at 12:47 the next
// day scores 6h 42m (14:05–17:00 the first day plus 09:00–12:47 the second).
//
// Weekends are not excluded — only hour-of-day. Add a day-of-week guard if
// Saturday/Sunday should also be off-hours.

const WORKING_HOUR_START = 9
const WORKING_HOUR_END = 17
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000 // GMT+7
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000

// Milliseconds of [start, end] that lie inside any 9 AM – 5 PM GMT+7 window.
// Returns 0 when end <= start. Shifts both timestamps by +7h so day
// boundaries in GMT+7 align with multiples of 86_400_000 in the shifted axis
// — that lets us iterate day-by-day without per-day timezone math.
export function workingHourOverlapMs(start: Date, end: Date): number {
  const startMs = start.getTime()
  const endMs = end.getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  if (endMs <= startMs) return 0

  const startTz = startMs + TZ_OFFSET_MS
  const endTz = endMs + TZ_OFFSET_MS

  let total = 0
  let dayStart = Math.floor(startTz / ONE_DAY_MS) * ONE_DAY_MS
  while (dayStart < endTz) {
    const workStart = dayStart + WORKING_HOUR_START * ONE_HOUR_MS
    const workEnd = dayStart + WORKING_HOUR_END * ONE_HOUR_MS
    const overlap =
      Math.max(0, Math.min(endTz, workEnd) - Math.max(startTz, workStart))
    total += overlap
    dayStart += ONE_DAY_MS
  }
  return total
}
