/**
 * Stage 4 verification, end to end (BUILD_ROADMAP B5).
 *
 * The named minimum set from the roadmap, plus the severity tiers. Fixtures
 * are drawn from the golden set (SYNTHETIC_NOTES_TEST.md) so these tests and
 * the B8 eval describe the same cases.
 *
 * NO NETWORK, NO DATABASE, NO API KEY. That is the point of the whole
 * design: hallucination handling is exhaustively testable in milliseconds
 * because the layer that constrains the model is a pure function (§5.1).
 */
import { describe, expect, test } from 'bun:test'
import {
  emptyStructuredNote,
  type SourcedItem,
  type StructuredNote,
  VerificationCheck,
} from '@emr/shared'
import { buildRepairFeedback, isRepairable, verify } from './index.ts'

/** A SourcedItem, written compactly so fixtures stay readable. */
function item(text: string, sourceSpan: string): SourcedItem {
  return { text, sourceSpan }
}

/** A note with only the named fields set. */
function note(overrides: Partial<StructuredNote>): StructuredNote {
  return { ...emptyStructuredNote(), ...overrides }
}

/** The flags raised by one check. */
function flagsFor(result: ReturnType<typeof verify>, check: VerificationCheck) {
  return result.flags.filter((flag) => flag.check === check)
}

// --- N01, the brief's own worked example -----------------------------------

const N01_NOTES = `Rahul Sharma / 34 M / 12 Aug
fever since 3 days, mild cough
no breathing difficulty
took paracetamol yesterday
allergic to penicillin
advised hydration, rest
return if symptoms worsen`

const N01_CORRECT = note({
  chiefComplaint: item('Fever', 'fever since 3 days'),
  symptoms: [
    item('Fever for 3 days', 'fever since 3 days'),
    item('Mild cough', 'mild cough'),
    item('No breathing difficulty', 'no breathing difficulty'),
  ],
  relevantHistory: [item('Penicillin allergy', 'allergic to penicillin')],
  medicationsMentioned: [item('Paracetamol', 'took paracetamol yesterday')],
  doctorPlan: [
    item('Hydration', 'advised hydration'),
    item('Rest', 'rest'),
    item('Return if symptoms worsen', 'return if symptoms worsen'),
  ],
  missingInformation: ['Temperature was not recorded'],
})

describe('a correct note passes clean', () => {
  test('N01 raises no flags at all', () => {
    const result = verify(N01_NOTES, N01_CORRECT)
    expect(result.flags).toEqual([])
    expect(result.status).toBe('passed')
  })

  test('status passed means no retry is needed', () => {
    expect(isRepairable(verify(N01_NOTES, N01_CORRECT))).toBe(false)
  })
})

// --- The named minimum set from B5 -----------------------------------------

describe('E13 — invented BP is caught by numeric containment (N05)', () => {
  const notes =
    'Ramesh Iyer / 61 M\nfollow up for hypertension\nno chest pain\ncontinues amlodipine'

  test("THE BRIEF'S HEADLINE CASE: a fabricated reading is flagged", () => {
    const result = verify(
      notes,
      note({ symptoms: [item('BP 130/80', 'follow up for hypertension')] }),
    )
    const numeric = flagsFor(result, VerificationCheck.Numeric)
    expect(numeric.length).toBeGreaterThan(0)
    expect(result.status).toBe('flagged')
  })

  test('it is repairable, so the one permitted retry fires', () => {
    const result = verify(
      notes,
      note({ symptoms: [item('BP 130/80', 'follow up for hypertension')] }),
    )
    expect(isRepairable(result)).toBe(true)
  })

  test('the message names the number and is doctor-readable', () => {
    const result = verify(
      notes,
      note({ symptoms: [item('BP 130/80', 'follow up for hypertension')] }),
    )
    const [flag] = flagsFor(result, VerificationCheck.Numeric)
    expect(flag?.message).toContain('130')
    expect(flag?.message).toContain('not recorded in your notes')
  })

  test('the flag points at the exact item that carries it', () => {
    const result = verify(
      notes,
      note({
        symptoms: [
          item('No chest pain', 'no chest pain'),
          item('BP 130/80', 'follow up for hypertension'),
        ],
      }),
    )
    const [flag] = flagsFor(result, VerificationCheck.Numeric)
    expect(flag?.field).toBe('symptoms')
    expect(flag?.index).toBe(1)
  })
})

describe('E14 — an ungrounded span is flagged', () => {
  test('a span absent from the notes is caught', () => {
    const result = verify(
      N01_NOTES,
      note({ symptoms: [item('Chest pain', 'complains of chest pain')] }),
    )
    const grounding = flagsFor(result, VerificationCheck.Grounding)
    expect(grounding).toHaveLength(1)
    expect(grounding[0]?.severity).toBe('repairable')
  })

  test('the message quotes the span and is explainable to a doctor', () => {
    const result = verify(
      N01_NOTES,
      note({ symptoms: [item('Chest pain', 'complains of chest pain')] }),
    )
    expect(flagsFor(result, VerificationCheck.Grounding)[0]?.message).toBe(
      '"complains of chest pain" does not appear in your notes.',
    )
  })
})

