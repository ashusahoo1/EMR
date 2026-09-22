/**
 * Text normalisation for verification comparisons (BUILD_ROADMAP B4, §4.6).
 *
 * WHY THIS EXISTS, in the plan's own words: "Normalise both sides before
 * comparing [...] or false failures will bury the real ones."
 *
 * That is the whole argument. A grounding check that fires on a curly
 * apostrophe is not a strict check, it is a broken one -- and it is worse
 * than useless, because a doctor who sees five spurious flags stops reading
 * the sixth, which was real. Precision here buys attention later.
 *
 * Pure string functions. No imports from `db/` or `llm/`, now or ever.
 *
 * Every pattern below is written with \\uXXXX escapes rather than the literal
 * characters. That is deliberate: half of these are invisible or
 * indistinguishable from ASCII on screen, so a literal would make this table
 * unreviewable and a stray edit undetectable.
 */

/**
 * Characters a phone keyboard, a word processor or a model will silently
 * substitute for their ASCII equivalents.
 *
 * Every one of these has been observed in real text. A doctor typing on iOS
 * gets curly quotes whether they want them or not, and a model echoing that
 * text back may or may not preserve them -- so a raw comparison between the
 * notes and the model's copy of the notes can fail on punctuation the human
 * never chose.
 */
const CHARACTER_SUBSTITUTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // Smart single quotes, primes and backtick -> '
  [/[‘’‚‛′´`]/g, "'"],
  // Smart double quotes -> "
  [/[“”„‟″]/g, '"'],
  // Hyphen variants, en/em dash and minus -> -
  [/[‐‑‒–—―−]/g, '-'],
  // Ellipsis -> three dots
  [/…/g, '...'],
  // Non-breaking and other exotic spaces -> a plain space.
  [/[   -   　]/g, ' '],
  // Zero-width characters, removed entirely. These are invisible, and so the
  // single most confusing way for a comparison to fail: two strings that look
  // identical on screen compare unequal with no clue why. Written as an
  // alternation rather than a character class because a class containing the
  // zero-width joiner is how emoji sequences get split apart, and the linter
  // is right to object to that pattern.
  [/​|‌|‍|﻿/g, ''],
]

/**
 * Normalise text for comparison.
 *
 * Lowercase, substitute lookalike punctuation, collapse whitespace, trim.
 * Deliberately NOT applied to anything the doctor sees -- this is a
 * comparison key, not a display form. Flag messages always quote the
 * original text, because "'BP 130/80' does not appear in your notes" is
 * only meaningful if it is the text actually on screen.
 */
export function normalise(text: string): string {
  let out = text
  for (const [pattern, replacement] of CHARACTER_SUBSTITUTIONS) {
    out = out.replace(pattern, replacement)
  }
  // Unicode NFC, so that an accented character composed two different ways
  // compares equal. Cheap, and otherwise a genuinely invisible failure.
  out = out.normalize('NFC')
  return out.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Strip punctuation as well, for the loosest comparison tier.
 *
 * Used only where a model is likely to re-punctuate while copying -- a
 * trailing comma dropped from a span, for instance. Kept separate from
 * `normalise` because discarding punctuation is a real loss of information
 * and should be an explicit decision at each call site, not the default.
 */
export function normaliseLoose(text: string): string {
  return normalise(text)
    .replace(/[.,;:!?'"()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether `needle` occurs in `haystack` after normalisation. */
export function containsNormalised(haystack: string, needle: string): boolean {
  return normalise(haystack).includes(normalise(needle))
}
