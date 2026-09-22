/**
 * Stage 4 verification (BUILD_ROADMAP B4, EMR_PLAN §4.6).
 *
 * THE HIGHEST-VALUE CODE IN THE PROJECT, and it contains no AI at all.
 *
 * Checking AI output with more AI is a weak answer: non-deterministic, costs
 * another call, can hallucinate its own approval, hard to unit-test, and it
 * raises the obvious question of who checks the checker. String operations
 * are deterministic, free, instant, and explainable to a doctor -- "this
 * line does not appear in your notes."
 *
 * THE SIGNATURE IS THE ARCHITECTURE:
 *
 *   verify(sourceText, note) -> VerificationResult
 *
 * No network, no database, no API key, no clock, no randomness. That purity
 * is what makes hallucination handling exhaustively testable with
 * hand-written fixtures in milliseconds (§5.1), and it is why this module
 * imports nothing from `db/` or `llm/` and never will.
 *
 * FLAG, NEVER SILENTLY DROP. Nothing in here modifies the note. Deleting
 * data behind a doctor's back is worse than showing them something suspect
 * (§4.6), so every finding becomes a flag the doctor sees and adjudicates.
 */
import {
  FlagSeverity,
  GROUNDED_FIELDS,
  type GroundedField,
  type NOTE_LIST_FIELDS,
  type SourcedItem,
  type StructuredNote,
  VerificationCheck,
  type VerificationFlag,
  type VerificationResult,
} from '@emr/shared'
import { GroundingMatch, matchSpan } from './grounding.ts'
import { looksInverted, negationPreserved } from './negation.ts'
import {
  classifyUnsupportedNumber,
  looksLikeVital,
  unsupportedNumbers,
} from './numeric.ts'
import { droppedAllergies } from './survival.ts'

export * from './grounding.ts'
export * from './negation.ts'
export * from './normalise.ts'
export * from './numeric.ts'
export * from './survival.ts'

/**
 * Cap on flags in one result.
 *
 * Matches the schema's `maxItems: 100`. A note that generates more than this
 * has failed in a way no doctor will read through item by item, and an
 * unbounded array would let a pathological model response bloat the
 * response body.
 */
const MAX_FLAGS = 100

/**
 * Verify a structured note against the text it came from.
 *
 * Pure. Same inputs, same output, always -- which is also what makes the
 * B8 eval meaningful.
 */
export function verify(sourceText: string, note: StructuredNote): VerificationResult {
  const flags: VerificationFlag[] = []

  for (const field of GROUNDED_FIELDS) {
    for (const { item, index } of itemsOf(note, field)) {
      checkGrounding(sourceText, item, field, index, flags)
      checkNumeric(sourceText, item, field, index, flags)
      checkNegation(item, field, index, flags)
    }
  }

  checkSurvival(sourceText, note, flags)

  return summarise(flags.slice(0, MAX_FLAGS))
}

/**
 * Every item of a grounded field, with its array index.
 *
 * `chiefComplaint` is a single nullable item rather than an array, so it
 * yields index null. Unifying the two shapes here keeps `verify` a flat
 * loop instead of a special case per field.
 */
function* itemsOf(
  note: StructuredNote,
  field: GroundedField,
): Generator<{ item: SourcedItem; index: number | null }> {
  if (field === 'chiefComplaint') {
    if (note.chiefComplaint !== null) yield { item: note.chiefComplaint, index: null }
    return
  }

  const list = note[field satisfies (typeof NOTE_LIST_FIELDS)[number]]
  for (const [index, item] of list.entries()) yield { item, index }
}

/**
 * Check 2 -- span grounding (E14, E15).
 *
 * A span found only after normalisation is still grounded; the model
 * paraphrased rather than copied. That is worth telling the doctor, but it
 * is not a fabrication, so it is soft rather than repairable.
 */
function checkGrounding(
  source: string,
  item: SourcedItem,
  field: GroundedField,
  index: number | null,
  flags: VerificationFlag[],
): void {
  const match = matchSpan(source, item.sourceSpan)

  if (match === GroundingMatch.Exact || match === GroundingMatch.Normalised) return

  if (match === GroundingMatch.Loose) {
    // E15 -- reworded while copying. Real, but not invented.
    flags.push({
      field,
      index,
      check: VerificationCheck.Grounding,
      severity: FlagSeverity.Soft,
      message: `"${truncate(item.text)}" was reworded rather than quoted from your notes.`,
    })
    return
  }

  // E14 -- the span is simply not in the notes.
  flags.push({
    field,
    index,
    check: VerificationCheck.Grounding,
    severity: FlagSeverity.Repairable,
    message: `"${truncate(item.sourceSpan)}" does not appear in your notes.`,
  })
}

