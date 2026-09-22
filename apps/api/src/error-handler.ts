/**
 * The single failure path for the whole API.
 *
 * Extracted from app.ts so it can be mounted on a throwaway Elysia instance
 * in tests without mutating the real app, and so the mapping is readable in
 * one screen.
 *
 * The contract, in order of preference:
 *   AppError            -> its own code and status, details included
 *   Elysia VALIDATION   -> 422 VALIDATION_FAILED, naming the offending field
 *   Elysia NOT_FOUND    -> 404 NOT_FOUND
 *   Elysia PARSE        -> 422 VALIDATION_FAILED
 *   anything else       -> 500 INTERNAL_ERROR, GENERIC, logged in full
 *
 * That last line is the important one (E20, E37): the real error, including
 * its stack, goes to the server log. The client gets one sentence.
 */
import { ErrorCode, type ErrorEnvelope, errorEnvelope, isAppError } from './errors.ts'
import { describeError, log } from './log.ts'

/**
 * Elysia's error context is a discriminated union over `code`, and one of its
 * branches types `code` as a number (custom status responses). We accept the
 * widened shape rather than importing `ErrorHandler`, whose five generic
 * parameters would have to be threaded through every call site -- and which
 * would make this function impossible to call from a plain unit test.
 */
export interface ErrorContext {
  code: string | number
  error: unknown
  set: { status?: number | string | undefined }
  path: string
  request: Request
}

export function handleError({
  code,
  error,
  set,
  path,
  request,
}: ErrorContext): ErrorEnvelope {
  if (isAppError(error)) {
    set.status = error.httpStatus
    // 5xx is our bug; 4xx is the caller's. Logging both at error level makes
    // the error log useless for finding real failures.
    const level = error.httpStatus >= 500 ? 'error' : 'warn'
    log[level]('request failed', {
      code: error.code,
      status: error.httpStatus,
      method: request.method,
      path,
    })
    return error.toEnvelope()
  }

  if (code === 'VALIDATION') {
    set.status = 422
    const fields = extractValidationFields(error)
    log.warn('validation failed', { method: request.method, path, fields })
    return errorEnvelope(ErrorCode.VALIDATION_FAILED, {
      ...(fields.length > 0 ? { details: { fields } } : {}),
    })
  }

  if (code === 'NOT_FOUND') {
    set.status = 404
    return errorEnvelope(ErrorCode.NOT_FOUND, {
      message: `No route matches ${request.method} ${path}.`,
    })
  }

  if (code === 'PARSE') {
    set.status = 422
    return errorEnvelope(ErrorCode.VALIDATION_FAILED, {
      message: 'The request body could not be parsed.',
    })
  }

  /**
   * Elysia's own file-type guard, raised by `t.File({ type })` before the
   * handler runs. It sniffs magic bytes rather than trusting the declared
   * MIME type, so a .txt renamed .jpg is caught here (E32).
   *
   * Without this branch it falls through to INTERNAL_ERROR, turning a
   * legitimate 422 into a 500 -- which is how a clear "wrong file type"
   * message becomes "something went wrong on our end".
   */
  if (code === 'INVALID_FILE_TYPE') {
    set.status = 422
    log.warn('invalid file type', { method: request.method, path })
    return errorEnvelope(ErrorCode.INVALID_IMAGE_TYPE)
  }

  set.status = 500
  log.error('unhandled error', {
    elysiaCode: code,
    method: request.method,
    path,
    ...describeError(error),
  })
  return errorEnvelope(ErrorCode.INTERNAL_ERROR)
}

/**
 * Pull "which field was wrong" out of Elysia's validation error.
 *
 * Deliberately conservative: it reports the property path and TypeBox's own
 * message, never the received value, which could be clinical text.
 */
function extractValidationFields(error: unknown): string[] {
  const all = (error as { all?: unknown }).all
  if (!Array.isArray(all)) return []

  return all
    .map((entry) => {
      const e = entry as { path?: string; message?: string }
      if (!e.path) return undefined
      return e.message ? `${e.path} ${e.message}` : e.path
    })
    .filter((value): value is string => typeof value === 'string')
}
