/**
 * Allergy survival (BUILD_ROADMAP B5). E17 -- the check nobody builds.
 *
 * Every other check asks "is the output supported by the notes?" This one
 * asks the reverse: "is what the notes said still in the output?" Grounding
 * cannot catch an omission by definition, because an omission leaves nothing
 * behind to inspect.
 */
import { describe, expect, test } from 'bun:test'
import { allergySurvived, droppedAllergies, findAllergyMentions } from './survival.ts'

const N04_NOTES =
  'Sunita Devi / 52 F / 15 Aug\nc/o burning micturition x2d\nallergic to sulfa drugs\nk/c/o hypothyroid, on thyroxine\nadvised urine culture'

describe('E17 — a dropped allergy is caught (N04)', () => {
  test('THE CASE: notes mention penicillin allergy, history omits it', () => {
    // §4.6: dropping this is arguably worse than inventing a BP. An
    // invented number looks wrong to a doctor reading it; a missing allergy
    // looks like nothing at all, until someone prescribes the drug.
    const dropped = droppedAllergies('allergic to penicillin', ['Fever for 3 days'])
    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.substance).toBe('penicillin')
  })

  test('N04: a dropped sulfa allergy is caught', () => {
    const dropped = droppedAllergies(N04_NOTES, ['Known case of hypothyroidism'])
    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.text).toContain('sulfa')
  })

  test('an empty history drops every allergy mentioned', () => {
    expect(droppedAllergies('allergic to penicillin', [])).toHaveLength(1)
  })

  test('the flag quotes what the doctor actually wrote', () => {
    // "your notes mention 'allergic to penicillin'" is actionable;
    // "an allergy may be missing" is not.
    const [mention] = droppedAllergies('allergic to penicillin', [])
    expect(mention?.text).toBe('allergic to penicillin')
  })
})

describe('a surviving allergy is not flagged', () => {
  test('N01: "allergic to penicillin" becomes "Penicillin allergy"', () => {
    // The model is explicitly asked to normalise, so a phrase comparison
    // would flag this CORRECT output. Matching is on the substance.
    expect(droppedAllergies('allergic to penicillin', ['Penicillin allergy'])).toEqual([])
  })

  test('N04: the sulfa allergy reaches the history', () => {
    expect(
      droppedAllergies(N04_NOTES, ['Sulfa drug allergy', 'Known case of hypothyroidism']),
    ).toEqual([])
  })

  test('case and word order do not matter', () => {
    expect(
      allergySurvived({ text: 'allergic to penicillin', substance: 'penicillin' }, [
        'Allergy: PENICILLIN',
      ]),
    ).toBe(true)
  })
})

describe('a denied allergy is a complete answer, not an omission', () => {
  test('"no known allergies" does not demand a history entry', () => {
    // This is a POSITIVE statement that there is nothing to carry over.
    // Flagging its absence would be a false positive on a complete note.
    expect(droppedAllergies('no known allergies', [])).toEqual([])
  })

  test('the common phrasings are all recognised', () => {
    for (const phrase of [
      'no known allergies',
      'nil allergies',
      'denies any allergy',
      'NKDA',
      'no drug allergy',
    ]) {
      expect(droppedAllergies(phrase, [])).toEqual([])
    }
  })
})

describe('finding allergy mentions in notes', () => {
  test('the shared trigger stems match every inflection', () => {
    // allerg / intoleran / reaction to -- so "allergy", "allergic" and
    // "allergies" all match without three list entries.
    expect(findAllergyMentions('allergic to penicillin')).toHaveLength(1)
    expect(findAllergyMentions('penicillin allergy')).toHaveLength(1)
    expect(findAllergyMentions('known allergies: sulfa')).toHaveLength(1)
    expect(findAllergyMentions('lactose intolerance')).toHaveLength(1)
    expect(findAllergyMentions('reaction to aspirin')).toHaveLength(1)
  })

  test('notes with no allergy mention yield none', () => {
    expect(findAllergyMentions('fever since 3 days, mild cough')).toEqual([])
  })

  test('the substance is extracted, not the scaffolding', () => {
    // "allergic to" is a preposition, not a drug.
    expect(findAllergyMentions('allergic to penicillin')[0]?.substance).toBe('penicillin')
    expect(findAllergyMentions('penicillin allergy')[0]?.substance).toBe('penicillin')
  })

  test('an unnamed substance yields null rather than a wrong guess', () => {
    // A flag naming the wrong drug is worse than one naming none.
    expect(findAllergyMentions('has a known allergy')[0]?.substance).toBeNull()
  })

  test('with no substance identified, any history allergy counts as survival', () => {
    // Weaker, but the alternative is a guess or no check at all.
    expect(
      allergySurvived({ text: 'has a known allergy', substance: null }, [
        'Drug allergy noted',
      ]),
    ).toBe(true)
    expect(
      allergySurvived({ text: 'has a known allergy', substance: null }, ['Fever']),
    ).toBe(false)
  })

  test('multiple allergies are each tracked', () => {
    const dropped = droppedAllergies('allergic to penicillin\nallergic to sulfa', [
      'Penicillin allergy',
    ])
    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.text).toContain('sulfa')
  })
})

describe('scope is deliberately narrow', () => {
  test('a legitimately summarised non-allergy fact is not flagged', () => {
    // A general completeness check would flag every legitimate
    // summarisation and drown the signal. This fires on one category where
    // silence is dangerous.
    expect(droppedAllergies('advised hydration, rest, return if worse', [])).toEqual([])
  })
})
