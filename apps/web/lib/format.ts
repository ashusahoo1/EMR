/**
 * Display formatting (BUILD_ROADMAP C2).
 *
 * THE TIMEZONE POINT, because it bit the backend already. The API returns
 * `scheduledAt` as a UTC ISO string, and the clinic runs on
 * `CLINIC_TIMEZONE` (Asia/Kolkata). Formatting with the browser's default
 * locale shows the VIEWER's timezone, so a doctor whose laptop is set to UTC
 * -- or who is travelling -- would read 09:00 IST as 03:30.
 *
 * A6 hit the same problem server-side: `scheduled_at::date = current_date`
 * returned zero rows between midnight and 05:30 IST. The fix there was to
 * name the zone explicitly in the query; the fix here is to name it in the
 * formatter. "Today" and "09:00" mean today and nine o'clock AT THE CLINIC,
 * not wherever the screen happens to be.
 */
import { CLINIC_TIMEZONE } from '@emr/shared'

/**
 * THE SECOND HALF OF THE TIMEZONE PROBLEM, found by a hydration error.
 *
 * Naming the timezone (above) fixes WHICH INSTANT is shown. It does not fix
 * HOW it is written -- and that turns out to vary too:
 *
 *   Bun  (ICU 78.3): "Wednesday, 23 September 2026"
 *   Node (ICU 75.1): "Wednesday 23 September, 2026"
 *
 * Same locale, same options, different comma placement, because `en-IN`'s
 * pattern for this field combination changed between ICU releases. Next
 * renders the page on Node and hydrates it on Bun-built client code, so
 * React compared the two strings and reported a hydration mismatch.
 *
 * The VALUES are identical across runtimes -- only the arrangement differs.
 * So these formatters ask `Intl` for the parts and assemble the sentence
 * themselves. That keeps the locale-aware month and weekday names, the
 * timezone conversion and the numbering system, while making the output a
 * fixed function of the date rather than of whichever ICU happens to be
 * loaded.
 *
 * Applied to all three, not just the one that broke: `formatTime` and
 * `formatDateShort` agree on today's ICU versions, but that is luck rather
 * than a guarantee, and a hydration error is a poor way to find out it ran
 * out.
 */
const PARTS = {
  time: new Intl.DateTimeFormat('en-IN', {
    timeZone: CLINIC_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }),
  long: new Intl.DateTimeFormat('en-IN', {
    timeZone: CLINIC_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
  short: new Intl.DateTimeFormat('en-IN', {
    timeZone: CLINIC_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }),
} as const

/** Pull the named parts out of a format, ignoring the locale's literals. */
function partsOf(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  const found: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') found[part.type] = part.value
  }
  return found
}

function toDate(input: string | Date): Date {
  return typeof input === 'string' ? new Date(input) : input
}

/** "09:00 am", in clinic time. */
export function formatTime(iso: string): string {
  const { hour, minute, dayPeriod } = partsOf(PARTS.time, new Date(iso))
  // dayPeriod is "am"/"pm" here; lowercased so a runtime rendering it as
  // "AM" cannot reintroduce the same class of mismatch.
  return `${hour}:${minute} ${(dayPeriod ?? '').toLowerCase()}`.trim()
}

/** "Wednesday, 23 September 2026", in clinic time. */
export function formatDateLong(iso: string | Date): string {
  const { weekday, day, month, year } = partsOf(PARTS.long, toDate(iso))
  return `${weekday}, ${day} ${month} ${year}`
}

/** "23 Sep 2026", in clinic time. */
export function formatDateShort(iso: string | Date): string {
  const { day, month, year } = partsOf(PARTS.short, toDate(iso))
  return `${day} ${month} ${year}`
}

/**
 * Today's date as YYYY-MM-DD **in the clinic's timezone**.
 *
 * Built from `en-CA`, whose short date format is already ISO-ordered, rather
 * than from `toISOString()` -- which converts to UTC first and therefore
 * returns yesterday's date for anything before 05:30 IST. That is the exact
 * off-by-one the backend hit at A6.
 */
export function clinicToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** "34 M" -- the compact demographic line used in lists. */
export function formatPatientMeta(age: number, sex: string): string {
  return `${age} ${sex}`
}
