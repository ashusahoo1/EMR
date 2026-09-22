/**
 * AI routes, stubbed (BUILD_ROADMAP A8).
 *
 * The headline test here is E23: with LLM_ENABLED=false the AI endpoints
 * return a clean 503 AND the doctor can still complete a consultation end to
 * end. EMR_PLAN §4.11 calls that the single most important guardrail, and it
 * is the one most likely to be exercised during a live demo.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { emptyStructuredNote, type StructuredNote } from '@emr/shared'

import { app } from '../app.ts'
import { db } from '../db/client.ts'
import { appointments } from '../db/schema.ts'
import { seed } from '../db/seed.ts'
import { fakeJpeg } from '../tests/fixtures.ts'

const MISSING_UUID = '00000000-0000-4000-8000-000000000000'

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
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
  return { status: res.status, body: (await res.json()) as T }
}

/**
 * Fixtures come from tests/fixtures.ts, which builds a JPEG with a real
 * SOF0 header.
 *
 * Two layers demand that now. Elysia's `t.File({ type })` sniffs magic bytes
 * rather than trusting the declared MIME type (E32), and B1's precheck reads
 * the dimensions out of the header and measures byte density for blur. A
 * ten-byte "JPEG" declares no size, so it is correctly rejected as corrupt.
 */
async function postImage<T>(
  filename: string,
  type: string,
  content: Uint8Array = fakeJpeg(),
): Promise<{ status: number; body: T }> {
  const form = new FormData()
  form.append('image', new File([content], filename, { type }))
  const res = await app.handle(
    new Request('http://localhost/transcribe', { method: 'POST', body: form }),
  )
  return { status: res.status, body: (await res.json()) as T }
}

/**
 * A draft consultation with notes, ready to structure.
 *
 * Creates a fresh appointment rather than reusing a seeded one: the file
 * seeds once, so consuming a seeded appointment would make tests depend on
 * execution order (one consultation per appointment is a unique index).
 */
async function draftWithNotes(notes = 'fever since 3 days'): Promise<string> {
  const [seedRow] = await db.select().from(appointments).limit(1)
  if (!seedRow) throw new Error('seed has no appointments')

  const [appointment] = await db
    .insert(appointments)
    .values({
      doctorId: seedRow.doctorId,
      patientId: seedRow.patientId,
      scheduledAt: new Date(),
      reason: 'AI route test',
      status: 'waiting',
    })
    .returning()
  if (!appointment) throw new Error('failed to create test appointment')

  const created = await call<{ consultation: { id: string } }>('POST', '/consultations', {
    appointmentId: appointment.id,
    rawNotes: notes,
  })
  return created.body.consultation.id
}

/**
 * Seeded once for the file, not before every test.
 *
 * Re-seeding per test costs ~300ms and was timing out the hook. Each test
 * that needs a consultation creates its own against a distinct appointment,
 * so they do not collide.
 */
beforeAll(async () => {
  await seed()
})

beforeEach(() => {
  process.env.LLM_ENABLED = 'true'
})

afterEach(() => {
  process.env.LLM_ENABLED = 'true'
})

describe('POST /consultations/:id/structure (F5, stubbed)', () => {
  test('returns a schema-valid note and a verification result', async () => {
    const id = await draftWithNotes()
    const { status, body } = await call<{
      note: StructuredNote
      verification: { status: string; flags: unknown[]; repaired: boolean }
    }>('POST', `/consultations/${id}/structure`)

    expect(status).toBe(200)
    expect(body.note.chiefComplaint?.text).toBe('Fever')
    expect(body.note.symptoms.length).toBeGreaterThan(0)
    expect(body.verification.status).toBe('passed')
    expect(body.verification.flags).toEqual([])
  })

  test('every item carries a sourceSpan -- the machinery B4 verifies against', async () => {
    const id = await draftWithNotes()
    const { body } = await call<{ note: StructuredNote }>(
      'POST',
      `/consultations/${id}/structure`,
    )

    const items = [
      body.note.chiefComplaint,
      ...body.note.symptoms,
      ...body.note.relevantHistory,
      ...body.note.medicationsMentioned,
      ...body.note.doctorPlan,
    ].filter((item) => item !== null)

    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item?.sourceSpan.length).toBeGreaterThan(0)
    }
  })

  test('the result is saved as aiNote, NOT as confirmedNote', async () => {
    // §4.7 -- AI output is never saved as final by default. Nothing is
    // clinical until the doctor confirms it.
    const id = await draftWithNotes()
    await call('POST', `/consultations/${id}/structure`)

    const { body } = await call<{
      consultation: {
        aiNote: StructuredNote | null
        confirmedNote: StructuredNote | null
        status: string
      }
    }>('GET', `/consultations/${id}`)

    expect(body.consultation.aiNote).not.toBeNull()
    expect(body.consultation.confirmedNote).toBeNull()
    expect(body.consultation.status).toBe('draft')
  })

  test('E1: structuring empty notes is 422 NOTES_EMPTY, with no model call', async () => {
    const id = await draftWithNotes('   \n  \t ')
    const { status, body } = await call<{ error: { code: string } }>(
      'POST',
      `/consultations/${id}/structure`,
    )
    expect(status).toBe(422)
    expect(body.error.code).toBe('NOTES_EMPTY')
  })

  test('an unknown consultation is 404', async () => {
    const { status, body } = await call<{ error: { code: string } }>(
      'POST',
      `/consultations/${MISSING_UUID}/structure`,
    )
    expect(status).toBe(404)
    expect(body.error.code).toBe('CONSULTATION_NOT_FOUND')
  })
})

