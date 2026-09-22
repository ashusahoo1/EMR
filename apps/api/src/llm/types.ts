/**
 * The LLM seam (BUILD_ROADMAP B0).
 *
 * WHY THIS EXISTS -- and it is worth being precise, because the obvious
 * answer is wrong. This is NOT about provider portability. It is about
 * TESTABILITY (EMR_PLAN §2.3).
 *
 * Without this seam, every L2 integration test has to mock the OpenAI SDK's
 * internals: `client.chat.completions.create` returning an object shaped like
 * a `ChatCompletion`, with the JSON buried in
 * `choices[0].message.content`. That mock is brittle (it breaks when the SDK
 * changes a field), unreadable (the test is 80% scaffolding), and it tests
 * our mock rather than our code.
 *
 * With the seam, a test swaps two functions.
 *
 * Nothing in this file may mention OpenAI. If a type from the SDK leaks in
 * here, the seam has failed and the tests are coupled to the vendor again.
 */

/**
 * Metadata every model call returns, success or failure.
 *
 * `model` and `promptVersion` are here because §4.8 requires them in the
 * audit trail: "without it the audit trail is uninterpretable six months
 * later". Retrofitting them means re-plumbing every call site, so they are
 * part of the contract from the first call.
 */
export interface CallMeta {
  /** The exact model id, e.g. the value of TEXT_MODEL. Not a friendly name. */
  model: string
  /** From PROMPT_VERSION. Bump it whenever a prompt changes (B8). */
  promptVersion: string
  latencyMs: number
  inputTokens: number
  outputTokens: number
}

/** Stage 1 (§4.3) -- image in, verbatim text out. Nothing else. */
export interface TranscribeInput {
  image: Uint8Array
  mimeType: string
}

export interface TranscribeOutput {
  /**
   * The transcript, with unreadable passages marked `[illegible]`.
   *
   * §4.3 calls that marker the single most important rule in the prompt: a
   * fabrication here is invisible to every downstream check, because by the
   * time stage 4 runs the fabrication IS the source text.
   */
  text: string
  meta: CallMeta
}

/** Stage 3 (§4.5) -- corrected text in, schema-constrained JSON out. */
export interface StructureInput {
  notes: string
  /**
   * The ONE permitted retry (§4.6).
   *
   * When verification finds a repairable problem, the failures are fed back
   * as a correction message and the call is re-run once. Never a loop:
   * unbounded retries burn cost and latency and rarely converge.
   */
  repairFeedback?: string
}

export interface StructureOutput {
  /**
   * Deliberately `unknown`, not `StructuredNote`.
   *
   * The provider's constrained-decoding mode guarantees SHAPE, not TRUTH --
   * and not even shape reliably enough to skip validation (§4.5). Typing this
   * as StructuredNote would let unvalidated model output flow straight into
   * the database with the compiler's blessing. The caller must parse it.
   */
  raw: unknown
  meta: CallMeta
}

/**
 * The two functions the pipeline is allowed to call.
 *
 * Two, not one: stages 1 and 3 are SEPARATE model calls with a human
 * checkpoint between them (§4.1, rule 1). A single `imageToStructuredNote`
 * would collapse that checkpoint, make failures unattributable between
 * transcription and structuring, and force image fixtures into every
 * structuring test.
 */
export interface LlmClient {
  transcribeImage(input: TranscribeInput): Promise<TranscribeOutput>
  structureNotes(input: StructureInput): Promise<StructureOutput>
}

/**
 * Why a model call failed, in terms the API layer can map to an error code.
 *
 * Distinguishing these matters to the doctor, not just to logs: a refusal
 * needs a different message from a timeout, which needs a different message
 * from being rate limited (E18, E21, E22).
 */
export const LlmFailure = {
  /** The provider was unreachable, or LLM_ENABLED=false. */
  Unavailable: 'unavailable',
  /** The call exceeded llmTimeoutMs (E22). */
  Timeout: 'timeout',
  /** Provider returned 429 (E21). */
  RateLimited: 'rate_limited',
  /** The model refused -- e.g. the image is not clinical notes (E18, E34). */
  Refused: 'refused',
  /** Output was unparseable, or wildly disproportionate to the input (E36). */
  BadOutput: 'bad_output',
} as const
export type LlmFailure = (typeof LlmFailure)[keyof typeof LlmFailure]

/**
 * A model call that failed for a reason the caller should distinguish.
 *
 * Carries partial `meta` where available, so B6 can still write an
 * ai_generations row for the failure -- §4.8 is explicit that failures are
 * audited too.
 */
export class LlmError extends Error {
  readonly failure: LlmFailure
  readonly meta: Partial<CallMeta> | undefined

  constructor(
    failure: LlmFailure,
    message: string,
    options: { meta?: Partial<CallMeta>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'LlmError'
    this.failure = failure
    this.meta = options.meta
  }
}

export function isLlmError(value: unknown): value is LlmError {
  return value instanceof LlmError
}
