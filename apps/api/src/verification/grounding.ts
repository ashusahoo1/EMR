/**
 * Span grounding (BUILD_ROADMAP B4, §4.6 check 2). Catches E14 and E15.
 *
 * The question: does each `sourceSpan` actually occur in the doctor's notes?
 *
 *   notes:      "patient has fever since 3 days"
 *   sourceSpan: "fever since 3 days"   -> found
 *   sourceSpan: "BP 130/80"            -> not found, fabricated
 *
 * This is the check that makes the whole stage-4 idea work, and also the one
 * with the clearest limit: it validates what IS present and can never catch
 * what went missing. That gap is `survival.ts`'s job, and it exists because
 * grounding cannot be stretched to cover it.
 *
 * Pure functions. No imports from `db/` or `llm/`.
 */
import { containsNormalised, normalise, normaliseLoose } from './normalise.ts'

/**
 * How a span was matched, in decreasing order of confidence.
 *
 * Reported rather than collapsed to a boolean because the tiers mean
 * different things: `exact` is proof, `loose` is "probably a re-punctuation,
 * worth a glance". Collapsing them would force one policy on both.
 */
export const GroundingMatch = {
  /** Byte-for-byte substring of the source. */
  Exact: 'exact',
  /** Matched after lowercase, whitespace and punctuation-lookalike folding. */
  Normalised: 'normalised',
  /** Matched only after discarding punctuation entirely. */
  Loose: 'loose',
  /** Not found by any tier -- the span is not in the notes. */
  None: 'none',
} as const
export type GroundingMatch = (typeof GroundingMatch)[keyof typeof GroundingMatch]

/**
 * Locate a span in the source text.
 *
 * Tried raw first, exactly as §4.6 specifies: "Try raw match first, then
 * normalised." The order matters for reporting, not for the verdict -- a
 * span that needed normalising is still grounded, but knowing it did tells
 * us the model paraphrased rather than copied (E15), which is worth
 * surfacing separately from outright fabrication (E14).
 */
export function matchSpan(source: string, span: string): GroundingMatch {
  // An empty span grounds nothing. The schema forbids it (minLength: 1), but
  // this function must not depend on the schema having run first.
  if (span.trim() === '') return GroundingMatch.None

  if (source.includes(span)) return GroundingMatch.Exact
  if (containsNormalised(source, span)) return GroundingMatch.Normalised
  if (normaliseLoose(source).includes(normaliseLoose(span))) return GroundingMatch.Loose

  return GroundingMatch.None
}

/** Whether a span is grounded at any tier. */
export function isGrounded(source: string, span: string): boolean {
  return matchSpan(source, span) !== GroundingMatch.None
}

/**
 * Where a span sits in the source, for the frontend's provenance highlight
 * (C5/C6) -- or null if it is not found.
 *
 * Offsets are computed HERE, from the text, never requested from the model.
 * §4.5 is explicit about why: models cannot count characters reliably, so
 * asking for `{start, end}` rejects valid output over off-by-several errors.
 * Let the model copy text; let indexOf find it.
 *
 * Only exact matches yield offsets. A normalised match has no honest
 * position in the original string -- collapsing whitespace shifts every
 * index after it -- and returning an approximate range would highlight the
 * wrong words, which is worse than highlighting none.
 */
export function findSpanOffsets(
  source: string,
  span: string,
): { start: number; end: number } | null {
  const start = source.indexOf(span)
  if (start === -1) return null
  return { start, end: start + span.length }
}

/**
 * Whether the model returned the span verbatim, as instructed.
 *
 * Distinguishes "grounded and copied" from "grounded but reworded". Used for
 * the E15 message, which should tell the doctor the text was paraphrased
 * rather than implying it was invented.
 */
export function isVerbatim(source: string, span: string): boolean {
  return source.includes(span)
}

/**
 * Whether two texts are the same statement once normalised.
 *
 * Used by survival checking to decide whether a history item already covers
 * an allergy mentioned in the notes.
 */
export function sameStatement(a: string, b: string): boolean {
  return normalise(a) === normalise(b)
}