/**
 * Check 3 -- numeric containment (E13, the brief's headline case).
 *
 * Runs on the item's TEXT, not its span. A span is quoted from the notes, so
 * by definition its numbers are grounded; the fabrication risk is in the
 * model's own wording.
 */
function checkNumeric(
  source: string,
  item: SourcedItem,
  field: GroundedField,
  index: number | null,
  flags: VerificationFlag[],
): void {
  for (const value of unsupportedNumbers(source, item.text)) {
    const severity =
      classifyUnsupportedNumber(value) === 'soft'
        ? FlagSeverity.Soft
        : FlagSeverity.Repairable

    // The wording, not the verdict, changes for vital-looking numbers.
    const message = looksLikeVital(value)
      ? `"${truncate(item.text)}" contains the measurement ${value}, which is not recorded in your notes.`
      : `"${truncate(item.text)}" contains the number ${value}, which does not appear in your notes.`

    flags.push({
      field,
      index,
      check: VerificationCheck.Numeric,
      severity,
      message,
    })
  }
}

/**
 * Check 4 -- negation preservation (E16, the most dangerous case).
 *
 * Soft, not repairable, and that is deliberate. The check is a word list,
 * not clinical NLP: it produces false positives on phrasings it cannot
 * parse, and spending the one permitted retry on them would burn the budget
 * that genuine fabrications need. The doctor sees it marked unverified,
 * which is the right handling for a suspicion.
 */
function checkNegation(
  item: SourcedItem,
  field: GroundedField,
  index: number | null,
  flags: VerificationFlag[],
): void {
  if (negationPreserved(item.sourceSpan, item.text)) return

  const inverted = looksInverted(item.sourceSpan, item.text)

  flags.push({
    field,
    index,
    check: VerificationCheck.Negation,
    severity: FlagSeverity.Soft,
    message: inverted
      ? `Your notes say "${truncate(item.sourceSpan)}" but this was recorded as "${truncate(item.text)}".`
      : `"${truncate(item.sourceSpan)}" is a negative finding; check that "${truncate(item.text)}" preserves it.`,
  })
}

/**
 * Check 5 -- allergy survival (E17, the reverse-direction check).
 *
 * Attached to `relevantHistory` with index null, because the flag is about
 * something that is NOT there -- there is no item to point at. Repairable:
 * unlike negation, a dropped allergy is unambiguous and a retry has a real
 * chance of fixing it.
 */
function checkSurvival(
  source: string,
  note: StructuredNote,
  flags: VerificationFlag[],
): void {
  const historyTexts = note.relevantHistory.map((item) => item.text)

  for (const mention of droppedAllergies(source, historyTexts)) {
    flags.push({
      field: 'relevantHistory',
      index: null,
      check: VerificationCheck.Survival,
      severity: FlagSeverity.Repairable,
      message: `Your notes mention "${truncate(mention.text)}" but it is missing from the history.`,
    })
  }
}

/**
 * Reduce flags to an overall status.
 *
 * The tiers come straight from §4.6's table. Worst severity wins: a note
 * with one repairable flag and nine soft ones is repairable, because the
 * action to take is driven by the most serious finding.
 */
function summarise(flags: VerificationFlag[]): VerificationResult {
  const hasHard = flags.some((flag) => flag.severity === FlagSeverity.Hard)
  const hasRepairable = flags.some((flag) => flag.severity === FlagSeverity.Repairable)

  const status = hasHard
    ? 'failed'
    : hasRepairable || flags.length > 0
      ? 'flagged'
      : 'passed'

  // `repaired` is set by the caller (B6) when the retry produced this
  // result. Verification itself has no memory of previous attempts, which
  // is exactly the purity that makes it testable.
  return { status, flags, repaired: false }
}

/**
 * Whether a result should trigger the one permitted retry (§4.6).
 *
 * Exported so B6 does not re-derive the rule from the flag list and drift.
 */
export function isRepairable(result: VerificationResult): boolean {
  return result.flags.some((flag) => flag.severity === FlagSeverity.Repairable)
}

/**
 * Turn flags into the correction message for the retry.
 *
 * Only repairable flags are fed back. Sending soft ones would ask the model
 * to "fix" negation suspicions that are usually false positives, and the
 * likeliest repair is deleting the item -- the exact silent data loss §4.6
 * forbids.
 */
export function buildRepairFeedback(result: VerificationResult): string {
  return result.flags
    .filter((flag) => flag.severity === FlagSeverity.Repairable)
    .map((flag) => `- ${flag.message}`)
    .join('\n')
}

/** Keep flag messages within the schema's 300-character limit. */
function truncate(text: string, max = 80): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`
}
