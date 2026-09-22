/**
 * Write routes (BUILD_ROADMAP A7).
 *
 * The two headline behaviours here are tested by calling the ENDPOINT twice,
 * not by checking that a button is disabled:
 *
 *   E25 -- double confirm produces exactly one confirmed consultation
 *   E31 -- completed -> waiting is rejected at the API
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AppointmentStatus,
  emptyStructuredNote,
  type StructuredNote,
} from '@emr/shared'
import { eq, sql } from 'drizzle-orm'
import { app } from '../app.ts'
import { db } from '../db/client.ts'
import { appointments, consultations } from '../db/schema.ts'
import { seed } from '../db/seed.ts'

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

/** A waiting appointment with no consultation yet. */
async function freshAppointment(): Promise<string> {
  const rows = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(eq(appointments.status, 'waiting'))
    .limit(1)
  const id = rows[0]?.id
  if (!id) throw new Error('seed has no waiting appointment')
  return id
}

const note = (): StructuredNote => ({
  ...emptyStructuredNote(),
  chiefComplaint: { text: 'Fever', sourceSpan: 'fever since 3 days' },
})

beforeEach(async () => {
  await seed()
})

describe('POST /consultations (F4)', () => {
  test('creates a draft and returns 201', async () => {
    const appointmentId = await freshAppointment()
    const { status, body } = await call<{
      consultation: { id: string; status: string; rawNotes: string }
    }>('POST', '/consultations', { appointmentId, rawNotes: 'fever since 3 days' })

    expect(status).toBe(201)
    expect(body.consultation.status).toBe('draft')
    expect(body.consultation.rawNotes).toBe('fever since 3 days')
  })

  test('rawNotes is optional -- the composer opens before anything is typed', async () => {
    const appointmentId = await freshAppointment()
    const { status, body } = await call<{ consultation: { rawNotes: string } }>(
      'POST',
      '/consultations',
      { appointmentId },
    )
    expect(status).toBe(201)
    expect(body.consultation.rawNotes).toBe('')
  })

  test('a second consultation for the same appointment is 409', async () => {
    const appointmentId = await freshAppointment()
    await call('POST', '/consultations', { appointmentId })

    const { status, body } = await call<{ error: { code: string } }>(
      'POST',
      '/consultations',
      { appointmentId },
    )
    expect(status).toBe(409)
    expect(body.error.code).toBe('CONSULTATION_EXISTS')
  })

  test('an unknown appointment is 404', async () => {
    const { status, body } = await call<{ error: { code: string } }>(
      'POST',
      '/consultations',
      { appointmentId: MISSING_UUID },
    )
    expect(status).toBe(404)
    expect(body.error.code).toBe('APPOINTMENT_NOT_FOUND')
  })

  test('E3: notes over the cap are rejected server-side', async () => {
    const appointmentId = await freshAppointment()
    const { status, body } = await call<{ error: { code: string } }>(
      'POST',
      '/consultations',
      { appointmentId, rawNotes: 'x'.repeat(10_001) },
    )
    expect(status).toBe(422)
    // Either the schema's maxLength or the service's own check fires; both
    // are server-side, which is the point.
    expect(['VALIDATION_FAILED', 'NOTES_TOO_LONG']).toContain(body.error.code)
  })
})

describe('PATCH /consultations/:id (F6)', () => {
  test('saves edits to a draft', async () => {
    const appointmentId = await freshAppointment()
    const { body: created } = await call<{ consultation: { id: string } }>(
      'POST',
      '/consultations',
      { appointmentId },
    )

    const { status, body } = await call<{
      consultation: { rawNotes: string; confirmedNote: StructuredNote | null }
    }>('PATCH', `/consultations/${created.consultation.id}`, {
      rawNotes: 'corrected notes',
      confirmedNote: note(),
    })

    expect(status).toBe(200)
    expect(body.consultation.rawNotes).toBe('corrected notes')
    expect(body.consultation.confirmedNote?.chiefComplaint?.text).toBe('Fever')
  })

  test('a confirmed consultation is immutable -- 409 ALREADY_CONFIRMED', async () => {
    const appointmentId = await freshAppointment()
    const { body: created } = await call<{ consultation: { id: string } }>(
      'POST',
      '/consultations',
      { appointmentId },
    )
    await call('POST', `/consultations/${created.consultation.id}/confirm`, {
      confirmedNote: note(),
    })

    const { status, body } = await call<{ error: { code: string } }>(
      'PATCH',
      `/consultations/${created.consultation.id}`,
      { rawNotes: 'sneaky amendment' },
    )
    expect(status).toBe(409)
    expect(body.error.code).toBe('ALREADY_CONFIRMED')
  })

  test('an unknown consultation is 404', async () => {
    const { status, body } = await call<{ error: { code: string } }>(
      'PATCH',
      `/consultations/${MISSING_UUID}`,
      { rawNotes: 'x' },
    )
    expect(status).toBe(404)
    expect(body.error.code).toBe('CONSULTATION_NOT_FOUND')
  })
})