describe('E15 — a paraphrased span matches after normalisation', () => {
  test('case and whitespace differences do not raise a flag', () => {
    const result = verify(
      N01_NOTES,
      note({ symptoms: [item('Fever for 3 days', 'Fever   Since 3 Days')] }),
    )
    expect(flagsFor(result, VerificationCheck.Grounding)).toEqual([])
  })

  test('a reworded span is soft, not repairable', () => {
    // Real, but not copied -- worth a glance, not worth a retry.
    const result = verify(
      N01_NOTES,
      note({ symptoms: [item('Fever and cough', 'fever since 3 days mild cough')] }),
    )
    const [flag] = flagsFor(result, VerificationCheck.Grounding)
    expect(flag?.severity).toBe('soft')
    expect(flag?.message).toContain('reworded')
  })
})

describe('E16 — "no cough" to "Cough" is caught by negation (N03)', () => {
  const N03_NOTES =
    'headache since 2 days, frontal\nno vomiting, no visual disturbance\nno fever\ndenies neck stiffness'

  test('THE MOST DANGEROUS CASE: grounded, and still wrong', () => {
    // The span is real, so grounding passes and numeric has nothing to say.
    const result = verify(
      N03_NOTES,
      note({ symptoms: [item('Vomiting', 'no vomiting')] }),
    )
    expect(flagsFor(result, VerificationCheck.Grounding)).toEqual([])
    expect(flagsFor(result, VerificationCheck.Negation)).toHaveLength(1)
  })

  test('the message shows the doctor both sides of the inversion', () => {
    const result = verify(
      N03_NOTES,
      note({ symptoms: [item('Vomiting', 'no vomiting')] }),
    )
    const [flag] = flagsFor(result, VerificationCheck.Negation)
    expect(flag?.message).toContain('no vomiting')
    expect(flag?.message).toContain('Vomiting')
  })

  test('it is soft, so it does not consume the retry on a word-list guess', () => {
    // The check is a word list, not clinical NLP. Spending the one
    // permitted retry on its false positives would starve real fabrications.
    const result = verify(
      N03_NOTES,
      note({ symptoms: [item('Vomiting', 'no vomiting')] }),
    )
    expect(flagsFor(result, VerificationCheck.Negation)[0]?.severity).toBe('soft')
    expect(isRepairable(result)).toBe(false)
  })

  test('N03 recorded correctly raises nothing', () => {
    const result = verify(
      N03_NOTES,
      note({
        chiefComplaint: item('Headache', 'headache since 2 days'),
        symptoms: [
          item('Frontal headache for 2 days', 'headache since 2 days, frontal'),
          item('No vomiting', 'no vomiting'),
          item('No visual disturbance', 'no visual disturbance'),
          item('No fever', 'no fever'),
          item('No neck stiffness', 'denies neck stiffness'),
        ],
      }),
    )
    expect(result.flags).toEqual([])
  })
})

describe('E17 — a dropped penicillin allergy is caught by survival (N04)', () => {
  test('THE REVERSE-DIRECTION CHECK: grounding cannot catch an omission', () => {
    const dropped = note({
      chiefComplaint: item('Fever', 'fever since 3 days'),
      symptoms: [item('Fever for 3 days', 'fever since 3 days')],
      // relevantHistory deliberately empty -- the allergy vanished.
    })
    const result = verify(N01_NOTES, dropped)

    // Everything present is perfectly grounded...
    expect(flagsFor(result, VerificationCheck.Grounding)).toEqual([])
    // ...and the omission is still caught.
    expect(flagsFor(result, VerificationCheck.Survival)).toHaveLength(1)
  })

  test('it is repairable -- a dropped allergy is unambiguous', () => {
    const result = verify(N01_NOTES, note({}))
    expect(flagsFor(result, VerificationCheck.Survival)[0]?.severity).toBe('repairable')
  })

  test('the flag attaches to relevantHistory with no index', () => {
    // There is no item to point at; the flag is about something absent.
    const result = verify(N01_NOTES, note({}))
    const [flag] = flagsFor(result, VerificationCheck.Survival)
    expect(flag?.field).toBe('relevantHistory')
    expect(flag?.index).toBeNull()
  })

  test('a surviving allergy raises nothing', () => {
    expect(flagsFor(verify(N01_NOTES, N01_CORRECT), VerificationCheck.Survival)).toEqual(
      [],
    )
  })
})

