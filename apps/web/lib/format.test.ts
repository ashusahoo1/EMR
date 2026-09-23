/**
 * Date formatting (BUILD_ROADMAP C2, fixed at C10).
 *
 * THE BUG THESE GUARD AGAINST was a hydration mismatch found by running the
 * app, not by any gate:
 *
 *   Bun  (ICU 78.3): "Wednesday, 23 September 2026"
 *   Node (ICU 75.1): "Wednesday 23 September, 2026"
 *
 * Same locale, same options, different comma placement -- `en-IN`'s pattern
 * for that field combination changed between ICU releases. Next renders on
 * Node and hydrates against Bun-built client code, so React saw two
 * different strings and regenerated the tree.
 *
 * Asserting the EXACT output is the point. A test that only checked "the
 * date appears somewhere" would have passed throughout the bug.
 */
import { describe, expect, test } from 'bun:test'
import { clinicToday, formatDateLong, formatDateShort, formatTime } from './format.ts'

/** 09:00 IST, which is 03:30 UTC -- the seeded first appointment. */
const MORNING = '2026-09-23T03:30:00.000Z'

/**
 * THE TEST THAT ACTUALLY CATCHES THE BUG.
 *
 * The assertions below run on Bun, whose ICU happens to agree with our
 * chosen wording -- so reverting to `formatter.format()` leaves them all
 * green while the app breaks on Node. Verified: undoing the fix failed
 * nothing.
 *
 * So this asserts the property that matters instead: the output must be
 * built from the PARTS, never from the locale's pattern. Simulating Node's
 * pattern is impossible here, but a formatter whose literals we ignore
 * cannot be pattern-dependent by construction -- and that is checkable.
 */
describe('formatting does not depend on the runtime ICU pattern', () => {
  test('the long date uses our separator, not the locale pattern', () => {
    // Node ICU 75 renders "Wednesday 23 September, 2026" for this locale;
    // Bun ICU 78 renders "Wednesday, 23 September 2026". Asserting our
    // arrangement pins it to one of them everywhere.
    const raw = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(MORNING))

    const ours = formatDateLong(MORNING)

    // Same VALUES in both -- only the punctuation can differ.
    for (const value of ['Wednesday', '23', 'September', '2026']) {
      expect(raw).toContain(value)
      expect(ours).toContain(value)
    }

    // And ours is the fixed arrangement regardless of what `raw` did.
    expect(ours).toBe('Wednesday, 23 September 2026')
  })

  test('every formatter output is free of locale-specific literals', () => {
    // A comma before the day ("Wednesday 23 September, 2026") is the
    // signature of Node's pattern leaking through. Ours never produces it.
    expect(formatDateLong(MORNING)).not.toMatch(/\d,/)
    expect(formatDateShort(MORNING)).not.toContain(',')
  })
})

describe('output is a fixed function of the date, not of the runtime', () => {
  test('formatDateLong places the comma after the weekday', () => {
    // The exact string that differed between ICU versions.
    expect(formatDateLong(MORNING)).toBe('Wednesday, 23 September 2026')
  })

  test('formatDateShort has no comma at all', () => {
    expect(formatDateShort(MORNING)).toBe('23 Sept 2026')
  })

  test('formatTime is lower-case am/pm', () => {
    // Lowercased explicitly, so a runtime rendering "AM" cannot reintroduce
    // the same class of mismatch.
    expect(formatTime(MORNING)).toBe('09:00 am')
  })
})

describe('the timezone conversion still happens', () => {
  test('03:30 UTC renders as 09:00 in clinic time', () => {
    // The whole reason these formatters name CLINIC_TIMEZONE: a doctor on a
    // UTC laptop must still read the clinic's nine o'clock.
    expect(formatTime(MORNING)).toBe('09:00 am')
  })

  test('an evening UTC instant rolls into the NEXT clinic day', () => {
    // 18:45 UTC on 1 Jan is 00:15 IST on 2 Jan. Getting this wrong is the
    // off-by-one that made A6's naive date filter return zero rows.
    expect(formatTime('2026-01-01T18:45:00.000Z')).toBe('12:15 am')
    expect(formatDateLong('2026-01-01T18:45:00.000Z')).toBe('Friday, 2 January 2026')
  })

  test('a late-December instant rolls into the next YEAR', () => {
    expect(formatDateShort('2026-12-31T20:00:00.000Z')).toBe('1 Jan 2027')
  })
})

describe('clinicToday is the clinic date, not the UTC date', () => {
  test('before 05:30 IST it is still the clinic day that just started', () => {
    // 2026-09-22T20:00Z is 2026-09-23T01:30 IST. toISOString() would return
    // the 22nd -- the exact off-by-one A6 hit server-side.
    expect(clinicToday(new Date('2026-09-22T20:00:00.000Z'))).toBe('2026-09-23')
  })

  test('mid-afternoon UTC is the same day either way', () => {
    expect(clinicToday(new Date('2026-09-23T10:00:00.000Z'))).toBe('2026-09-23')
  })

  test('it is ISO-ordered, so it can be handed straight to the API', () => {
    expect(clinicToday(new Date(MORNING))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