describe('POST /consultations/:id/confirm (F7)', () => {
  test('confirms a draft and it appears in patient history', async () => {
    const appointmentId = await freshAppointment()
    const [appt] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1)

    const { body: created } = await call<{ consultation: { id: string } }>(
      'POST',
      '/consultations',
      { appointmentId, rawNotes: 'fever since 3 days' },
    )
    const { status } = await call(
      'POST',
      `/consultations/${created.consultation.id}/confirm`,
      {
        confirmedNote: note(),
      },
    )
    expect(status).toBe(200)

    const history = await call<{ consultations: Array<{ id: string }> }>(
      'GET',
      `/patients/${appt?.patientId}/consultations`,
    )
    expect(history.body.consultations.map((c) => c.id)).toContain(created.consultation.id)
  })

  test('E25: confirming twice returns 200 both times and creates ONE row', async () => {
    const appointmentId = await freshAppointment()
    const { body: created } = await call<{ consultation: { id: string } }>(
      'POST',
      '/consultations',
      { appointmentId },
    )
    const id = created.consultation.id

    // Two calls straight at the endpoint -- the UI is not involved.
    const first = await call<{ consultation: { status: string } }>(
      'POST',
      `/consultations/${id}/confirm`,
      { confirmedNote: note() },
    )
    const second = await call<{ consultation: { status: string } }>(
      'POST',
      `/consultations/${id}/confirm`,
      { confirmedNote: note() },
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.consultation.status).toBe('confirmed')
    expect(second.body.consultation.status).toBe('confirmed')

    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(consultations)
      .where(eq(consultations.appointmentId, appointmentId))
    expect(count?.n).toBe(1)
  })

  test('E25 concurrently: two simultaneous confirms still leave one row', async () => {
    const appointmentId = await freshAppointment()
    const { body: created } = await call<{ consultation: { id: string } }>(
      'POST',
      '/consultations',
      { appointmentId },
    )
    const id = created.consultation.id

    const [a, b] = await Promise.all([
      call<{ consultation: { status: string } }>('POST', `/consultations/${id}/confirm`, {
        confirmedNote: note(),
      }),
      call<{ consultation: { status: string } }>('POST', `/consultations/${id}/confirm`, {
        confirmedNote: note(),
      }),
    ])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)

    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(consultations)
      .where(eq(consultations.id, id))
    expect(count?.n).toBe(1)
  })

  test('E29: a consultation with every AI field empty can be confirmed', async () => {
    // Free-text notes alone are a valid consultation. Nothing forces the
    // doctor to have used the AI at all -- that is the E23 guarantee too.
    const appointmentId = await freshAppointment()
    const { body: created } = await call<{ consultation: { id: string } }>(
      'POST',
      '/consultations',
      { appointmentId, rawNotes: 'seen, well, no complaints' },
    )

    const { status, body } = await call<{ consultation: { status: string } }>(
      'POST',
      `/consultations/${created.consultation.id}/confirm`,
      { confirmedNote: emptyStructuredNote() },
    )
    expect(status).toBe(200)
    expect(body.consultation.status).toBe('confirmed')
  })

  test('confirming an unknown consultation is 404, not a silent success', async () => {
    const { status, body } = await call<{ error: { code: string } }>(
      'POST',
      `/consultations/${MISSING_UUID}/confirm`,
      { confirmedNote: note() },
    )
    expect(status).toBe(404)
    expect(body.error.code).toBe('CONSULTATION_NOT_FOUND')
  })
})

