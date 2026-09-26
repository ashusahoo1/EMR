/**
 * The typed API client (BUILD_ROADMAP C0, EMR_PLAN §2.2).
 *
 * THIS IS THE FILE THAT MAKES THE FRONTEND TYPE-SAFE. Eden reads the API's
 * `App` type directly from its source and derives every route, parameter and
 * response shape from it. There is no generated client, no OpenAPI step, and
 * no hand-written response interfaces to drift out of date -- rename a field
 * in the Elysia route and this file's consumers stop compiling.
 *
 * The one setup requirement, and §2.2 is blunt about it: the `App` type must
 * be imported from the API's SOURCE, not from a built package. If the import
 * resolves to `any`, Eden silently degrades to an untyped fetch wrapper that
 * still works at runtime -- which is the worst failure mode available,
 * because nothing breaks until production. C0's done-when exists to catch
 * exactly that.
 *
 * NOTE ON THE TRANSPORT. Unlike the API's own tests, which pass the app
 * object to `treaty()` and call `app.handle` in-process, the browser needs a
 * real URL. Same client, same types, different transport.
 */
import { treaty } from '@elysiajs/eden'
import type { App } from '@emr/api/src/app'

/**
 * The API origin.
 *
 * NEXT_PUBLIC_ so the browser can read it -- this is a URL, not a secret.
 * The API key never appears here or anywhere else client-side (E37): every
 * model call happens server-side in the Elysia process, which is the point
 * of the standalone-backend decision (§2.1).
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export const api = treaty<App>(API_URL)

/**
 * Unwrap an Eden response, or throw with the API's own error code.
 *
 * Eden returns `{ data, error, status }` rather than throwing, which is
 * correct for a client but tedious at every call site -- and it invites the
 * `data!` non-null assertion that hides a real failure. This does the
 * narrowing once.
 *
 * The thrown error carries the Appendix 3 CODE, not just a message, because
 * the UI switches on it: AI_UNAVAILABLE renders "write it yourself" (E23),
 * RATE_LIMITED renders "wait a moment" (E21), and a generic failure renders
 * neither.
 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** The error envelope every failure carries (Appendix 3). */
interface ErrorEnvelope {
  error?: { code?: string; message?: string }
}

export function unwrap<T>(response: {
  data: T | null
  error: unknown
  status: number
}): T {
  if (response.error !== null && response.error !== undefined) {
    const envelope = (response.error as { value?: ErrorEnvelope }).value

    /**
     * A refused connection is NOT an API error, and must not be dressed as
     * one.
     *
     * Eden reports "nothing is listening" as status 503 with a value of
     * {code: "ConnectionRefused"} -- no Appendix 3 envelope, because the
     * server never answered. Minting an ApiError('UNKNOWN') here made the
     * dashboard show "Something went wrong. Something went wrong." with no
     * hint that the API was simply down, which is the one thing the doctor
     * needs to know in that moment. Found by the offline E2E test.
     *
     * Rethrown as a plain Error so presentError takes its offline branch.
     */
    if (envelope?.error?.code === undefined) {
      throw new Error('Could not reach the server.')
    }

    const code = envelope.error.code
    const message = envelope.error.message ?? 'Something went wrong.'
    throw new ApiError(code, message, response.status)
  }

  if (response.data === null || response.data === undefined) {
    // A 200 with no body means the contract and the client disagree, which
    // is a bug rather than a condition to handle gracefully.
    throw new ApiError('EMPTY_RESPONSE', 'The server returned no data.', response.status)
  }

  return response.data
}