describe('E4 — empty arrays pass clean, not flagged (N06)', () => {
  const N06_NOTES =
    'Kavita Rao / 23 F\ncame for general check up\nno complaints\nno current medications\nexamination normal\nnothing advised today'

  test('an empty medicationsMentioned is a correct answer', () => {
    // N06 is the trap for padding. Verification must not push back toward it.
    const result = verify(
      N06_NOTES,
      note({
        chiefComplaint: item('General check-up', 'came for general check up'),
        symptoms: [
          item('No complaints', 'no complaints'),
          item('Examination normal', 'examination normal'),
        ],
        missingInformation: ['No vitals recorded'],
      }),
    )
    expect(result.flags).toEqual([])
    expect(result.status).toBe('passed')
  })

  test('N10: a three-word note with a nearly empty record passes', () => {
    const result = verify(
      'Arjun Nair / 19 M / 18 Aug\nfever',
      note({
        chiefComplaint: item('Fever', 'fever'),
        symptoms: [item('Fever', 'fever')],
        missingInformation: ['Duration not specified', 'Temperature not recorded'],
      }),
    )
    expect(result.flags).toEqual([])
  })

  test('a wholly empty note against empty notes passes', () => {
    expect(verify('', emptyStructuredNote()).status).toBe('passed')
  })
})

describe('E10 — "x3d" to "for 3 days" does not trip numeric (N02)', () => {
  test('stage 3 may expand the shorthand stage 1 preserved', () => {
    const result = verify(
      'C/O fever x3d\nPCM 650 BD x3d',
      note({
        symptoms: [item('Fever for 3 days', 'C/O fever x3d')],
        medicationsMentioned: [
          item('Paracetamol 650 twice daily for 3 days', 'PCM 650 BD x3d'),
        ],
      }),
    )
    expect(flagsFor(result, VerificationCheck.Numeric)).toEqual([])
  })

  test('legitimate "3 days" passes numeric containment', () => {
    const result = verify(
      'fever since 3 days',
      note({ symptoms: [item('Fever for 3 days', 'fever since 3 days')] }),
    )
    expect(flagsFor(result, VerificationCheck.Numeric)).toEqual([])
  })
})

// --- Severity tiers and the retry contract ---------------------------------

describe('severity tiers drive the status (§4.6)', () => {
  test('clean is passed', () => {
    expect(verify(N01_NOTES, N01_CORRECT).status).toBe('passed')
  })

  test('any flag makes the status flagged', () => {
    const result = verify(
      N01_NOTES,
      note({ symptoms: [item('Vomiting', 'no breathing difficulty')] }),
    )
    expect(result.status).toBe('flagged')
  })

  test('the worst severity wins', () => {
    // One repairable among several soft flags is still repairable: the
    // action to take is driven by the most serious finding.
    const result = verify(
      N01_NOTES,
      note({
        symptoms: [
          item('Breathing difficulty', 'no breathing difficulty'), // soft
          item('Chest pain', 'complains of chest pain'), // repairable
        ],
      }),
    )
    expect(isRepairable(result)).toBe(true)
  })

  test("verification never reports itself as repaired -- that is B6's to set", () => {
    // Purity: verification has no memory of previous attempts.
    expect(verify(N01_NOTES, N01_CORRECT).repaired).toBe(false)
  })
})

describe('repair feedback for the one permitted retry', () => {
  test('only repairable flags are fed back', () => {
    // Sending soft ones would ask the model to "fix" negation suspicions
    // that are usually false positives, and the likeliest repair is
    // deleting the item -- the silent data loss §4.6 forbids.
    const result = verify(
      N01_NOTES,
      note({
        symptoms: [
          item('Breathing difficulty', 'no breathing difficulty'), // soft
          item('Chest pain', 'complains of chest pain'), // repairable
        ],
      }),
    )
    const feedback = buildRepairFeedback(result)
    expect(feedback).toContain('complains of chest pain')
    expect(feedback).not.toContain('Breathing difficulty')
  })

  test('a clean result produces no feedback', () => {
    expect(buildRepairFeedback(verify(N01_NOTES, N01_CORRECT))).toBe('')
  })
})

describe('the note is never modified — flag, never silently drop', () => {
  test('verify returns flags and leaves the note untouched', () => {
    // Deleting data behind a doctor's back is worse than showing them
    // something suspect (§4.6).
    const original = note({ symptoms: [item('Vomiting', 'no vomiting')] })
    const snapshot = JSON.parse(JSON.stringify(original))
    verify('no vomiting', original)
    expect(original).toEqual(snapshot)
  })
})

describe('purity — the property that makes all of this testable', () => {
  test('the same inputs always produce the same output', () => {
    const a = verify(N01_NOTES, N01_CORRECT)
    const b = verify(N01_NOTES, N01_CORRECT)
    expect(a).toEqual(b)
  })

  test('it runs with no API key set', () => {
    // B5's done-when: the proof that this is genuinely a pure layer.
    const saved = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      expect(verify(N01_NOTES, N01_CORRECT).status).toBe('passed')
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved
    }
  })

  test('chiefComplaint null is handled, not crashed on', () => {
    expect(() => verify('fever', note({ chiefComplaint: null }))).not.toThrow()
  })

  test('a chiefComplaint flag carries a null index', () => {
    const result = verify(
      'fever',
      note({ chiefComplaint: item('Chest pain', 'chest pain') }),
    )
    const [flag] = flagsFor(result, VerificationCheck.Grounding)
    expect(flag?.field).toBe('chiefComplaint')
    expect(flag?.index).toBeNull()
  })
})