describe('PATCH /appointments/:id/status (F15, E31)', () => {
  async function appointmentWithStatus(status: AppointmentStatus): Promise<string> {
    const rows = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.status, status))
      .limit(1)
    const id = rows[0]?.id
    if (!id) throw new Error(`seed has no ${status} appointment`)
    return id
  }

  test('waiting -> in_consultation is allowed', async () => {
    const id = await appointmentWithStatus('waiting')
    const { status, body } = await call<{ appointment: { status: string } }>(
      'PATCH',
      `/appointments/${id}/status`,
      { status: 'in_consultation' },
    )
    expect(status).toBe(200)
    expect(body.appointment.status).toBe('in_consultation')
  })

  test('in_consultation -> completed is allowed', async () => {
    const id = await appointmentWithStatus('in_consultation')
    const { status, body } = await call<{ appointment: { status: string } }>(
      'PATCH',
      `/appointments/${id}/status`,
      { status: 'completed' },
    )
    expect(status).toBe(200)
    expect(body.appointment.status).toBe('completed')
  })

  test('in_consultation -> waiting is allowed as an undo', async () => {
    const id = await appointmentWithStatus('in_consultation')
    const { status } = await call('PATCH', `/appointments/${id}/status`, {
      status: 'waiting',
    })
    expect(status).toBe(200)
  })

  test('E31: completed -> waiting is REJECTED at the API', async () => {
    const id = await appointmentWithStatus('completed')
    const { status, body } = await call<{
      error: { code: string; details?: { from: string; to: string } }
    }>('PATCH', `/appointments/${id}/status`, { status: 'waiting' })

    expect(status).toBe(409)
    expect(body.error.code).toBe('INVALID_STATUS_TRANSITION')
    expect(body.error.details?.from).toBe('completed')
    expect(body.error.details?.to).toBe('waiting')
  })

  test('E31: completed -> in_consultation is also rejected', async () => {
    const id = await appointmentWithStatus('completed')
    const { status, body } = await call<{ error: { code: string } }>(
      'PATCH',
      `/appointments/${id}/status`,
      { status: 'in_consultation' },
    )
    expect(status).toBe(409)
    expect(body.error.code).toBe('INVALID_STATUS_TRANSITION')
  })

  test('waiting -> completed skips a step and is rejected', async () => {
    const id = await appointmentWithStatus('waiting')
    const { status, body } = await call<{ error: { code: string } }>(
      'PATCH',
      `/appointments/${id}/status`,
      { status: 'completed' },
    )
    expect(status).toBe(409)
    expect(body.error.code).toBe('INVALID_STATUS_TRANSITION')
  })

  test('re-applying the current status is a no-op success, not a conflict', async () => {
    const id = await appointmentWithStatus('waiting')
    const { status, body } = await call<{ appointment: { status: string } }>(
      'PATCH',
      `/appointments/${id}/status`,
      { status: 'waiting' },
    )
    expect(status).toBe(200)
    expect(body.appointment.status).toBe('waiting')
  })

  test('an invalid status value is rejected by validation', async () => {
    const id = await appointmentWithStatus('waiting')
    const { status, body } = await call<{ error: { code: string } }>(
      'PATCH',
      `/appointments/${id}/status`,
      { status: 'cancelled' },
    )
    expect(status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  test('an unknown appointment is 404', async () => {
    const { status, body } = await call<{ error: { code: string } }>(
      'PATCH',
      `/appointments/${MISSING_UUID}/status`,
      { status: 'waiting' },
    )
    expect(status).toBe(404)
    expect(body.error.code).toBe('APPOINTMENT_NOT_FOUND')
  })
})

describe('the audit trail is preserved across an edit (F13)', () => {
  test('confirming does not overwrite aiNote', async () => {
    const appointmentId = await freshAppointment()
    const { body: created } = await call<{ consultation: { id: string } }>(
      'POST',
      '/consultations',
      { appointmentId, rawNotes: 'fever since 3 days' },
    )
    const id = created.consultation.id

    // What the AI said.
    const aiVersion = note()
    await call('PATCH', `/consultations/${id}`, { aiNote: aiVersion })

    // What the doctor accepted, after editing.
    const doctorVersion: StructuredNote = {
      ...aiVersion,
      chiefComplaint: { text: 'High fever', sourceSpan: 'fever since 3 days' },
    }
    await call('POST', `/consultations/${id}/confirm`, {
      confirmedNote: doctorVersion,
    })

    const { body } = await call<{
      consultation: {
        aiNote: StructuredNote | null
        confirmedNote: StructuredNote | null
      }
    }>('GET', `/consultations/${id}`)

    // Both survive, and they differ -- that difference IS the audit trail.
    expect(body.consultation.aiNote?.chiefComplaint?.text).toBe('Fever')
    expect(body.consultation.confirmedNote?.chiefComplaint?.text).toBe('High fever')
  })
})
