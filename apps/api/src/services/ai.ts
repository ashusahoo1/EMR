/**
 * AI services -- the complete pipeline (B6).
 *
 * Routed through the llm/ seam (B0), so in tests the stub answers and in
 * production the real provider does, with no branching in this file.
 *
 * The full stage 3 path now lives here:
 *   stage 0 precheck (B1) -> transcribe (B2)          -- the /transcribe path
 *   structure (B3) -> schema-validate -> verify (B4)
 *     -> ONE retry with the errors fed back -> audit row (§4.8)
 *
 * Deliberately NOT chained: /transcribe never calls structuring. Stage 2's
 * human checkpoint is the entire product thesis (§4.4) -- the doctor reads
 * the transcript, corrects any misreads, and presses Generate themselves.
 *
 * Also real here: the LLM_ENABLED gate (E23), the empty-notes rejection
 * (E1), persisting as aiNote and never confirmedNote (§4.7), and the
 * failure taxonomy mapping from LlmFailure to error codes.
 */
import {
  emptyStructuredNote,
  GenerationType,
  ILLEGIBLE_MARKER,
  PROMPT_VERSION,
  type StructuredNote,
  StructuredNote as StructuredNoteSchema,
  type VerificationResult,
} from '@emr/shared'
import { Value } from '@sinclair/typebox/value'
import { AppError, ErrorCode } from '../errors.ts'
import { getLlmClient } from '../llm/index.ts'
import { type CallMeta, isLlmError, type LlmClient, LlmFailure } from '../llm/types.ts'
import { log } from '../log.ts'
import { buildRepairFeedback, isRepairable, verify } from '../verification/index.ts'
import { getConsultation, updateConsultation } from './consultations.ts'
import { recordGeneration } from './generations.ts'
import { precheckImage } from './upload.ts'

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

export interface StructureResult {
  note: StructuredNote
  verification: VerificationResult
}

/** One attempt at the model, with everything the audit trail needs. */
interface Attempt {
  raw: unknown
  meta: CallMeta
}

/**
 * Call the model once and validate the shape of what comes back.
 *
 * Separated from the orchestration below so the retry is a second CALL, not
 * a second code path -- the alternative is two nearly-identical blocks that
 * drift apart the first time one of them is edited.
 */
async function attemptStructure(
  client: LlmClient,
  notes: string,
  repairFeedback?: string,
): Promise<Attempt> {
  const result =
    repairFeedback === undefined
      ? await client.structureNotes({ notes })
      : await client.structureNotes({ notes, repairFeedback })

  return { raw: result.raw, meta: result.meta }
}

/**
 * Stage 3 -- structure the stored notes (F5), verify them, retry once.
 *
 *   load consultation
 *     -> llm.structureNotes(rawNotes)
 *     -> parse + schema-validate
 *     -> verify(rawNotes, note)
 *     -> if repairable: ONE retry with errors fed back, re-verify
 *     -> write an ai_generations row
 *     -> return { note, verification }
 *
 * ONE RETRY, NEVER A LOOP (§4.6). Unbounded retries burn cost and latency
 * and rarely converge, and `LIMITS.maxRetries` is a constant rather than a
 * variable for the same reason: this is a policy, not a tuning knob.
 *
 * FLAG, NEVER SILENTLY DROP. Nothing here removes a flagged item. A note
 * that fails verification twice is still returned, with its flags, for the
 * doctor to adjudicate -- deleting data behind their back is worse than
 * showing them something suspect.
 */
