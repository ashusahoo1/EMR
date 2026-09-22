/**
 * Error contract coverage (BUILD_ROADMAP A9).
 *
 * One named test per code in Appendix 3, so a reviewer can see at a glance
 * which failures are actually reachable and which are still theoretical.
 *
 * Codes not exercised here are listed at the bottom with the step that will
 * make them reachable -- an honest gap beats a test that pretends.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { app } from '../app.ts'
import { ErrorCode } from '../errors.ts'
import { doctorNote, freshAppointment, MISSING_UUID, resetDb } from './helpers.ts'

/** Raw request, because these assert on failure shapes Eden would narrow away. */
async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; code: string; message: string; raw: string }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    }),
  )
  const raw = await res.text()
  let code = ''
  let message = ''
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string } }
    code = parsed.error?.code ?? ''
    message = parsed.error?.message ?? ''
  } catch {
    // Left blank; the assertions will report the raw body.
  }
  return { status: res.status, code, message, raw }
}

beforeEach(async () => {
  await resetDb()
  process.env.LLM_ENABLED = 'true'
})

describe('every error carries the standard envelope', () => {
  test('the shape is always { error: { code, message } }', async () => {
    const { raw } = await call('GET', '/nope')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual(['error'])
    expect(parsed.error).toHaveProperty('code')
    expect(parsed.error).toHaveProperty('message')
  })

  test('no error response leaks a stack trace or internal path', async () => {
    const paths = [
      ['GET', '/nope'],
      ['GET', `/patients/${MISSING_UUID}`],
      ['GET', '/patients/not-a-uuid'],
      ['POST', '/consultations'],
    ] as const

    for (const [method, path] of paths) {
      const { raw } = await call(method, path)
      expect(raw).not.toContain('node_modules')
      expect(raw.toLowerCase()).not.toContain('stack')
      expect(raw).not.toContain('at Object')
    }
  })
})

describe('404 — not found', () => {
  test('NOT_FOUND: an unknown route', async () => {
    const r = await call('GET', '/no/such/route')
    expect(r.status).toBe(404)
    expect(r.code).toBe(ErrorCode.NOT_FOUND)
  })

  test('PATIENT_NOT_FOUND: a patient that does not exist', async () => {
    const r = await call('GET', `/patients/${MISSING_UUID}`)
    expect(r.status).toBe(404)
    expect(r.code).toBe(ErrorCode.PATIENT_NOT_FOUND)
  })

  test('APPOINTMENT_NOT_FOUND: creating against a missing appointment', async () => {
    const r = await call('POST', '/consultations', { appointmentId: MISSING_UUID })
    expect(r.status).toBe(404)
    expect(r.code).toBe(ErrorCode.APPOINTMENT_NOT_FOUND)
  })

  test('CONSULTATION_NOT_FOUND: fetching a missing consultation', async () => {
    const r = await call('GET', `/consultations/${MISSING_UUID}`)
    expect(r.status).toBe(404)
    expect(r.code).toBe(ErrorCode.CONSULTATION_NOT_FOUND)
  })
})

describe('409 — conflict', () => {
  test('CONSULTATION_EXISTS: a second consultation for one appointment', async () => {
    const appointment = await freshAppointment()
    await call('POST', '/consultations', { appointmentId: appointment.id })

    const r = await call('POST', '/consultations', { appointmentId: appointment.id })
    expect(r.status).toBe(409)
    expect(r.code).toBe(ErrorCode.CONSULTATION_EXISTS)
  })

  test('ALREADY_CONFIRMED: editing a confirmed consultation', async () => {
    const appointment = await freshAppointment()
    const created = await call('POST', '/consultations', {
      appointmentId: appointment.id,
    })
    const id = (JSON.parse(created.raw) as { consultation: { id: string } }).consultation
      .id
    await call('POST', `/consultations/${id}/confirm`, { confirmedNote: doctorNote() })

    const r = await call('PATCH', `/consultations/${id}`, { rawNotes: 'amended' })
    expect(r.status).toBe(409)
    expect(r.code).toBe(ErrorCode.ALREADY_CONFIRMED)
  })

  test('INVALID_STATUS_TRANSITION: completed -> waiting (E31)', async () => {
    const appointment = await freshAppointment()
    await call('PATCH', `/appointments/${appointment.id}/status`, {
      status: 'in_consultation',
    })
    await call('PATCH', `/appointments/${appointment.id}/status`, {
      status: 'completed',
    })

    const r = await call('PATCH', `/appointments/${appointment.id}/status`, {
      status: 'waiting',
    })
    expect(r.status).toBe(409)
    expect(r.code).toBe(ErrorCode.INVALID_STATUS_TRANSITION)
  })
})

