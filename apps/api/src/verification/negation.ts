/**
 * Negation preservation (BUILD_ROADMAP B4, §4.6 check 4). Catches E16.
 *
 * THE MOST DANGEROUS CASE, because the output is grounded and still wrong:
 *
 *   notes:  "no breathing difficulty"
 *   output: { text: "Breathing difficulty",
 *             sourceSpan: "no breathing difficulty" }
 *
 * The span is real. Grounding passes. Numeric containment has nothing to
 * say. Only this check notices that the meaning has been inverted -- and an
 * inverted negative is not a cosmetic error, it is a symptom the patient
 * does not have entering their record.
 *
 * BE HONEST ABOUT WHAT THIS IS. A word list, not clinical NLP, and §4.6 is
 * emphatic that it "should not be presented as such". It misses:
 *
 *   - distant negation   "denies any respiratory complaints or chest pain"
 *                        (the negation governs a clause we never inspect)
 *   - double negatives   "not without discomfort"
 *   - implicit negation  "chest clear" means no crackles, with no token
 *
 * It catches the common dangerous case cheaply, and it FLAGS rather than
 * deletes. That combination is what makes a crude check defensible: the
 * cost of a false positive is a glance, and the doctor remains the arbiter.
 * The documented escalation -- worth stating, not worth building here -- is
 * to run a model ONLY on items this check marks ambiguous, so AI becomes the
 * fallback for a handful of edge cases rather than the primary gate.
 *
 * Pure functions. No imports from `db/` or `llm/`.
 */
import { NEGATION_TOKENS } from '@emr/shared'
import { normalise } from './normalise.ts'

/**
 * Whether a text carries a negation token.
 *
 * Matched on WORD BOUNDARIES, which is not a detail. A substring search for
 * "no" fires on "nose", "normal", "node" and "known" -- all of which are
 * ordinary clinical vocabulary, and "chest normal" flagged as a negation
 * would be precisely the noise that trains a doctor to ignore flags.
 *
 * `negative for` and `ruled out` are multi-word, so the pattern is built per
 * token rather than tokenising the text.
 */
export function hasNegation(text: string): boolean {
  return findNegationTokens(text).length > 0
}

/** Which negation tokens occur, for the message the doctor reads. */
export function findNegationTokens(text: string): string[] {
  const haystack = normalise(text)
  const found: string[] = []

  for (const token of NEGATION_TOKENS) {
    // Escape nothing: every token is plain lowercase letters and spaces.
    // \b at both ends gives whole-word matching for single words and whole
    // phrase matching for "negative for" / "ruled out".
    const pattern = new RegExp(`\\b${token}\\b`)
    if (pattern.test(haystack)) found.push(token)
  }

  return found
}

/**
 * Whether a negated span survived as a negative in the output text.
 *
 * The rule §4.6 states: if the span contains a negation token but the output
 * text does not preserve a negative, flag it.
 *
 * Returns true when there is nothing to preserve, so a positive statement is
 * never flagged for lacking a negation it never had.
 */
export function negationPreserved(span: string, text: string): boolean {
  if (!hasNegation(span)) return true
  return hasNegation(text) || hasImplicitNegative(text)
}

/**
 * Negative forms that carry no token from the list.
 *
 * A model normalising "no vomiting" to "Vomiting absent" or "Denies
 * vomiting" has preserved the meaning perfectly, and flagging it would be a
 * false positive on exactly the behaviour we asked for. `absent` and
 * `denies` are already in NEGATION_TOKENS; these are the affixed forms a
 * word list cannot see.
 *
 * Kept narrow. Every pattern here weakens the check slightly, so each one
 * has to earn its place by being a normalisation a careful model actually
 * produces.
 */
function hasImplicitNegative(text: string): boolean {
  const haystack = normalise(text)
  return /\b(?:negative|unremarkable|nil|none|free of|clear of|rules? out|ruled out)\b/.test(
    haystack,
  )
}

/**
 * Whether the output appears to INVERT the span, rather than merely drop the
 * negation.
 *
 * Distinguishes two failures that deserve different wording:
 *
 *   span "no cough" -> text "Cough"              inverted: the record now
 *                                                asserts the opposite
 *   span "no cough" -> text "Patient examined"   dropped: the negative is
 *                                                gone but nothing false was
 *                                                asserted in its place
 *
 * Detected by checking whether the span's content words survive WITHOUT
 * their negation. Both are flagged either way -- this only sharpens the
 * message, and the severity is the same.
 */
export function looksInverted(span: string, text: string): boolean {
  if (!hasNegation(span)) return false
  if (hasNegation(text) || hasImplicitNegative(text)) return false

  const tokens = new Set<string>(NEGATION_TOKENS)
  const contentWords = normalise(span)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !tokens.has(word))

  if (contentWords.length === 0) return false

  const haystack = normalise(text)
  return contentWords.some((word) => haystack.includes(word))
}
