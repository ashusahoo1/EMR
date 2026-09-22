/**
 * AI services -- now routed through the llm/ seam (B0).
 *
 * The A8 version returned a hardcoded fixture. This version calls
 * `LlmClient`, so in tests the stub answers and in production the real
 * provider does, with no branching in this file.
 *
 * Still to come:
 *   B1 -- stage 0 image precheck
 *   B2/B3 -- the actual prompts behind the seam
 *   B4 -- verification replacing the hardcoded `passed`
 *   B6 -- ai_generations audit rows and the one permitted retry
 *
 * What is already real: the LLM_ENABLED gate (E23), the empty-notes
 * rejection (E1), persisting as aiNote and never confirmedNote (§4.7), and
 * the failure taxonomy mapping from LlmFailure to error codes.
 */
import {
  emptyStructuredNote,
  ILLEGIBLE_MARKER,
  type StructuredNote,
  StructuredNote as StructuredNoteSchema,
  type VerificationResult,
} from '@emr/shared'
import { Value } from '@sinclair/typebox/value'
import { AppError, ErrorCode } from '../errors.ts'
import { getLlmClient } from '../llm/index.ts'
import { isLlmError, LlmFailure } from '../llm/types.ts'
import { log } from '../log.ts'
import { getConsultation, updateConsultation } from './consultations.ts'

/**
 * Whether AI assistance is available.
 *
 * Kept as a named export because the routes and tests both ask this
 * question; the client resolution itself lives in llm/index.ts.
 */
export function isLlmEnabled(): boolean {
  return process.env.LLM_ENABLED !== 'false'
}

/**
 * Resolve the client, or refuse with the message a doctor should see.
 *
 * The wording matters as much as the status: someone reading this must
 * understand they can carry on working, not that the app is broken (E23).
 */
function requireLlm() {
  const client = getLlmClient()
  if (!client) {
    log.warn('ai request refused: no llm client available')
    throw new AppError(ErrorCode.AI_UNAVAILABLE)
  }
  return client
}

/**
 * Map a provider failure to the API's error contract (Appendix 3).
 *
 * Each of these reaches the doctor as a different message, which is the
 * whole point: "too many requests, wait a moment" and "we could not read
 * that" are different problems with different remedies (E18, E21, E22).
 */
function translateLlmError(error: unknown): AppError {
  if (!isLlmError(error)) {
    return new AppError(ErrorCode.AI_GENERATION_FAILED)
  }

  switch (error.failure) {
    case LlmFailure.Timeout:
      return new AppError(ErrorCode.AI_TIMEOUT)
    case LlmFailure.RateLimited:
      return new AppError(ErrorCode.RATE_LIMITED)
    case LlmFailure.Unavailable:
      return new AppError(ErrorCode.AI_UNAVAILABLE)
    case LlmFailure.Refused:
      return new AppError(ErrorCode.NOT_CLINICAL_NOTES)
    case LlmFailure.BadOutput:
      return new AppError(ErrorCode.AI_GENERATION_FAILED)
    default:
      return new AppError(ErrorCode.AI_GENERATION_FAILED)
  }
}

/** Verification is hardcoded until B4 lands. */
const PASSED: VerificationResult = { status: 'passed', flags: [], repaired: false }

export interface StructureResult {
  note: StructuredNote
  verification: VerificationResult
}

/**
 * Stage 3 -- structure the stored notes (F5).
 *
 * Note the shape of the failure path: `raw` comes back as `unknown` from the
 * seam and is validated here before it can touch the database. The
 * provider's constrained decoding guarantees shape, not truth (§4.5), so
 * "the SDK said it was JSON" is not a reason to skip validation.
 */
export async function structureConsultation(
  consultationId: string,
): Promise<StructureResult> {
  const client = requireLlm()
  const consultation = await getConsultation(consultationId)

  // E1 -- whitespace-only notes are nothing to structure. Rejecting here
  // rather than sending them to a model is also the cheap path (§4.2).
  if (consultation.rawNotes.trim().length === 0) {
    throw new AppError(ErrorCode.NOTES_EMPTY)
  }

  let raw: unknown
  let model: string
  let promptVersion: string
  let latencyMs: number

  try {
    const result = await client.structureNotes({ notes: consultation.rawNotes })
    raw = result.raw
    model = result.meta.model
    promptVersion = result.meta.promptVersion
    latencyMs = result.meta.latencyMs
  } catch (error) {
    log.error('structuring call failed', {
      consultationId,
      failure: isLlmError(error) ? error.failure : 'unknown',
    })
    throw translateLlmError(error)
  }

  // Schema validation. B4 adds the grounding, numeric, negation and survival
  // checks on top of this; B6 adds the one permitted retry when they fail.
  if (!Value.Check(StructuredNoteSchema, raw)) {
    log.error('structuring returned schema-invalid output', {
      consultationId,
      model,
      promptVersion,
    })
    throw new AppError(ErrorCode.AI_GENERATION_FAILED)
  }
  const note = raw as StructuredNote

  // Persist as aiNote, never as confirmedNote: AI output is never saved as
  // final by default (§4.7). Nothing is clinical until the doctor confirms.
  await updateConsultation(consultationId, { aiNote: note })

  log.info('structured', {
    consultationId,
    notesLength: consultation.rawNotes.length,
    model,
    promptVersion,
    latencyMs,
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
 * Returns text only, and deliberately does NOT chain into structuring:
 * stage 2's human checkpoint is the entire product thesis (§4.4). The doctor
 * reads the transcript, corrects any misreads, and presses Generate.
 *
 * The image is never persisted (§2.3) -- processed in memory, only the
 * transcript is stored.
 */
export async function transcribeImage(file: {
  type: string
  size: number
  bytes: Uint8Array
}): Promise<TranscribeResult> {
  const client = requireLlm()

  // Full stage 0 precheck arrives at B1; this is the minimal guard so the
  // rejection path exists for the frontend today.
  if (!file.type.startsWith('image/')) {
    throw new AppError(ErrorCode.INVALID_IMAGE_TYPE, {
      details: { received: file.type },
    })
  }

  try {
    const result = await client.transcribeImage({
      image: file.bytes,
      mimeType: file.type,
    })

    log.info('transcribed', {
      bytes: file.size,
      chars: result.text.length,
      model: result.meta.model,
      promptVersion: result.meta.promptVersion,
      latencyMs: result.meta.latencyMs,
    })

    return {
      text: result.text,
      // Tells the frontend to highlight the markers so the doctor's eye goes
      // straight to them (§4.4).
      hasIllegible: result.text.includes(ILLEGIBLE_MARKER),
    }
  } catch (error) {
    log.error('transcription call failed', {
      bytes: file.size,
      failure: isLlmError(error) ? error.failure : 'unknown',
    })
    throw translateLlmError(error)
  }
}

export { emptyStructuredNote }
