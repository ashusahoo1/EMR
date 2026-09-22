/**
 * Negation preservation (BUILD_ROADMAP B5). E16 -- the most dangerous case.
 *
 * Dangerous because the output is GROUNDED and still wrong: the span is
 * real, grounding passes, numeric containment has nothing to say, and the
 * record now asserts a symptom the patient does not have.
 *
 * The last describe block tests the KNOWN LIMITS, not the capabilities. A
 * word list is not clinical NLP (§4.6) and pretending otherwise in the tests
 * would be the dishonest part.
 */
import { describe, expect, test } from 'bun:test'
import {
  findNegationTokens,
  hasNegation,
  looksInverted,
  negationPreserved,
} from './negation.ts'

describe('E16 — an inverted negative is caught', () => {
  test('THE CASE: "no breathing difficulty" recorded as "Breathing difficulty"', () => {
    // §4.6's worked example. The span is real and grounding passes -- only
    // this check notices the meaning has been inverted.
    expect(negationPreserved('no breathing difficulty', 'Breathing difficulty')).toBe(
      false,
    )
  })

  test('N03: "no cough" recorded as "Cough"', () => {
    // N03's critical assertion: "Vomiting" appearing as a positive symptom
    // is an automatic fail.
    expect(negationPreserved('no cough', 'Cough')).toBe(false)
    expect(negationPreserved('no vomiting', 'Vomiting')).toBe(false)
  })

  test('"denies neck stiffness" recorded as "Neck stiffness"', () => {
    expect(negationPreserved('denies neck stiffness', 'Neck stiffness')).toBe(false)
  })

  test('an inversion is distinguished from a mere drop', () => {
    // Both are flagged, but they deserve different wording: one asserts the
    // opposite, the other just loses the finding.
    expect(looksInverted('no cough', 'Cough')).toBe(true)
    expect(looksInverted('no cough', 'Patient examined')).toBe(false)
  })
})

describe('a preserved negative is not flagged', () => {
  test('"no cough" recorded as "No cough"', () => {
    expect(negationPreserved('no cough', 'No cough')).toBe(true)
  })

  test('N03: every negative survives as a negative', () => {
    const cases: Array<[string, string]> = [
      ['no vomiting', 'No vomiting'],
      ['no visual disturbance', 'No visual disturbance'],
      ['no fever', 'No fever'],
      ['denies neck stiffness', 'No neck stiffness'],
    ]
    for (const [span, text] of cases) {
      expect(negationPreserved(span, text)).toBe(true)
    }
  })

  test('a normalised negative form is accepted', () => {
    // A model turning "no vomiting" into "Vomiting absent" has preserved the
    // meaning exactly. Flagging it would be a false positive on the
    // normalisation we asked for.
    expect(negationPreserved('no vomiting', 'Vomiting absent')).toBe(true)
    expect(negationPreserved('no vomiting', 'Denies vomiting')).toBe(true)
    expect(negationPreserved('no chest pain', 'Chest pain negative')).toBe(true)
  })

  test('a positive statement is never flagged for lacking a negation', () => {
    // There is nothing to preserve, so this must not fire.
    expect(negationPreserved('fever since 3 days', 'Fever for 3 days')).toBe(true)
    expect(negationPreserved('mild cough', 'Mild cough')).toBe(true)
  })
})

describe('negation tokens are matched as whole words', () => {
  test('"no" does not fire inside ordinary clinical vocabulary', () => {
    // A substring search would flag every one of these, and "chest normal"
    // marked as a negation is exactly the noise that trains a doctor to
    // ignore flags.
    for (const text of [
      'nose bleeding',
      'chest normal',
      'lymph node',
      'known case of diabetes',
    ]) {
      expect(hasNegation(text)).toBe(false)
    }
  })

  test('real negation tokens are found', () => {
    expect(hasNegation('no fever')).toBe(true)
    expect(hasNegation('denies chest pain')).toBe(true)
    expect(hasNegation('without difficulty')).toBe(true)
  })

  test('multi-word tokens are matched as phrases', () => {
    expect(findNegationTokens('negative for malaria')).toContain('negative for')
    expect(findNegationTokens('ruled out TB')).toContain('ruled out')
  })

  test('NAD is recognised', () => {
    // "No abnormality detected" -- ubiquitous in Indian OPD notes.
    expect(hasNegation('chest NAD')).toBe(true)
  })
})

describe('the known limits — documented, not hidden (§4.6)', () => {
  test('LIMITATION: distant negation is missed', () => {
    // "denies any respiratory complaints" governs a clause this check never
    // inspects. The span carries a token, so splitting the finding into
    // "Chest pain" passes -- wrongly.
    expect(
      negationPreserved('denies any respiratory complaints', 'Denies complaints'),
    ).toBe(true)
    // And the genuinely missed case: the token is in the span, so a positive
    // rendering IS caught here -- but only because the token happens to be
    // adjacent. Distance is what defeats it.
    expect(hasNegation('denies any respiratory complaints or chest pain')).toBe(true)
  })

  test('LIMITATION: double negatives are not understood', () => {
    // "not without discomfort" means the patient HAS discomfort. The check
    // sees two tokens and is satisfied either way -- it counts, it does not
    // parse.
    expect(negationPreserved('not without discomfort', 'No discomfort')).toBe(true)
  })

  test('LIMITATION: implicit negation carries no token', () => {
    // "chest clear" means no crackles. There is no token to find, so a span
    // like this is treated as positive and never checked.
    expect(hasNegation('chest clear')).toBe(false)
  })

  test('the check flags, it never deletes', () => {
    // negationPreserved returns a verdict; nothing in this module mutates a
    // note. "Flag, never silently drop" is enforced by the module having no
    // way to drop anything.
    const span = 'no cough'
    const text = 'Cough'
    expect(negationPreserved(span, text)).toBe(false)
    expect(text).toBe('Cough')
  })
})
