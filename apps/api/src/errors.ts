/**
 * The error contract (BUILD_ROADMAP Appendix 3).
 *
 * One envelope on every failure, no exceptions:
 *
 *   { "error": { "code": "...", "message": "...", "details": { ... } } }
 *
 * Two rules that matter more than the shape:
 *
 *   1. The code set is CLOSED. Adding a code means adding it to Appendix 3
 *      first. A route inventing its own string breaks the frontend's ability
 *      to switch on failure.
 *   2. INTERNAL_ERROR never carries detail. The real error is logged
 *      server-side; the client gets a generic sentence. A stack trace in a
 *      response body leaks file paths, dependency versions and sometimes the
 *      connection string (E20, E37).
 */

/** Every error code the API may return. Closed set -- see Appendix 3. */
export const ErrorCode = {
  // --- validation / not found ---
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  PATIENT_NOT_FOUND: 'PATIENT_NOT_FOUND',
  APPOINTMENT_NOT_FOUND: 'APPOINTMENT_NOT_FOUND',
  CONSULTATION_NOT_FOUND: 'CONSULTATION_NOT_FOUND',

  // --- conflict ---
  CONSULTATION_EXISTS: 'CONSULTATION_EXISTS',
  ALREADY_CONFIRMED: 'ALREADY_CONFIRMED',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',

  // --- input limits ---
  NOTES_EMPTY: 'NOTES_EMPTY',
  NOTES_TOO_LONG: 'NOTES_TOO_LONG',
  QUERY_TOO_SHORT: 'QUERY_TOO_SHORT',

  // --- image precheck (stage 0) ---
  INVALID_IMAGE_TYPE: 'INVALID_IMAGE_TYPE',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  IMAGE_TOO_SMALL: 'IMAGE_TOO_SMALL',
  CORRUPT_IMAGE: 'CORRUPT_IMAGE',
  IMAGE_TOO_BLURRY: 'IMAGE_TOO_BLURRY',
  NOT_CLINICAL_NOTES: 'NOT_CLINICAL_NOTES',

  // --- AI provider ---
  AI_GENERATION_FAILED: 'AI_GENERATION_FAILED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_TIMEOUT: 'AI_TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',

  // --- catch-all ---
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/** The HTTP status each code maps to. Exhaustive by construction. */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  PATIENT_NOT_FOUND: 404,
  APPOINTMENT_NOT_FOUND: 404,
  CONSULTATION_NOT_FOUND: 404,

  CONSULTATION_EXISTS: 409,
  ALREADY_CONFIRMED: 409,
  INVALID_STATUS_TRANSITION: 409,

  NOTES_EMPTY: 422,
  NOTES_TOO_LONG: 422,
  QUERY_TOO_SHORT: 422,

  INVALID_IMAGE_TYPE: 422,
  IMAGE_TOO_LARGE: 422,
  IMAGE_TOO_SMALL: 422,
  CORRUPT_IMAGE: 422,
  IMAGE_TOO_BLURRY: 422,
  NOT_CLINICAL_NOTES: 422,

  AI_GENERATION_FAILED: 502,
  AI_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  RATE_LIMITED: 429,

  INTERNAL_ERROR: 500,
}

/** Default messages. A call site may override with something more specific. */
const DEFAULT_MESSAGE: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'The request did not match the expected shape.',
  NOT_FOUND: 'Not found.',
  PATIENT_NOT_FOUND: 'That patient does not exist.',
  APPOINTMENT_NOT_FOUND: 'That appointment does not exist.',
  CONSULTATION_NOT_FOUND: 'That consultation does not exist.',

  CONSULTATION_EXISTS: 'This appointment already has a consultation.',
  ALREADY_CONFIRMED: 'This consultation has been confirmed and cannot be edited.',
  INVALID_STATUS_TRANSITION: 'That status change is not allowed.',

  NOTES_EMPTY: 'Notes cannot be empty.',
  NOTES_TOO_LONG: 'Notes are too long.',
  QUERY_TOO_SHORT: 'Search needs at least two characters.',

  INVALID_IMAGE_TYPE: 'That file type is not supported. Use JPEG, PNG or WebP.',
  IMAGE_TOO_LARGE: 'That image is too large.',
  IMAGE_TOO_SMALL: 'That image is too small to read reliably.',
  CORRUPT_IMAGE: 'That file could not be read as an image.',
  // Phrased as an action the doctor can take, not as a rejection (§4.2).
  IMAGE_TOO_BLURRY: 'That photo is too blurry to read. Try again in better light.',
  NOT_CLINICAL_NOTES: 'That image does not look like handwritten clinical notes.',

  AI_GENERATION_FAILED:
    'The AI could not produce a usable note. You can write it manually.',
  AI_UNAVAILABLE:
    'AI assistance is unavailable right now. You can still write and save notes.',
  AI_TIMEOUT: 'The AI took too long to respond. You can try again or write manually.',
  RATE_LIMITED: 'Too many AI requests. Wait a moment and try again.',

  INTERNAL_ERROR: 'Something went wrong on our end.',
}

/** Structured, JSON-safe detail. Never an Error, never a stack. */
export type ErrorDetails = Record<string, string | number | boolean | null | string[]>

export interface ErrorEnvelope {
  error: {
    code: ErrorCode
    message: string
    details?: ErrorDetails
  }
}

/**
 * The only error type routes and services should throw.
 *
 * Anything else reaching the handler is treated as an unexpected failure and
 * collapsed to INTERNAL_ERROR with no detail.
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly httpStatus: number
  readonly details: ErrorDetails | undefined

  constructor(
    code: ErrorCode,
    options: { message?: string; details?: ErrorDetails } = {},
  ) {
    super(options.message ?? DEFAULT_MESSAGE[code])
    this.name = 'AppError'
    this.code = code
    this.httpStatus = ERROR_STATUS[code]
    this.details = options.details
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    }
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

/** Build an envelope for a code without throwing. */
export function errorEnvelope(
  code: ErrorCode,
  options: { message?: string; details?: ErrorDetails } = {},
): ErrorEnvelope {
  return new AppError(code, options).toEnvelope()
}