export async function structureConsultation(
  consultationId: string,
): Promise<StructureResult> {
  const client = requireLlm()
  const consultation = await getConsultation(consultationId)
  const notes = consultation.rawNotes

  // E1 -- whitespace-only notes are nothing to structure. Rejecting here
  // rather than sending them to a model is also the cheap path (§4.2).
  if (notes.trim().length === 0) {
    throw new AppError(ErrorCode.NOTES_EMPTY)
  }

  let attempt: Attempt
  try {
    attempt = await attemptStructure(client, notes)
  } catch (error) {
    // The call never produced output, so there is no verification result --
    // but the attempt still happened and the trail must say so (§4.8).
    const appError = translateLlmError(error)
    await recordGeneration({
      consultationId,
      type: GenerationType.Structuring,
      input: notes,
      rawOutput: null,
      model: isLlmError(error) ? (error.meta?.model ?? 'unknown') : 'unknown',
      promptVersion: PROMPT_VERSION.structuring,
      errorCode: appError.code,
    })
    log.error('structuring call failed', {
      consultationId,
      failure: isLlmError(error) ? error.failure : 'unknown',
    })
    throw appError
  }

  let checked = checkAttempt(notes, attempt)
  let repaired = false

  /**
   * The one permitted retry.
   *
   * Fires for a schema-invalid response (E11) and for repairable
   * verification flags (E13, E14, E17) -- both are cases where telling the
   * model precisely what was wrong has a real chance of fixing it. Soft
   * flags never trigger it: they are usually false positives from a word
   * list, and asking the model to "fix" one invites it to delete the item.
   */
  if (checked.shouldRetry) {
    log.info('structuring: retrying once with feedback', {
      consultationId,
      reason: checked.retryReason,
    })

    try {
      const second = await attemptStructure(client, notes, checked.feedback)
      const secondChecked = checkAttempt(notes, second)

      // Keep the retry's result only if it is genuinely no worse. A second
      // attempt that comes back schema-invalid is a regression, and falling
      // back to the first response beats handing the doctor nothing.
      if (secondChecked.note !== null) {
        attempt = second
        checked = secondChecked
        repaired = true
      } else {
        log.warn('structuring retry produced invalid output; keeping first attempt', {
          consultationId,
        })
      }
    } catch (error) {
      // E19 -- the retry itself failed. Stop at one; do not escalate the
      // whole request to an error when the first attempt is usable.
      log.warn('structuring retry failed; keeping first attempt', {
        consultationId,
        failure: isLlmError(error) ? error.failure : 'unknown',
      })
    }
  }

  const note = checked.note
  const verification: VerificationResult =
    note === null
      ? // E11 -- unparseable or schema-invalid after the retry. Hard failure:
        // never saved as partial data.
        { status: 'failed', flags: checked.flags, repaired }
      : { ...checked.verification, repaired }

  // Written BEFORE the throw below, because a failed generation is exactly
  // what an audit trail is for (B6).
  await recordGeneration({
    consultationId,
    type: GenerationType.Structuring,
    input: notes,
    rawOutput: attempt.raw,
    model: attempt.meta.model,
    promptVersion: attempt.meta.promptVersion,
    verification,
    latencyMs: attempt.meta.latencyMs,
    inputTokens: attempt.meta.inputTokens,
    outputTokens: attempt.meta.outputTokens,
  })

  if (note === null) {
    log.error('structuring returned schema-invalid output', {
      consultationId,
      model: attempt.meta.model,
      promptVersion: attempt.meta.promptVersion,
      repaired,
    })
    throw new AppError(ErrorCode.AI_GENERATION_FAILED)
  }

  // Persist as aiNote, never as confirmedNote: AI output is never saved as
  // final by default (§4.7). Nothing is clinical until the doctor confirms.
  await updateConsultation(consultationId, { aiNote: note })

  log.info('structured', {
    consultationId,
    notesLength: notes.length,
    model: attempt.meta.model,
    promptVersion: attempt.meta.promptVersion,
    latencyMs: attempt.meta.latencyMs,
    verification: verification.status,
    flags: verification.flags.length,
    repaired,
  })

  return { note, verification }
}

/** A validated-and-verified attempt, plus whether it warrants the retry. */
interface CheckedAttempt {
  /** Null when the output was unparseable or schema-invalid (E11, E12). */
  note: StructuredNote | null
  verification: VerificationResult
  flags: VerificationResult['flags']
  shouldRetry: boolean
  retryReason: string
  feedback: string
}

/**
 * Schema-validate then verify one attempt.
 *
 * The order matters: verification assumes a well-formed note, so schema
 * validation has to come first and short-circuit. `raw` arrives as `unknown`
 * from the seam precisely so this step cannot be skipped -- the provider's
 * constrained decoding guarantees shape, not truth (§4.5), and "the SDK said
 * it was JSON" is not a reason to trust it into the database.
 */
