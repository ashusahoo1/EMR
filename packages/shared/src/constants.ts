/**
 * Limits and versions in one place, so client and server cannot drift.
 *
 * Every limit here is enforced server-side regardless of what the client
 * does. The client copies exist to give a good error before a wasted round
 * trip, never as the enforcement point (§4.2: never trust the client).
 */

export const LIMITS = {
  /** E3 -- length cap, enforced server-side too. */
  notesMaxChars: 10_000,
  /** E1 -- whitespace-only notes are rejected. */
  notesMinChars: 1,

  /** F17 search. */
  searchMinChars: 2,

  /** Stage 0 precheck (§4.2). */
  imageMaxBytes: 8 * 1024 * 1024,
  imageMinWidth: 600,
  imageMinHeight: 600,
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],

  /** E22 -- request timeout on every model call. */
  llmTimeoutMs: 45_000,

  /**
   * §4.6 -- one retry, never a loop. Unbounded retries burn cost and latency
   * and rarely converge.
   */
  maxRetries: 1,
} as const

/**
 * Prompt versions, written to every ai_generations row.
 *
 * §4.8: without the model name and prompt version the audit trail is
 * uninterpretable six months later. Bump these whenever a prompt changes,
 * and re-run the L3 eval (B8).
 */
export const PROMPT_VERSION = {
  transcription: 'transcribe-v1',
  structuring: 'structure-v1',
} as const

/**
 * The marker a transcription must emit for text it cannot read (§4.3).
 *
 * The single most important rule in the stage 1 prompt. A fabrication here is
 * invisible to every downstream check, because by the time stage 4 runs the
 * fabrication IS the source text.
 */
export const ILLEGIBLE_MARKER = '[illegible]'

/**
 * Negation tokens for the stage 4 negation-preservation check (§4.6 check 4).
 *
 * Be honest about what this is: a word list, not clinical NLP. It misses
 * distant negation ("denies any respiratory complaints") and double
 * negatives. It catches the common dangerous case cheaply, and it flags
 * rather than deletes. Stated as a limitation in the README.
 */
export const NEGATION_TOKENS = [
  'no',
  'not',
  'denies',
  'denied',
  'without',
  'nil',
  'absent',
  'negative for',
  'ruled out',
  'nad',
] as const

/**
 * Triggers for the reverse-direction allergy survival check (§4.6 check 5).
 *
 * Dropping "allergic to penicillin" is arguably worse than inventing a BP,
 * and grounding cannot catch it by definition -- grounding only validates
 * what is present, never what went missing (E17).
 */
export const ALLERGY_TRIGGERS = ['allerg', 'intoleran', 'reaction to'] as const
