/**
 * The real OpenAI implementation of the seam (B0).
 *
 * This is the ONLY file in the project that imports the OpenAI SDK. If that
 * stops being true, the seam has leaked and the tests are coupled to the
 * vendor again.
 *
 * The prompts themselves land at B2 (transcription) and B3 (structuring).
 * What this step establishes is the wiring around them: timeouts, token
 * accounting, and the mapping from provider failures to LlmFailure, all of
 * which are the same regardless of what the prompt says.
 */
import { LIMITS, PROMPT_VERSION } from '@emr/shared'
import OpenAI from 'openai'
import { log } from '../log.ts'
import {
  type CallMeta,
  type LlmClient,
  LlmError,
  LlmFailure,
  type StructureInput,
  type StructureOutput,
  type TranscribeInput,
  type TranscribeOutput,
} from './types.ts'

/**
 * Output-length sanity bound for stage 1 (E36).
 *
 * A transcript wildly disproportionate to the image means the model is
 * GENERATING rather than READING -- §4.3 says treat that as failure, not as
 * a result. A handwritten OPD note is a few hundred characters; 20k is not a
 * long note, it is a hallucinating model.
 */
const MAX_TRANSCRIPT_CHARS = 20_000

export interface OpenAiClientOptions {
  apiKey: string
  visionModel: string
  textModel: string
  timeoutMs?: number
}

export class OpenAiClient implements LlmClient {
  private readonly client: OpenAI
  private readonly visionModel: string
  private readonly textModel: string
  private readonly timeoutMs: number

  constructor(options: OpenAiClientOptions) {
    this.visionModel = options.visionModel
    this.textModel = options.textModel
    this.timeoutMs = options.timeoutMs ?? LIMITS.llmTimeoutMs

    this.client = new OpenAI({
      apiKey: options.apiKey,
      // E22 -- every call is bounded. The SDK also retries by default, which
      // would multiply the wall-clock wait past our own budget; §4.6 is
      // explicit that retry policy is ours to own, so we disable theirs.
      timeout: this.timeoutMs,
      maxRetries: 0,
    })
  }

  /**
   * Stage 1 -- transcription (§4.3).
   *
   * The prompt arrives at B2. Until then this throws rather than sending a
   * half-specified instruction to a model: a placeholder prompt would produce
   * plausible-looking output that silently violates the [illegible] rule,
   * which is exactly the failure mode the rule exists to prevent.
   */
  async transcribeImage(_input: TranscribeInput): Promise<TranscribeOutput> {
    throw new LlmError(
      LlmFailure.Unavailable,
      'Transcription prompt not yet implemented (lands at B2).',
    )
  }

  /**
   * Stage 3 -- structuring (§4.5).
   *
   * The prompt and the strict-output schema arrive at B3, for the same
   * reason as above.
   */
  async structureNotes(_input: StructureInput): Promise<StructureOutput> {
    throw new LlmError(
      LlmFailure.Unavailable,
      'Structuring prompt not yet implemented (lands at B3).',
    )
  }

  /** Exposed for B2/B3 to build on; kept here so the SDK stays in one file. */
  protected get sdk(): OpenAI {
    return this.client
  }

  protected get models(): { vision: string; text: string } {
    return { vision: this.visionModel, text: this.textModel }
  }
}

/**
 * Map a provider error onto the failure taxonomy.
 *
 * Exported and tested independently: this mapping decides which message the
 * doctor sees, and getting "rate limited" confused with "broken" is exactly
 * the generic-failure problem E21 warns about.
 */
export function classifyOpenAiError(error: unknown): LlmFailure {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 429) return LlmFailure.RateLimited
    if (error.status === 401 || error.status === 403) return LlmFailure.Unavailable
    if (error.status !== undefined && error.status >= 500) return LlmFailure.Unavailable
  }

  // The SDK's own timeout, and AbortController aborts.
  const name = (error as { name?: string } | null)?.name
  if (name === 'APIConnectionTimeoutError' || name === 'AbortError') {
    return LlmFailure.Timeout
  }

  if (error instanceof OpenAI.APIConnectionError) return LlmFailure.Unavailable

  return LlmFailure.BadOutput
}

/** Build CallMeta from a response, tolerating a provider that omits usage. */
export function buildMeta(input: {
  model: string
  promptVersion: string
  startedAt: number
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}): CallMeta {
  return {
    model: input.model,
    promptVersion: input.promptVersion,
    latencyMs: Date.now() - input.startedAt,
    inputTokens: input.usage?.prompt_tokens ?? 0,
    outputTokens: input.usage?.completion_tokens ?? 0,
  }
}

/**
 * E36 -- reject output disproportionate to its input.
 *
 * Returns the text unchanged, or throws. A separate function so B2 can call
 * it and B5 can test it without a network.
 */
export function assertTranscriptPlausible(text: string, meta: CallMeta): string {
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    log.warn('transcript rejected as runaway output', {
      chars: text.length,
      limit: MAX_TRANSCRIPT_CHARS,
      model: meta.model,
    })
    throw new LlmError(
      LlmFailure.BadOutput,
      'The transcription was far longer than the image could contain.',
      { meta },
    )
  }
  return text
}

/** Prompt versions live in shared so the audit trail and the code agree. */
export { PROMPT_VERSION }
