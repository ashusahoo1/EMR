/**
 * Span grounding and normalisation (BUILD_ROADMAP B5). E14, E15.
 *
 * Pure string functions -- no network, no mocks, milliseconds to run.
 *
 * Non-ASCII characters are written as \uXXXX escapes throughout. Several of
 * them are invisible or indistinguishable from their ASCII counterparts on
 * screen, so a literal would make these tests unreviewable and a stray edit
 * undetectable.
 */
import { describe, expect, test } from 'bun:test'
import {
  findSpanOffsets,
  GroundingMatch,
  isGrounded,
  isVerbatim,
  matchSpan,
  sameStatement,
} from './grounding.ts'
import { normalise, normaliseLoose } from './normalise.ts'

const NOTES = 'patient has fever since 3 days, mild cough\nno breathing difficulty'

describe('E14 \u2014 an ungrounded span is caught', () => {
  test('a fabricated span is not found', () => {
    expect(matchSpan(NOTES, 'BP 130/80')).toBe(GroundingMatch.None)
    expect(isGrounded(NOTES, 'BP 130/80')).toBe(false)
  })

  test('a plausible-sounding invention is still not found', () => {
    // The danger is text that READS like the notes. Nothing about
    // "complains of headache" is implausible; it is simply not there.
    expect(isGrounded(NOTES, 'complains of headache')).toBe(false)
  })

  test('an empty span grounds nothing', () => {
    // The schema forbids it, but this function must not assume the schema
    // ran first.
    expect(matchSpan(NOTES, '')).toBe(GroundingMatch.None)
    expect(matchSpan(NOTES, '   ')).toBe(GroundingMatch.None)
  })
})

describe('a real span is found', () => {
  test('an exact quote matches verbatim', () => {
    expect(matchSpan(NOTES, 'fever since 3 days')).toBe(GroundingMatch.Exact)
    expect(isVerbatim(NOTES, 'fever since 3 days')).toBe(true)
  })

  test('a span spanning a line break matches', () => {
    expect(isGrounded(NOTES, 'no breathing difficulty')).toBe(true)
  })
})

describe('E15 \u2014 paraphrased spans match after normalisation', () => {
  test('case differences do not fail a real span', () => {
    expect(matchSpan(NOTES, 'Fever Since 3 Days')).toBe(GroundingMatch.Normalised)
  })

  test('collapsed whitespace does not fail a real span', () => {
    expect(matchSpan(NOTES, 'fever   since  3   days')).toBe(GroundingMatch.Normalised)
  })

  test('a smart apostrophe does not fail a real span', () => {
    // A doctor typing on a phone gets curly quotes whether they want them or
    // not. Failing on punctuation the human never chose would bury the real
    // failures under false ones (§4.6).
    const notes = 'patient\u2019s cough is mild'
    expect(isGrounded(notes, "patient's cough is mild")).toBe(true)
  })

  test('an en dash matches a hyphen', () => {
    expect(isGrounded('fever \u2013 3 days', 'fever - 3 days')).toBe(true)
  })

  test('a non-breaking space matches a normal one', () => {
    expect(isGrounded('mild\u00A0cough', 'mild cough')).toBe(true)
  })

  test('a zero-width space does not defeat a match', () => {
    // Invisible, and therefore the most confusing way for a check to fail.
    expect(isGrounded('mild\u200Bcough', 'mildcough')).toBe(true)
  })

  test('dropped punctuation matches only at the loose tier', () => {
    // Reported separately from an exact match: the model reworded while
    // copying, which is worth a glance but is not fabrication.
    expect(matchSpan(NOTES, 'fever since 3 days mild cough')).toBe(GroundingMatch.Loose)
  })

  test('the tiers are ordered by confidence, not collapsed to a boolean', () => {
    expect(matchSpan(NOTES, 'fever since 3 days')).toBe(GroundingMatch.Exact)
    expect(matchSpan(NOTES, 'FEVER SINCE 3 DAYS')).toBe(GroundingMatch.Normalised)
    expect(matchSpan(NOTES, 'BP 130/80')).toBe(GroundingMatch.None)
  })
})

describe('normalisation is for comparison only', () => {
  test('it lowercases, folds punctuation and collapses whitespace', () => {
    expect(normalise('  Fever   SINCE\u00A03  days  ')).toBe('fever since 3 days')
  })

  test('loose normalisation additionally drops punctuation', () => {
    expect(normaliseLoose('fever, since 3 days.')).toBe('fever since 3 days')
  })

  test('NFC composition makes equivalent accents compare equal', () => {
    // e + combining acute vs the precomposed character. Otherwise a
    // genuinely invisible failure.
    expect(normalise('e\u0301')).toBe(normalise('\u00E9'))
  })
})

describe('offsets are computed from the text, never asked of the model', () => {
  test('an exact span yields its position', () => {
    // §4.5: models cannot count characters reliably, so we ask for the
    // substring and let indexOf find it.
    const offsets = findSpanOffsets(NOTES, 'fever since 3 days')
    expect(offsets).not.toBeNull()
    expect(NOTES.slice(offsets?.start, offsets?.end)).toBe('fever since 3 days')
  })

  test('a span that is not present yields null, not a guess', () => {
    expect(findSpanOffsets(NOTES, 'BP 130/80')).toBeNull()
  })

  test('a normalised-only match yields no offsets', () => {
    // Collapsing whitespace shifts every index after it, so an approximate
    // range would highlight the wrong words -- worse than highlighting none.
    expect(findSpanOffsets(NOTES, 'FEVER SINCE 3 DAYS')).toBeNull()
  })
})

describe('sameStatement compares meaning-preserving variants', () => {
  test('case and spacing differences are the same statement', () => {
    expect(sameStatement('Penicillin allergy', 'penicillin  allergy')).toBe(true)
  })

  test('different statements are not', () => {
    expect(sameStatement('Penicillin allergy', 'Sulfa allergy')).toBe(false)
  })
})
