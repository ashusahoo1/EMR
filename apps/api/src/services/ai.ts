/**
 * AI endpoints -- STUBBED (BUILD_ROADMAP A8).
 *
 * These implement the real contract from Appendix 1 and return canned data.
 * Sector C can therefore be built against a stable API while Sector B is
 * still being written, and the frontend never has to be revisited when the
 * real pipeline lands at B6.
 *
 * What is deliberately NOT here yet:
 *   - any model call (B0's llm/ seam)
 *   - stage 0 image precheck (B1)
 *   - stage 4 verification (B4)
 *   - ai_generations audit rows (B6)
 *
 * What IS here and is not a stub: the LLM_ENABLED gate. That is the E23
 * graceful-degradation path, and wiring it now means the degradation story
 * is exercised from day one rather than bolted on at B7.
 */
import {
  emptyStructuredNote,
  type StructuredNote,
  type VerificationResult,
} from '@emr/shared'
import { AppError, ErrorCode } from '../errors.ts'
import { log } from '../log.ts'
import { getConsultation, updateConsultation } from './consultations.ts'

/**
 * Whether AI assistance is available.
 *
 * Read per-call rather than captured at import, so a test can flip it
 * without re-importing the module. Anything other than an explicit "false"
 * means enabled -- an unset variable should not silently disable the feature.
 */
export function isLlmEnabled(): boolean {
  return process.env.LLM_ENABLED !== 'false'
}

/**
 * Guard every AI entry point.
 *
 * The message matters as much as the status: a doctor seeing this must
 * understand they can carry on working, not that the app is broken. The
 * wording lives in errors.ts and is asserted by a test.
 */
function assertLlmAvailable(): void {
  if (!isLlmEnabled()) {
    log.warn('ai request refused: LLM_ENABLED=false')
    throw new AppError(ErrorCode.AI_UNAVAILABLE)
  }
}

/** The N01 golden-set note, exactly as SYNTHETIC_NOTES_TEST.md specifies. */
function n01Fixture(): StructuredNote {
  return {
    chiefComplaint: { text: 'Fever', sourceSpan: 'fever since 3 days' },
    symptoms: [
      { text: 'Fever for 3 days', sourceSpan: 'fever since 3 days' },
      { text: 'Mild cough', sourceSpan: 'mild cough' },
      { text: 'No breathing difficulty', sourceSpan: 'no breathing difficulty' },
    ],
    relevantHistory: [
      { text: 'Penicillin allergy', sourceSpan: 'allergic to penicillin' },
    ],
    medicationsMentioned: [
      { text: 'Paracetamol', sourceSpan: 'took paracetamol yesterday' },
    ],
    doctorPlan: [
      { text: 'Hydration', sourceSpan: 'advised hydration' },
      { text: 'Rest', sourceSpan: 'rest' },
      { text: 'Return if symptoms worsen', sourceSpan: 'return if symptoms worsen' },
    ],
    missingInformation: ['Temperature was not recorded'],
  }
}

const PASSED: VerificationResult = { status: 'passed', flags: [], repaired: false }

export interface StructureResult {
  note: StructuredNote
  verification: VerificationResult
}

/**
 * Stage 3 -- structure the stored notes (F5).
 *
 * STUB: returns the N01 fixture regardless of input. B6 replaces the body
 * with the real pipeline; the signature and the error contract stay.
 *
 * The input validation below is NOT stubbed. E1 (empty notes) and E3 (over
 * the cap) are real rules enforced server-side, and the frontend relies on
 * them, so they behave correctly now.
 */
export async function structureConsultation(
  consultationId: string,
): Promise<StructureResult> {
  assertLlmAvailable()

  const consultation = await getConsultation(consultationId)

  // E1 -- whitespace-only notes are nothing to structure. Rejecting here
  // rather than sending them to a model is also the cheap path (§4.2).
  if (consultation.rawNotes.trim().length === 0) {
    throw new AppError(ErrorCode.NOTES_EMPTY)
  }

  const note = n01Fixture()

  // Persist as aiNote, never as confirmedNote: AI output is never saved as
  // final by default (§4.7). Nothing is clinical until the doctor confirms.
  await updateConsultation(consultationId, { aiNote: note })

  log.info('structure (stubbed)', {
    consultationId,
    notesLength: consultation.rawNotes.length,
    stub: true,
  })

  return { note, verification: PASSED }
}

export interface TranscribeResult {
  text: string
  hasIllegible: boolean
}

/**
 * Stage 1 -- transcribe a photograph of handwritten notes (F8).
 *
 * STUB: returns fixed text. B1 adds the precheck, B2 the real VLM call.
 *
 * Two contract details that are real even in the stub:
 *   - the returned text lands in the doctor's editable textarea, it is never
 *     auto-structured (§4.4 -- stage 2's human checkpoint is the product)
 *   - hasIllegible tells the frontend to highlight [illegible] markers so
 *     the doctor's eye goes straight to them
 */
export async function transcribeImage(file: {
  type: string
  size: number
}): Promise<TranscribeResult> {
  assertLlmAvailable()

  // A minimal type check even in the stub: the frontend needs to see a real
  // rejection path exist. The full precheck arrives at B1.
  if (!file.type.startsWith('image/')) {
    throw new AppError(ErrorCode.INVALID_IMAGE_TYPE, {
      details: { received: file.type },
    })
  }

  const text = [
    'fever since 3 days, mild cough',
    'no breathing difficulty',
    'took paracetamol yesterday',
    'allergic to penicillin',
    'advised hydration, rest',
    'return if symptoms worsen',
  ].join('\n')

  log.info('transcribe (stubbed)', { bytes: file.size, stub: true })

  return { text, hasIllegible: text.includes('[illegible]') }
}

/** Exported for tests that need a known-good note without calling the API. */
export { emptyStructuredNote, n01Fixture }
