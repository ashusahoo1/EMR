/**
 * App shell and error contract (BUILD_ROADMAP A5).
 *
 * These call `app.handle` directly: in-process, no port, no network. That is
 * the same mechanism Eden Treaty uses for the A9 integration tests, so this
 * file doubles as proof that the app.ts / index.ts split works -- importing
 * the app must not bind a port.
 */
import { describe, expect, test } from 'bun:test'
import { Elysia, t } from 'elysia'
import { app } from './app.ts'
import { handleError } from './error-handler.ts'
import { AppError, ERROR_STATUS, ErrorCode, errorEnvelope } from './errors.ts'

const req = (path: string, init?: RequestInit) =>
  app.handle(new Request(`http://localhost${path}`, init))

/**
 * A throwaway app wearing the real error handler, so failure paths can be
 * exercised without adding probe routes to the production app.
 */
const SECRET = 'DB password is hunter2 at /secret/path/client.ts:14'
const probe = new Elysia()
  .onError(handleError)
  .get('/boom', () => {
    throw new Error(SECRET)
  })
  .get('/apperror', () => {
    throw new AppError(ErrorCode.NOTES_TOO_LONG, {
      details: { length: 12480, limit: 10000 },
    })
  })
  .get('/validate', ({ query }) => ({ ok: query.n }), {
    query: t.Object({ n: t.Integer({ minimum: 1 }) }),
  })

const probeReq = (path: string) => probe.handle(new Request(`http://localhost${path}`))

describe('health', () => {
  test('GET /health returns ok', async () => {
    const res = await req('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('error envelope', () => {
  test('an unknown route returns the envelope with NOT_FOUND', async () => {
    const res = await req('/nope')
    expect(res.status).toBe(404)

    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.message).toBeTruthy()
  })

  test('the envelope has exactly one top-level key', async () => {
    const res = await req('/nope')
    const body = (await res.json()) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['error'])
    expect(body.error).toHaveProperty('code')
    expect(body.error).toHaveProperty('message')
  })

  test('an AppError keeps its own status and details', async () => {
    const res = await probeReq('/apperror')
    expect(res.status).toBe(422)

    const body = (await res.json()) as {
      error: { code: string; details?: Record<string, number> }
    }
    expect(body.error.code).toBe('NOTES_TOO_LONG')
    expect(body.error.details).toEqual({ length: 12480, limit: 10000 })
  })

  test('a validation failure is 422 and names the offending field', async () => {
    const res = await probeReq('/validate?n=notanumber')
    expect(res.status).toBe(422)

    const body = (await res.json()) as {
      error: { code: string; details?: { fields?: string[] } }
    }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.fields?.[0]).toContain('/n')
  })

  test('a valid request passes validation untouched', async () => {
    const res = await probeReq('/validate?n=3')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: 3 })
  })
})

describe('E20/E37: internal errors never leak implementation detail', () => {
  test('an unexpected throw returns a generic 500 with no stack or secret', async () => {
    const res = await probeReq('/boom')
    expect(res.status).toBe(500)

    const raw = await res.text()
    // The thrown error contained all of these. None may survive to the client.
    expect(raw).not.toContain('hunter2')
    expect(raw).not.toContain('client.ts')
    expect(raw).not.toContain('/secret/')
    expect(raw).not.toContain('node_modules')
    expect(raw.toLowerCase()).not.toContain('stack')

    const body = JSON.parse(raw) as { error: { code: string; details?: unknown } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.details).toBeUndefined()
  })
})

describe('AppError', () => {
  test('carries the status from the Appendix 3 table', () => {
    expect(new AppError(ErrorCode.NOTES_TOO_LONG).httpStatus).toBe(422)
    expect(new AppError(ErrorCode.AI_UNAVAILABLE).httpStatus).toBe(503)
    expect(new AppError(ErrorCode.INVALID_STATUS_TRANSITION).httpStatus).toBe(409)
    expect(new AppError(ErrorCode.PATIENT_NOT_FOUND).httpStatus).toBe(404)
    expect(new AppError(ErrorCode.AI_TIMEOUT).httpStatus).toBe(504)
    expect(new AppError(ErrorCode.RATE_LIMITED).httpStatus).toBe(429)
  })

  test('omits the details key entirely when there are none', () => {
    const envelope = new AppError(ErrorCode.NOTES_EMPTY).toEnvelope()
    expect(envelope.error).not.toHaveProperty('details')
  })

  test('every code in the closed set has a status and a default message', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400)
      const envelope = errorEnvelope(code)
      expect(envelope.error.code).toBe(code)
      expect(envelope.error.message.length).toBeGreaterThan(0)
    }
  })

  test('E23: AI_UNAVAILABLE tells the doctor they can still work', () => {
    // Wording matters. This is what a doctor sees when the provider is down,
    // and it must not read as "the app is broken".
    const message = errorEnvelope(ErrorCode.AI_UNAVAILABLE).error.message
    expect(message.toLowerCase()).toContain('still')
  })
})
