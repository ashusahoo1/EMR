/**
 * Allergy survival (BUILD_ROADMAP B4, §4.6 check 5). Catches E17.
 *
 * THE REVERSE-DIRECTION CHECK, and the one people never build.
 *
 * Every other check in this directory asks "is what the model produced
 * supported by the notes?" This one asks the opposite: "is what the notes
 * said still in the output?" Grounding, numeric containment and negation
 * all validate what is PRESENT; none of them can catch an omission, because
 * an omission leaves nothing behind to inspect.
 *
 * And the omission that matters most is an allergy. §4.6: "Dropping
 * 'allergic to penicillin' is arguably worse than inventing a BP" -- an
 * invented number looks wrong to a doctor reading it, while a missing
 * allergy looks like nothing at all, right up until someone prescribes the
 * drug.
 *
 * Scoped deliberately to allergies rather than "everything in the notes".
 * A general completeness check would flag every legitimate summarisation and
 * drown the signal; this fires on one category where silence is dangerous.
 *
 * Pure functions. No imports from `db/` or `llm/`.
 */
import { ALLERGY_TRIGGERS } from '@emr/shared'
import { normalise } from './normalise.ts'

/**
 * A sentence or clause from the notes that mentions an allergy.
 *
 * The clause is kept, not just a boolean, because the flag message should
 * quote what the doctor wrote: "your notes mention 'allergic to penicillin'
 * but it is not in the history" is actionable in a way that "an allergy may
 * be missing" is not.
 */
export interface AllergyMention {
  /** The clause as it appears in the notes, trimmed. */
  text: string
  /** The substance, where one could be identified. Null when unclear. */
  substance: string | null
}

/**
 * Split notes into clauses for scanning.
 *
 * Handwritten OPD notes are line-oriented and comma-heavy rather than
 * sentence-structured, so splitting on newlines and commas matches how they
 * are actually written. Semicolons and full stops are included for typed
 * input.
 */
function toClauses(text: string): string[] {
  return text
    .split(/[\n\r;.,]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
}

/**
 * Words that follow an allergy trigger without naming a substance.
 *
 * "allergic to" is a preposition, not a drug. Filtering these out is what
 * lets `substance` be null rather than confidently wrong -- and a flag that
 * names the wrong drug is worse than one that names none.
 */
const NON_SUBSTANCE_WORDS = new Set([
  'to',
  'of',
  'with',
  'any',
  'no',
  'known',
  'history',
  'h/o',
  'the',
  'a',
  'an',
  'and',
  'or',
  'patient',
  'pt',
  'is',
  'was',
  'has',
  'had',
  'reaction',
  'allergy',
  'allergic',
  'allergies',
  'intolerant',
  'intolerance',
])

/**
 * Find allergy mentions in the doctor's notes.
 *
 * Uses the shared ALLERGY_TRIGGERS stems (`allerg`, `intoleran`,
 * `reaction to`) so that "allergy", "allergic" and "allergies" all match
 * without three entries.
 */
export function findAllergyMentions(source: string): AllergyMention[] {
  const mentions: AllergyMention[] = []

  for (const clause of toClauses(source)) {
    const haystack = normalise(clause)
    const triggered = ALLERGY_TRIGGERS.some((trigger) => haystack.includes(trigger))
    if (!triggered) continue

    // "no known allergies" / "nil allergies" is a POSITIVE statement that
    // there is nothing to carry over. Flagging its absence from
    // relevantHistory would be a false positive on a note that is complete.
    if (isDeniedAllergy(haystack)) continue

    mentions.push({ text: clause, substance: extractSubstance(haystack) })
  }

  return mentions
}

/** Whether the clause states that there are NO allergies. */
function isDeniedAllergy(normalisedClause: string): boolean {
  return /\b(?:no|nil|denies|denied|without|nkda|none)\b/.test(normalisedClause)
}

/**
 * Pull the substance out of an allergy clause, if one is named.
 *
 * Takes the first word that is not scaffolding. Returns null rather than
 * guessing when nothing qualifies -- see NON_SUBSTANCE_WORDS.
 */
function extractSubstance(normalisedClause: string): string | null {
  const words = normalisedClause.split(/[^a-z0-9/-]+/).filter((word) => word.length > 0)

  for (const word of words) {
    if (NON_SUBSTANCE_WORDS.has(word)) continue
    if (ALLERGY_TRIGGERS.some((trigger) => word.includes(trigger))) continue
    if (word.length < 3) continue
    return word
  }

  return null
}

/**
 * Whether an allergy mention survived into the structured history.
 *
 * Matches on the SUBSTANCE rather than the phrasing, because the model is
 * explicitly asked to normalise: "allergic to penicillin" legitimately
 * becomes "Penicillin allergy", and a phrase comparison would flag that
 * correct output. The substance is the part that must not vanish.
 *
 * Where no substance could be identified, falls back to asking whether the
 * history mentions an allergy at all -- weaker, but the alternative is
 * either a guess or no check.
 */
export function allergySurvived(
  mention: AllergyMention,
  historyTexts: string[],
): boolean {
  const history = historyTexts.map(normalise)

  if (mention.substance !== null) {
    const substance = mention.substance
    return history.some((item) => item.includes(substance))
  }

  return history.some((item) =>
    ALLERGY_TRIGGERS.some((trigger) => item.includes(trigger)),
  )
}

/**
 * Allergy mentions in the notes that did not reach `relevantHistory`.
 *
 * The entire point of this module, in one call.
 */
export function droppedAllergies(
  source: string,
  historyTexts: string[],
): AllergyMention[] {
  return findAllergyMentions(source).filter(
    (mention) => !allergySurvived(mention, historyTexts),
  )
}
