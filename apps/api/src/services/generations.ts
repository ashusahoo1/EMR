/**
 * The AI audit trail (BUILD_ROADMAP B6, EMR_PLAN §4.8).
 *
 * Goal, stated exactly: "make it possible to answer 'what did the AI say,
 * and what did the doctor actually accept?'"
 *
 * One row per model ATTEMPT, not per consultation. Regenerating produces
 * several attempts against one visit, and a transcription plus a structuring
 * call are two generations for the same visit -- columns on `consultations`
 * cannot hold that shape, a row per attempt can (§7.3).
 *
 * TWO RULES THAT ARE EASY TO GET WRONG AND EXPENSIVE TO DISCOVER LATER.
 *
 * 1. Failures are audited too. B6 is explicit: "Write the ai_generations row
 *    EVEN WHEN verification fails -- a failed generation is exactly what an
 *    audit trail is for." An audit trail that records only successes answers
 *    the easy question and stays silent on the one that matters.
 *
 * 2. Writing the audit row must never break the request. If the insert
 *    fails, the doctor still gets their note; we log loudly and carry on.
 *    Losing an audit row is bad. Failing a clinical request because
 *    bookkeeping failed is worse, and it is precisely the kind of coupling
 *    that turns a minor database hiccup into an outage.
 */
import type { GenerationType, VerificationResult, VerificationStatus } from '@emr/shared'
import { db } from '../db/client.ts'
import { aiGenerations } from '../db/schema.ts'
import { log } from '../log.ts'

export interface RecordGenerationInput {
  /** Null for a transcription, which happens before a consultation exists. */
  consultationId: string | null
  type: GenerationType
  /** The notes sent, or a note about the image. The image itself is never
   * stored (§2.3) -- only the transcript. */
  input: string
  /** Exactly what came back, before any repair or normalisation. */
  rawOutput: unknown
  model: string
  promptVersion: string
  verification?: VerificationResult | undefined
  latencyMs?: number | undefined
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  /** Appendix 3 code, when this attempt failed. */
  errorCode?: string | undefined
}

/**
 * Write one audit row.
 *
 * Returns the row id, or null when the write itself failed -- callers
 * deliberately ignore the return value, because there is nothing useful they
 * could do with a failure that they should not already be doing.
 *
 * Not awaited-and-thrown anywhere: see rule 2 above.
 */
export async function recordGeneration(
  input: RecordGenerationInput,
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(aiGenerations)
      .values({
        consultationId: input.consultationId,
        type: input.type,
        input: input.input,
        // jsonb: `null` is a legitimate value here (a call that failed before
        // producing output), and it must survive as SQL null rather than
        // becoming the string "null".
        rawOutput: input.rawOutput ?? null,
        model: input.model,
        promptVersion: input.promptVersion,
        verificationStatus: input.verification?.status ?? null,
        // Store the flags, not just the status. Six months later "flagged"
        // alone cannot tell you whether it was a fabricated BP or a
        // re-punctuated span, and those are very different failures (§4.8).
        verificationFlags: input.verification?.flags ?? null,
        latencyMs: input.latencyMs ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        errorCode: input.errorCode ?? null,
      })
      .returning({ id: aiGenerations.id })

    return row?.id ?? null
  } catch (error) {
    // Loud, because a silently missing audit trail is the worst outcome
    // here: it looks exactly like a system that was never used.
    log.error('failed to write ai_generations row', {
      consultationId: input.consultationId,
      type: input.type,
      model: input.model,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * The verification status to record when a call never produced output.
 *
 * A provider timeout is not a verification result -- verification never ran.
 * Recording it as `failed` would conflate "the model produced something
 * wrong" with "the model produced nothing", and those need different
 * answers when you are reading the trail back.
 */
export const NO_VERIFICATION: VerificationStatus | undefined = undefined
