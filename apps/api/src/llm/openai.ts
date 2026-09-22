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
import { LIMITS, PROMPT_VERSION, StructuredNote } from '@emr/shared'
import OpenAI from 'openai'
import { log } from '../log.ts'
import {
  buildStructureUserPrompt,
  STRUCTURE_SCHEMA_NAME,
  STRUCTURE_SYSTEM_PROMPT,
  STRUCTURE_TEMPERATURE,
} from './prompts/structure.ts'
import {
  countIllegible,
  isRefusal,
  TRANSCRIBE_SYSTEM_PROMPT,
  TRANSCRIBE_TEMPERATURE,
  TRANSCRIBE_USER_PROMPT,
} from './prompts/transcribe.ts'
import { toStrictSchema } from './strict-schema.ts'
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
 * The strict-mode form of StructuredNote, built once at module load.
 *
 * Converted rather than handed over raw: strict decoding rejects the
 * length and size keywords our schema carries for HTTP validation. See
 * `strict-schema.ts` for why stripping them loses nothing.
 */
const STRICT_NOTE_SCHEMA = toStrictSchema(StructuredNote)

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
   * Stage 1 -- transcription (§4.3, B2).
   *
   * Image in, verbatim text out. No structuring, no interpretation: those
   * belong to stage 3, after the doctor has corrected any misreads (§4.1).
   */
  async transcribeImage(input: TranscribeInput): Promise<TranscribeOutput> {
    const startedAt = Date.now()
    const promptVersion = PROMPT_VERSION.transcription

    let response: Awaited<ReturnType<OpenAI['chat']['completions']['create']>>
    try {
      response = await this.client.chat.completions.create({
        model: this.visionModel,
        temperature: TRANSCRIBE_TEMPERATURE,
        messages: [
          { role: 'system', content: TRANSCRIBE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: TRANSCRIBE_USER_PROMPT },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${input.mimeType};base64,${toBase64(input.image)}`,
                  // "high" costs more tokens but reads small handwriting;
                  // "low" downsamples to 512px, which is where a VLM starts
                  // guessing at exactly the words we most need read right.
                  detail: 'high',
                },
              },
            ],
          },
        ],
      })
    } catch (error) {
      throw new LlmError(classifyOpenAiError(error), 'Transcription call failed.', {
        meta: { model: this.visionModel, promptVersion },
        cause: error,
      })
    }

    const meta = buildMeta({
      model: this.visionModel,
      promptVersion,
      startedAt,
      usage: response.usage,
    })

    const text = response.choices[0]?.message?.content?.trim() ?? ''

    if (text.length === 0) {
      throw new LlmError(LlmFailure.BadOutput, 'The model returned no text.', { meta })
    }

    // E34/E18 -- a refusal is not a technical error, and the doctor should be
    // told which it was.
    if (isRefusal(text)) {
      log.info('transcription refused: not clinical notes', { model: meta.model })
      throw new LlmError(
        LlmFailure.Refused,
        'That image does not look like handwritten clinical notes.',
        { meta },
      )
    }

    // E36 -- output wildly disproportionate to the image means the model is
    // generating rather than reading.
    assertTranscriptPlausible(text, meta)

    log.info('transcription complete', {
      model: meta.model,
      promptVersion,
      latencyMs: meta.latencyMs,
      chars: text.length,
      illegibleMarkers: countIllegible(text),
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
    })

    return { text, meta }
  }

  /**
   * Stage 3 -- structuring (§4.5).
   *
   * Corrected text in, schema-constrained JSON out. Two guardrails operate
   * here and they are not interchangeable: strict decoding makes the SHAPE
   * impossible to violate, and the prompt argues about what belongs in it.
   * Neither establishes truth, which is why `raw` stays `unknown` and stage
   * 4 still runs.
   */
  async structureNotes(input: StructureInput): Promise<StructureOutput> {
    const startedAt = Date.now()
    const promptVersion = PROMPT_VERSION.structuring

    let response: Awaited<ReturnType<OpenAI['chat']['completions']['create']>>
    try {
      response = await this.client.chat.completions.create({
        model: this.textModel,
        temperature: STRUCTURE_TEMPERATURE,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: STRUCTURE_SCHEMA_NAME,
            // Constrained decoding, not a post-hoc check: the model cannot
            // emit a `bloodPressure` key at all (E13).
            strict: true,
            schema: STRICT_NOTE_SCHEMA,
          },
        },
        messages: [
          { role: 'system', content: STRUCTURE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildStructureUserPrompt(input.notes, input.repairFeedback),
          },
        ],
      })
    } catch (error) {
      throw new LlmError(classifyOpenAiError(error), 'Structuring call failed.', {
        meta: { model: this.textModel, promptVersion },
        cause: error,
      })
    }

    const meta = buildMeta({
      model: this.textModel,
      promptVersion,
      startedAt,
      usage: response.usage,
    })

    const choice = response.choices[0]

    // A safety refusal arrives as a dedicated field, not as content (E18).
    // Without this branch it reads as empty output and gets reported as a
    // technical fault, which is the generic-failure problem E21 warns about.
    const refusal = choice?.message?.refusal
    if (typeof refusal === 'string' && refusal.trim() !== '') {
      log.info('structuring refused by the model', { model: meta.model })
      throw new LlmError(
        LlmFailure.Refused,
        'The model declined to structure these notes.',
        {
          meta,
        },
      )
    }

    // E36 -- strict decoding can still stop early on the token budget,
    // leaving syntactically truncated JSON.
    if (choice?.finish_reason === 'length') {
      throw new LlmError(
        LlmFailure.BadOutput,
        'The structured note was cut off before it was complete.',
        { meta },
      )
    }

    const content = choice?.message?.content?.trim() ?? ''
    if (content === '') {
      throw new LlmError(LlmFailure.BadOutput, 'The model returned no structured note.', {
        meta,
      })
    }

    let raw: unknown
    try {
      raw = JSON.parse(content)
    } catch (error) {
      // Should be unreachable under strict decoding. Handled anyway: the
      // guarantee is the provider's, and an unhandled throw here would
      // surface as a 500 rather than a retryable failure.
      throw new LlmError(LlmFailure.BadOutput, 'The model returned invalid JSON.', {
        meta,
        cause: error,
      })
    }

    log.info('structuring complete', {
      model: meta.model,
      promptVersion,
      latencyMs: meta.latencyMs,
      retry: input.repairFeedback !== undefined,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
    })

    // Deliberately NOT cast to StructuredNote -- shape is guaranteed, truth
    // is not, and the caller must validate (§4.5).
    return { raw, meta }
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
  // `undefined` and `null` both mean "the provider did not report usage",
  // and the SDK uses undefined while our own stubs use null.
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null | undefined
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

/**
 * Base64-encode image bytes for a data URL.
 *
 * Chunked rather than `String.fromCharCode(...bytes)`, which blows the
 * argument limit and throws a RangeError on anything over a few hundred KB --
 * i.e. on every real phone photo.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Prompt versions live in shared so the audit trail and the code agree. */
export { PROMPT_VERSION }
