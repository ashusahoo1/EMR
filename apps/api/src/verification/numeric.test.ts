/**
 * Numeric containment (BUILD_ROADMAP B5). E13 -- the brief's headline case.
 *
 * Pure functions over strings. No network, no database, no API key, no
 * mocks. This is §5.1's answer to "how do you test non-deterministic AI
 * output": you do not test the model, you test the layer that constrains it.
 */
import { describe, expect, test } from 'bun:test'
import {
  classifyUnsupportedNumber,
  extractNumbers,
  looksLikeVital,
  unsupportedNumbers,
} from './numeric.ts'

describe('extracting numbers from clinical text', () => {
  test('plain digits', () => {
    expect(extractNumbers('fever since 3 days')).toEqual([3])
  })

  test('decimals', () => {
    expect(extractNumbers('weight loss 3.5 kg')).toEqual([3.5])
  })

  test('a ratio yields BOTH numbers -- the E13 case', () => {
    // If "130/80" parsed as one token, or as 130 only, a fabricated
    // diastolic would pass unnoticed.
    expect(extractNumbers('BP 130/80')).toEqual([130, 80])
  })

  test('Indian shorthand x3d (E10, N02)', () => {
    expect(extractNumbers('PCM 650 BD x3d')).toEqual([650, 3])
  })

  test('a quantity with an attached unit', () => {
    expect(extractNumbers('3kg')).toEqual([3])
  })

  test('number words', () => {
    expect(extractNumbers('fever for three days')).toEqual([3])
  })

  test('number words are matched whole, not as substrings', () => {
    // "one" inside "bone" would otherwise report the number 1, and "bone
    // pain" is not a measurement.
    expect(extractNumbers('bone pain')).toEqual([])
    expect(extractNumbers('none reported')).toEqual([])
  })

  test('text with no numbers yields none', () => {
    expect(extractNumbers('mild cough')).toEqual([])
    expect(extractNumbers('')).toEqual([])
  })
})

describe('E13 — invented vitals are caught (N05)', () => {
  const notes = 'follow up for hypertension, no chest pain, continues amlodipine'

  test('THE HEADLINE CASE: a fabricated BP is unsupported', () => {
    // N05's critical assertion: a hypertension follow-up with no reading is
    // exactly the gap a model wants to fill.
    expect(unsupportedNumbers(notes, 'BP 130/80')).toEqual([130, 80])
  })

  test('a fabricated temperature is unsupported', () => {
    expect(unsupportedNumbers(notes, 'Temperature 98.6 F')).toEqual([98.6])
  })

  test('a fabricated pulse is unsupported', () => {
    expect(unsupportedNumbers(notes, 'Pulse 72 per minute')).toEqual([72])
  })

  test('a fabricated dose is unsupported', () => {
    // The notes say "continues amlodipine" with no dose -- N05 expects that
    // absence named in missingInformation, never filled in.
    expect(unsupportedNumbers(notes, 'Amlodipine 5 mg')).toEqual([5])
  })
})

describe('legitimate numbers pass', () => {
  test('"3 days" in the notes grounds "for 3 days" in the output', () => {
    expect(unsupportedNumbers('fever since 3 days', 'Fever for 3 days')).toEqual([])
  })

  test('x3d in the notes grounds "for 3 days" in the output (E10, N02)', () => {
    // The stage 1 transcript keeps x3d verbatim; stage 3 may expand it. The
    // check must not punish the expansion it asked for.
    expect(unsupportedNumbers('PCM 650 BD x3d', 'Paracetamol 650 for 3 days')).toEqual([])
  })

  test('digits in the notes ground number words in the output', () => {
    expect(unsupportedNumbers('fever since 3 days', 'Fever for three days')).toEqual([])
  })

  test('number words in the notes ground digits in the output', () => {
    expect(unsupportedNumbers('fever since three days', 'Fever for 3 days')).toEqual([])
  })

  test('a real BP in the notes grounds a real BP in the output', () => {
    // The check is about fabrication, not about mentioning numbers at all.
    expect(unsupportedNumbers('BP 130/80 today', 'Blood pressure 130/80')).toEqual([])
  })

  test('N12: weight loss of 3 kg survives', () => {
    expect(
      unsupportedNumbers('weight loss approx 3 kg', 'Weight loss of approximately 3 kg'),
    ).toEqual([])
  })

  test('a note with no numbers and output with no numbers is clean', () => {
    expect(unsupportedNumbers('mild cough', 'Mild cough')).toEqual([])
  })
})

describe('borderline cases flag rather than fail (§4.6)', () => {
  test('small language numbers are soft, not repairable', () => {
    // "PCM BD" normalised to "twice daily" introduces a 2 the notes never
    // wrote as a digit. A flag costs a glance; a false rejection costs the
    // feature.
    expect(classifyUnsupportedNumber(2)).toBe('soft')
    expect(classifyUnsupportedNumber(1)).toBe('soft')
    expect(classifyUnsupportedNumber(0.5)).toBe('soft')
  })

  test('a fabricated measurement is repairable, not soft', () => {
    // Nothing dangerous hides behind the soft allowance: a BP, temperature
    // or dose is never 1 or 2.
    expect(classifyUnsupportedNumber(130)).toBe('repairable')
    expect(classifyUnsupportedNumber(98.6)).toBe('repairable')
    expect(classifyUnsupportedNumber(650)).toBe('repairable')
  })
})

describe('vital-looking numbers sharpen the message', () => {
  test('BP, pulse and temperature ranges are recognised', () => {
    expect(looksLikeVital(130)).toBe(true)
    expect(looksLikeVital(80)).toBe(true)
    expect(looksLikeVital(72)).toBe(true)
    expect(looksLikeVital(98.6)).toBe(true)
  })

  test('a duration is not a vital', () => {
    expect(looksLikeVital(3)).toBe(false)
  })

  test('recognition never changes the verdict, only the wording', () => {
    // Both are equally unsupported; looksLikeVital is presentational.
    expect(unsupportedNumbers('fever', 'BP 130/80')).toEqual([130, 80])
    expect(unsupportedNumbers('fever', 'seen 7 times')).toEqual([7])
  })
})

describe('duplicate reporting', () => {
  test('the same unsupported number is reported once', () => {
    expect(unsupportedNumbers('fever', 'BP 130/130')).toEqual([130])
  })
})