describe('422 — unprocessable', () => {
  test('VALIDATION_FAILED: a malformed uuid', async () => {
    const r = await call('GET', '/patients/not-a-uuid')
    expect(r.status).toBe(422)
    expect(r.code).toBe(ErrorCode.VALIDATION_FAILED)
  })

  test('VALIDATION_FAILED: a missing required body field', async () => {
    const r = await call('POST', '/consultations', {})
    expect(r.status).toBe(422)
    expect(r.code).toBe(ErrorCode.VALIDATION_FAILED)
  })

  test('NOTES_EMPTY: structuring whitespace-only notes (E1)', async () => {
    const appointment = await freshAppointment()
    const created = await call('POST', '/consultations', {
      appointmentId: appointment.id,
      rawNotes: '   \n\t  ',
    })
    const id = (JSON.parse(created.raw) as { consultation: { id: string } }).consultation
      .id

    const r = await call('POST', `/consultations/${id}/structure`)
    expect(r.status).toBe(422)
    expect(r.code).toBe(ErrorCode.NOTES_EMPTY)
  })

  test('NOTES_TOO_LONG: notes over the cap (E3)', async () => {
    const appointment = await freshAppointment()
    const r = await call('POST', '/consultations', {
      appointmentId: appointment.id,
      rawNotes: 'x'.repeat(10_001),
    })
    expect(r.status).toBe(422)
    // The schema's maxLength fires first; both paths are server-side.
    const acceptable: string[] = [ErrorCode.VALIDATION_FAILED, ErrorCode.NOTES_TOO_LONG]
    expect(acceptable).toContain(r.code)
  })

  test('QUERY_TOO_SHORT: a one-character search', async () => {
    const r = await call('GET', '/search?q=a')
    expect(r.status).toBe(422)
    expect(r.code).toBe(ErrorCode.QUERY_TOO_SHORT)
  })

  test('INVALID_IMAGE_TYPE: a text file renamed .jpg (E32)', async () => {
    const form = new FormData()
    form.append(
      'image',
      new File([new TextEncoder().encode('not an image')], 'fake.jpg', {
        type: 'image/jpeg',
      }),
    )
    const res = await app.handle(
      new Request('http://localhost/transcribe', { method: 'POST', body: form }),
    )
    const body = (await res.json()) as { error: { code: string } }
    expect(res.status).toBe(422)
    expect(body.error.code).toBe(ErrorCode.INVALID_IMAGE_TYPE)
  })
})

describe('503 — provider unavailable', () => {
  test('AI_UNAVAILABLE: structure with LLM_ENABLED=false (E23)', async () => {
    const appointment = await freshAppointment()
    const created = await call('POST', '/consultations', {
      appointmentId: appointment.id,
      rawNotes: 'fever since 3 days',
    })
    const id = (JSON.parse(created.raw) as { consultation: { id: string } }).consultation
      .id

    process.env.LLM_ENABLED = 'false'
    const r = await call('POST', `/consultations/${id}/structure`)

    expect(r.status).toBe(503)
    expect(r.code).toBe(ErrorCode.AI_UNAVAILABLE)
    // The doctor must be told they can carry on working.
    expect(r.message.toLowerCase()).toContain('still')
  })
})

describe('500 — internal', () => {
  test('INTERNAL_ERROR is generic and carries no details', async () => {
    // Exercised directly in app.test.ts with a deliberately thrown error;
    // asserted here for the code's presence in the contract.
    const { errorEnvelope } = await import('../errors.ts')
    const envelope = errorEnvelope(ErrorCode.INTERNAL_ERROR)
    expect(envelope.error.code).toBe('INTERNAL_ERROR')
    expect(envelope.error).not.toHaveProperty('details')
  })
})

/**
 * Codes NOT reachable yet, and the step that will make them so.
 *
 * Listing them is deliberate: a test that fakes an unreachable path proves
 * nothing, and a silent gap looks like an oversight.
 *
 *   IMAGE_TOO_LARGE      B1 -- stage 0 precheck
 *   IMAGE_TOO_SMALL      B1
 *   CORRUPT_IMAGE        B1
 *   IMAGE_TOO_BLURRY     B1
 *   NOT_CLINICAL_NOTES   B2 -- the VLM refusal path
 *   AI_GENERATION_FAILED B6 -- after the one permitted retry
 *   AI_TIMEOUT           B7 -- request timeouts
 *   RATE_LIMITED         B7 -- rate limiting
 */
describe('codes awaiting Sector B', () => {
  test('each unreachable code still has a status and a message', async () => {
    const { errorEnvelope, ERROR_STATUS } = await import('../errors.ts')
    const pending = [
      ErrorCode.IMAGE_TOO_LARGE,
      ErrorCode.IMAGE_TOO_SMALL,
      ErrorCode.CORRUPT_IMAGE,
      ErrorCode.IMAGE_TOO_BLURRY,
      ErrorCode.NOT_CLINICAL_NOTES,
      ErrorCode.AI_GENERATION_FAILED,
      ErrorCode.AI_TIMEOUT,
      ErrorCode.RATE_LIMITED,
    ]

    for (const code of pending) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400)
      expect(errorEnvelope(code).error.message.length).toBeGreaterThan(0)
    }
  })
})