describe('POST /transcribe (F8, stubbed)', () => {
  test('returns editable text and an illegible flag', async () => {
    const { status, body } = await postImage<{ text: string; hasIllegible: boolean }>(
      'note.jpg',
      'image/jpeg',
    )
    expect(status).toBe(200)
    expect(body.text.length).toBeGreaterThan(0)
    expect(typeof body.hasIllegible).toBe('boolean')
  })

  test('it does NOT auto-structure -- stage 2 belongs to the doctor', async () => {
    // §4.4: the transcript lands in the textarea and the doctor presses
    // Generate. Chaining here would collapse the human checkpoint, which is
    // the entire product thesis.
    const { body } = await postImage<Record<string, unknown>>('note.jpg', 'image/jpeg')
    expect(body).not.toHaveProperty('note')
    expect(body).not.toHaveProperty('verification')
  })

  test('E32: a non-image file is rejected', async () => {
    const { status, body } = await postImage<{ error: { code: string } }>(
      'notes.txt',
      'text/plain',
      new TextEncoder().encode('this is not an image'),
    )
    expect(status).toBe(422)
    // Two paths reach 422 here and both are correct: an honestly-declared
    // text/plain fails schema validation, while a mislabelled file gets past
    // that and is caught by magic-byte sniffing (next test).
    expect(['VALIDATION_FAILED', 'INVALID_IMAGE_TYPE']).toContain(body.error.code)
  })

  test('E32: a text file RENAMED .jpg is still rejected', async () => {
    // The declared MIME type is a lie; magic-byte sniffing catches it. This
    // is the case that matters, because it is what a confused upload looks
    // like in practice.
    const { status, body } = await postImage<{ error: { code: string } }>(
      'sneaky.jpg',
      'image/jpeg',
      new TextEncoder().encode('still not an image'),
    )
    expect(status).toBe(422)
    expect(body.error.code).toBe('INVALID_IMAGE_TYPE')
  })
})

describe('E23: graceful degradation when the provider is unavailable', () => {
  test('structure returns 503 AI_UNAVAILABLE, not a crash', async () => {
    const id = await draftWithNotes()
    process.env.LLM_ENABLED = 'false'

    const { status, body } = await call<{ error: { code: string; message: string } }>(
      'POST',
      `/consultations/${id}/structure`,
    )

    expect(status).toBe(503)
    expect(body.error.code).toBe('AI_UNAVAILABLE')
    // The doctor must understand they can carry on working.
    expect(body.error.message.toLowerCase()).toContain('still')
  })

  test('transcribe returns 503 AI_UNAVAILABLE', async () => {
    process.env.LLM_ENABLED = 'false'
    const { status, body } = await postImage<{ error: { code: string } }>(
      'note.jpg',
      'image/jpeg',
    )
    expect(status).toBe(503)
    expect(body.error.code).toBe('AI_UNAVAILABLE')
  })

  test('the 503 is the standard envelope, never a stack trace', async () => {
    const id = await draftWithNotes()
    process.env.LLM_ENABLED = 'false'

    const res = await app.handle(
      new Request(`http://localhost/consultations/${id}/structure`, { method: 'POST' }),
    )
    const raw = await res.text()

    expect(raw).not.toContain('node_modules')
    expect(raw.toLowerCase()).not.toContain('stack')
    expect(Object.keys(JSON.parse(raw) as object)).toEqual(['error'])
  })

  test('THE IMPORTANT ONE: a full consultation is still completable with no AI', async () => {
    // Provider down. The doctor writes free text and saves. If this ever
    // fails, the AI has become a dependency rather than an accelerant.
    process.env.LLM_ENABLED = 'false'

    const [seedRow] = await db.select().from(appointments).limit(1)
    if (!seedRow) throw new Error('seed has no appointments')

    const [appointment] = await db
      .insert(appointments)
      .values({
        doctorId: seedRow.doctorId,
        patientId: seedRow.patientId,
        scheduledAt: new Date(),
        reason: 'E23 degradation test',
        status: 'waiting',
      })
      .returning()
    if (!appointment) throw new Error('failed to create test appointment')

    const created = await call<{ consultation: { id: string } }>(
      'POST',
      '/consultations',
      {
        appointmentId: appointment.id,
        rawNotes: 'fever 3 days, advised rest and fluids',
      },
    )
    expect(created.status).toBe(201)
    const id = created.body.consultation.id

    const edited = await call('PATCH', `/consultations/${id}`, {
      rawNotes: 'fever 3 days, advised rest and fluids, review if worse',
    })
    expect(edited.status).toBe(200)

    // E29 -- free-text notes alone are a complete consultation.
    const confirmed = await call<{ consultation: { status: string } }>(
      'POST',
      `/consultations/${id}/confirm`,
      { confirmedNote: emptyStructuredNote() },
    )
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.consultation.status).toBe('confirmed')

    const history = await call<{ consultations: Array<{ id: string }> }>(
      'GET',
      `/patients/${appointment.patientId}/consultations`,
    )
    expect(history.body.consultations.map((c) => c.id)).toContain(id)
  })

  test('read routes are unaffected by the AI being down', async () => {
    process.env.LLM_ENABLED = 'false'
    const { status, body } = await call<{ appointments: unknown[] }>(
      'GET',
      '/appointments',
    )
    expect(status).toBe(200)
    expect(body.appointments.length).toBeGreaterThan(0)
  })
})
