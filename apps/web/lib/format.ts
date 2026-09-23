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
 * Formatters are expensive to construct and are reused on every row, so they
 * are built once. `Intl` instances are immutable and safe to share.
 */
const TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: CLINIC_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const DATE_LONG = new Intl.DateTimeFormat('en-IN', {
  timeZone: CLINIC_TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const DATE_SHORT = new Intl.DateTimeFormat('en-IN', {
  timeZone: CLINIC_TIMEZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "09:00 am", in clinic time. */
export function formatTime(iso: string): string {
  return TIME.format(new Date(iso))
}

/** "Tuesday, 23 September 2026", in clinic time. */
export function formatDateLong(iso: string | Date): string {
  return DATE_LONG.format(typeof iso === 'string' ? new Date(iso) : iso)
}

/** "23 Sep 2026", in clinic time. */
export function formatDateShort(iso: string | Date): string {
  return DATE_SHORT.format(typeof iso === 'string' ? new Date(iso) : iso)
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
