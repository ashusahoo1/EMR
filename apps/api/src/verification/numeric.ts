/**
 * Numeric containment (BUILD_ROADMAP B4, §4.6 check 3). Catches E13.
 *
 * THE BRIEF'S HEADLINE CASE, mechanised: every number in the output must
 * appear in the input.
 *
 *   notes:  "fever since 3 days"
 *   output: "Fever for 3 days"   -> 3 is present in the input
 *   output: "BP 130/80"          -> 130 and 80 are absent -> fabricated
 *
 * The schema already denies a `bloodPressure` key (no slot, no temptation).
 * This check covers what the schema cannot: a reading written into a free
 * text field, where the grammar has nothing to say about it.
 *
 * THE DESIGN TENSION, stated plainly. §4.6: "Keep the rule strict but let
 * borderline cases flag rather than fail -- a flag costs a glance, a false
 * rejection costs the feature." So this file is built around two questions,
 * not one: is the number present, and if not, how confident are we that its
 * absence is real? A number we merely failed to *recognise* in the source is
 * a soft flag. A number that is genuinely nowhere is repairable.
 *
 * Pure functions. No imports from `db/` or `llm/`.
 */
import { normalise } from './normalise.ts'

/**
 * Number words we accept as equivalent to digits.
 *
 * Bounded deliberately at twenty plus the round tens: clinical notes say
 * "three days" and "two weeks", not "one hundred and seventeen". A longer
 * list would add parsing complexity for cases that do not occur, and every
 * entry is a chance to map something wrongly.
 */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  // Indian clinical usage, and common in patient-reported history.
  half: 0.5,
}

/**
 * Extract every number from a text, as numeric values.
 *
 * Handles the forms that actually occur in Indian OPD notes:
 *   "3"        plain digits
 *   "3.5"      decimals
 *   "x3d"      shorthand: 3 days       (E10, N02)
 *   "130/80"   a ratio -- BOTH numbers, which is the point for E13
 *   "1/2"      likewise
 *   "three"    number words
 *   "3kg"      a quantity with a unit attached
 *
 * Returns values rather than strings so that "3" and "three" and "03"
 * compare equal without three separate special cases at the call site.
 */
export function extractNumbers(text: string): number[] {
  const found: number[] = []
  const source = normalise(text)

  // Digit runs, including decimals. Because this runs on normalised text and
  // scans for digit groups anywhere, it naturally handles "x3d" (-> 3),
  // "130/80" (-> 130, 80) and "3kg" (-> 3) without a rule for each: the
  // separators are simply not digits.
  for (const match of source.matchAll(/\d+(?:\.\d+)?/g)) {
    const value = Number.parseFloat(match[0])
    if (Number.isFinite(value)) found.push(value)
  }

  // Number words, matched whole so that "one" does not fire inside "bone"
  // -- which it would, and "bone pain" is not a number.
  for (const match of source.matchAll(/[a-z]+/g)) {
    const value = NUMBER_WORDS[match[0]]
    if (value !== undefined) found.push(value)
  }

  return found
}

/**
 * Numbers in `output` that do not appear in `source`.
 *
 * The comparison is on VALUES, so "3 days" in the notes grounds "three days"
 * in the output and vice versa. That is the digits-vs-words allowance §4.6
 * asks for, and it costs nothing in strictness: 130 still does not appear in
 * a note that never mentions it.
 */
export function unsupportedNumbers(source: string, output: string): number[] {
  const permitted = new Set(extractNumbers(source))
  const unsupported: number[] = []

  for (const value of extractNumbers(output)) {
    if (permitted.has(value)) continue
    if (unsupported.includes(value)) continue
    unsupported.push(value)
  }

  return unsupported
}

/**
 * Values that are almost always ordinary language rather than clinical data.
 *
 * "Twice daily" and "once a month" carry 2 and 1, and a doctor writing "BD"
 * in the notes has not written the digit 2 -- so normalising "PCM BD" to
 * "twice daily" would otherwise raise a numeric flag on a correct
 * expansion. These are exactly the "borderline cases" §4.6 says to treat
 * gently.
 *
 * Confined to small integers. A fabricated blood pressure, temperature or
 * dose is never 1 or 2, so nothing dangerous hides behind this allowance.
 */
const COMMON_LANGUAGE_VALUES = new Set([0, 0.5, 1, 2])

/**
 * How seriously to treat an unsupported number.
 *
 * `repairable` -- a real fabrication. Worth a retry with feedback.
 * `soft`       -- plausibly an artefact of normalising the doctor's own
 *                 shorthand. Show it, marked unverified; do not retry.
 *
 * This split is the difference between a check that survives contact with
 * real notes and one a doctor turns off. Being wrong in the `soft`
 * direction costs a glance; being wrong in the `repairable` direction costs
 * a wasted model call and, if it happens often, the feature.
 */
export function classifyUnsupportedNumber(value: number): 'repairable' | 'soft' {
  return COMMON_LANGUAGE_VALUES.has(value) ? 'soft' : 'repairable'
}

/**
 * Whether a value looks like a vital sign -- the E13 family specifically.
 *
 * Used only to sharpen the message the doctor reads. A flag saying "130 does
 * not appear in your notes" is correct but flat; one that says it looks like
 * a fabricated measurement tells them where to look and why it matters.
 *
 * Heuristic on purpose, and it never changes the verdict -- only the wording.
 */
export function looksLikeVital(value: number): boolean {
  // Systolic/diastolic BP, pulse, and temperature in F or C.
  const inBpOrPulseRange = value >= 40 && value <= 250 && Number.isInteger(value)
  const inTemperatureRange = value >= 95 && value <= 106
  return inBpOrPulseRange || inTemperatureRange
}
