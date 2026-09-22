/**
 * The stub LLM client (B0).
 *
 * Every L2 integration test runs against this. It never touches the network,
 * so `bun test` works with no API key set -- which is a Sector B exit
 * criterion, not a convenience.
 *
 * The stub is FIXTURE-DRIVEN rather than "returns a fixed blob": tests can
 * queue a specific response to exercise a path (malformed JSON, a refusal, a
 * timeout, an ungrounded span) without mocking anything. That is what makes
 * E11, E14-E17 and E19 testable at the integration level.
 */
import { PROMPT_VERSION, type StructuredNote } from '@emr/shared'
import {
  type CallMeta,
  type LlmClient,
  LlmError,
  type LlmFailure,
  type StructureInput,
  type StructureOutput,
  type TranscribeInput,
  type TranscribeOutput,
} from './types.ts'

export const STUB_MODEL = 'stub-model-v0'

function meta(promptVersion: string): CallMeta {
  return {
    model: STUB_MODEL,
    promptVersion,
    latencyMs: 1,
    inputTokens: 0,
    outputTokens: 0,
  }
}

/** The N01 golden-set note (SYNTHETIC_NOTES_TEST.md), the happy-path fixture. */
export function n01Note(): StructuredNote {
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

/** The N01 transcript -- what stage 1 should produce from the photo. */
export const N01_TRANSCRIPT = [
  'fever since 3 days, mild cough',
  'no breathing difficulty',
  'took paracetamol yesterday',
  'allergic to penicillin',
  'advised hydration, rest',
  'return if symptoms worsen',
].join('\n')

/** What a queued call should do. */
type QueuedStructure =
  | { kind: 'raw'; value: unknown }
  | { kind: 'fail'; failure: LlmFailure; message: string }

type QueuedTranscribe =
  | { kind: 'text'; value: string }
  | { kind: 'fail'; failure: LlmFailure; message: string }

/**
 * A stub whose responses tests can queue.
 *
 * Queued responses are consumed in order; when the queue is empty it falls
 * back to the N01 fixture. That means a test only has to describe the case it
 * cares about, and every other call still behaves sensibly.
 */
export class StubLlmClient implements LlmClient {
  private structureQueue: QueuedStructure[] = []
  private transcribeQueue: QueuedTranscribe[] = []

  /** Calls recorded for assertions -- e.g. "the retry fed the errors back". */
  readonly structureCalls: StructureInput[] = []
  readonly transcribeCalls: TranscribeInput[] = []

  /** Queue the next structuring result. Anything JSON-ish, including junk. */
  queueStructure(raw: unknown): this {
    this.structureQueue.push({ kind: 'raw', value: raw })
    return this
  }

  /** Queue a structuring failure (E18, E19, E21, E22). */
  queueStructureFailure(failure: LlmFailure, message = 'stubbed failure'): this {
    this.structureQueue.push({ kind: 'fail', failure, message })
    return this
  }

  queueTranscript(text: string): this {
    this.transcribeQueue.push({ kind: 'text', value: text })
    return this
  }

  queueTranscribeFailure(failure: LlmFailure, message = 'stubbed failure'): this {
    this.transcribeQueue.push({ kind: 'fail', failure, message })
    return this
  }

  /** Forget queued responses and recorded calls. */
  reset(): this {
    this.structureQueue.length = 0
    this.transcribeQueue.length = 0
    this.structureCalls.length = 0
    this.transcribeCalls.length = 0
    return this
  }

  async transcribeImage(input: TranscribeInput): Promise<TranscribeOutput> {
    this.transcribeCalls.push(input)
    const queued = this.transcribeQueue.shift()

    if (queued?.kind === 'fail') {
      throw new LlmError(queued.failure, queued.message, {
        meta: meta(PROMPT_VERSION.transcription),
      })
    }

    return {
      text: queued?.value ?? N01_TRANSCRIPT,
      meta: meta(PROMPT_VERSION.transcription),
    }
  }

  async structureNotes(input: StructureInput): Promise<StructureOutput> {
    this.structureCalls.push(input)
    const queued = this.structureQueue.shift()

    if (queued?.kind === 'fail') {
      throw new LlmError(queued.failure, queued.message, {
        meta: meta(PROMPT_VERSION.structuring),
      })
    }

    return {
      raw: queued?.kind === 'raw' ? queued.value : n01Note(),
      meta: meta(PROMPT_VERSION.structuring),
    }
  }
}

/**
 * The process-wide stub instance.
 *
 * A singleton so a test can queue a response and the request handler picks it
 * up without any dependency injection plumbing through the route layer.
 */
export const stubLlm = new StubLlmClient()