function checkAttempt(notes: string, attempt: Attempt): CheckedAttempt {
  if (!Value.Check(StructuredNoteSchema, attempt.raw)) {
    // E11/E12 -- malformed, truncated, or carrying keys the contract forbids.
    return {
      note: null,
      verification: { status: 'failed', flags: [], repaired: false },
      flags: [],
      shouldRetry: true,
      retryReason: 'schema-invalid',
      feedback: SCHEMA_REPAIR_FEEDBACK,
    }
  }

  const note = attempt.raw as StructuredNote
  const verification = verify(notes, note)

  return {
    note,
    verification,
    flags: verification.flags,
    shouldRetry: isRepairable(verification),
    retryReason: 'verification',
    feedback: buildRepairFeedback(verification),
  }
}

/**
 * Feedback for a schema-invalid response.
 *
 * Deliberately does not restate the whole schema: strict decoding already
 * carries it, so a failure here means something went wrong that repeating
 * the schema will not fix. Naming the likely causes is more useful.
 */
const SCHEMA_REPAIR_FEEDBACK = [
  '- Your previous response did not match the required structure.',
  '- Return every field, use null for chiefComplaint if there is no stated reason for the visit, and use [] for empty lists.',
  '- Do not add any field that is not in the schema.',
].join('\n')

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
  /**
   * Stage 0 BEFORE the client is resolved, deliberately.
   *
   * A bad image should be rejected on its own merits, not reported as "AI
   * unavailable" because the key happens to be missing. It also means a
   * rejected upload costs nothing at all -- no client construction, no call.
   */
  const checked = precheckImage({ bytes: file.bytes, declaredType: file.type })

  const client = requireLlm()

  try {
    const result = await client.transcribeImage({
      image: checked.bytes,
      // The type the BYTES are, not the one the upload claimed.
      mimeType: checked.mimeType,
    })

    /**
     * consultationId is null, and that is correct rather than a gap.
     *
     * Transcription happens BEFORE the doctor has committed to a
     * consultation -- they upload a photo, read the transcript, correct it,
     * and only then press Generate. An audit row with no parent is still
     * worth keeping, which is why the column is nullable (§7.3).
     *
     * No verification either: stage 4 grounds a structured note against its
     * source text, and a transcript IS the source text. There is nothing
     * behind it to check against.
     */
    await recordGeneration({
      consultationId: null,
      type: GenerationType.Transcription,
      // The image is never stored (§2.3), so the input is described rather
      // than captured. Bytes would mean object storage, a lifecycle policy
      // and a far larger data-protection footprint.
      input: `image/${checked.mimeType} ${checked.info.width}x${checked.info.height} ${file.size} bytes`,
      rawOutput: result.text,
      model: result.meta.model,
      promptVersion: result.meta.promptVersion,
      latencyMs: result.meta.latencyMs,
      inputTokens: result.meta.inputTokens,
      outputTokens: result.meta.outputTokens,
    })

    log.info('transcribed', {
      bytes: file.size,
      chars: result.text.length,
      model: result.meta.model,
      promptVersion: result.meta.promptVersion,
      latencyMs: result.meta.latencyMs,
      illegible: result.text.includes(ILLEGIBLE_MARKER),
    })

    return {
      text: result.text,
      // Tells the frontend to highlight the markers so the doctor's eye goes
      // straight to them (§4.4).
      hasIllegible: result.text.includes(ILLEGIBLE_MARKER),
    }
  } catch (error) {
    const appError = translateLlmError(error)

    // Failures are audited too (B6) -- a refusal on a selfie (E34) is
    // exactly the kind of thing you want a record of.
    await recordGeneration({
      consultationId: null,
      type: GenerationType.Transcription,
      input: `image/${checked.mimeType} ${checked.info.width}x${checked.info.height} ${file.size} bytes`,
      rawOutput: null,
      model: isLlmError(error) ? (error.meta?.model ?? 'unknown') : 'unknown',
      promptVersion: PROMPT_VERSION.transcription,
      errorCode: appError.code,
    })

    log.error('transcription call failed', {
      bytes: file.size,
      failure: isLlmError(error) ? error.failure : 'unknown',
    })
    throw appError
  }
}

export { emptyStructuredNote }
