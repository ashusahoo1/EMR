/**
 * Read routes (BUILD_ROADMAP A6).
 *
 * In-process via app.handle -- no port, no network. Seeded once for the file,
 * since these are all read-only.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { app } from '../app.ts'
import { db } from '../db/client.ts'
import { patients } from '../db/schema.ts'
import { seed } from '../db/seed.ts'

const get = (path: string) => app.handle(new Request(`http://localhost${path}`))

async function json<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await get(path)
  return { status: res.status, body: (await res.json()) as T }
}

/** A seeded patient id by name, so tests do not hardcode UUIDs. */
async function patientIdByName(name: string): Promise<string> {
  const [row] = await db.select().from(patients).where(eq(patients.name, name)).limit(1)
  if (!row) throw new Error(`seed is missing patient ${name}`)
  return row.id
}

const MISSING_UUID = '00000000-0000-4000-8000-000000000000'

beforeAll(async () => {
  await seed()
})

describe('GET /appointments (F1)', () => {
  test("returns today's six seeded appointments, earliest first", async () => {
    const { status, body } = await json<{
      appointments: Array<{ scheduledAt: string; patient: { name: string } }>
    }>('/appointments')

    expect(status).toBe(200)
    expect(body.appointments).toHaveLength(6)

    const times = body.appointments.map((a) => a.scheduledAt)
    expect([...times]).toEqual([...times].sort())
  })

  test('each row carries the patient and a consultation id or null', async () => {
    const { body } = await json<{
      appointments: Array<{
        patient: { id: string; name: string; age: number; sex: string }
        consultationId: string | null
        status: string
      }>
    }>('/appointments')

    for (const row of body.appointments) {
      expect(row.patient.name).toBeTruthy()
      expect(row.patient.age).toBeGreaterThan(0)
      expect(['waiting', 'in_consultation', 'completed']).toContain(row.status)
      // null is meaningful here: no consultation started yet.
      expect(row.consultationId === null || typeof row.consultationId === 'string').toBe(
        true,
      )
    }
  })

  test('E28: a day with no appointments returns an empty list, not an error', async () => {
    const { status, body } = await json<{ appointments: unknown[] }>(
      '/appointments?date=1999-01-01',
    )
    expect(status).toBe(200)
    expect(body.appointments).toEqual([])
  })

  test('"today" is the clinic day, not the server\'s UTC day', async () => {
    // The naive `scheduled_at::date = current_date` returns 0 rows whenever
    // the clinic date and the UTC date disagree -- which is every day
    // between midnight and 05:30 IST. This must not.
    const { body } = await json<{ appointments: unknown[] }>('/appointments')
    expect(body.appointments.length).toBe(6)
  })

  test('a malformed date is rejected at the boundary', async () => {
    const { status, body } = await json<{ error: { code: string } }>(
      '/appointments?date=not-a-date',
    )
    expect(status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('GET /patients/:id (F2)', () => {
  test('returns demographics, allergies and conditions', async () => {
    const id = await patientIdByName('Sunita Devi')
    const { status, body } = await json<{
      patient: { name: string; allergies: string[]; existingConditions: string[] }
    }>(`/patients/${id}`)

    expect(status).toBe(200)
    expect(body.patient.name).toBe('Sunita Devi')
    // The E17 fixture -- this allergy is the one that must never be dropped.
    expect(body.patient.allergies).toContain('Sulfa drugs')
    expect(body.patient.existingConditions).toContain('Type 2 Diabetes Mellitus')
  })

  test('a missing patient is 404 PATIENT_NOT_FOUND, not 200 with null', async () => {
    const { status, body } = await json<{ error: { code: string } }>(
      `/patients/${MISSING_UUID}`,
    )
    expect(status).toBe(404)
    expect(body.error.code).toBe('PATIENT_NOT_FOUND')
  })

  test('a malformed id is 422, not 500', async () => {
    const { status, body } = await json<{ error: { code: string } }>(
      '/patients/not-a-uuid',
    )
    expect(status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('GET /patients/:id/consultations (F3)', () => {
  test('returns confirmed consultations, most recent first', async () => {
    const id = await patientIdByName('Ramesh Iyer')
    const { status, body } = await json<{
      consultations: Array<{ createdAt: string; status: string }>
    }>(`/patients/${id}/consultations`)

    expect(status).toBe(200)
    expect(body.consultations.length).toBeGreaterThanOrEqual(2)

    const dates = body.consultations.map((c) => c.createdAt)
    expect([...dates]).toEqual([...dates].sort().reverse())
    for (const c of body.consultations) expect(c.status).toBe('confirmed')
  })

  test('the structured note survives the round trip intact', async () => {
    const id = await patientIdByName('Sunita Devi')
    const { body } = await json<{
      consultations: Array<{
        confirmedNote: { relevantHistory: Array<{ text: string }> } | null
      }>
    }>(`/patients/${id}/consultations`)

    const allHistory = body.consultations.flatMap(
      (c) => c.confirmedNote?.relevantHistory.map((h) => h.text) ?? [],
    )
    expect(allHistory).toContain('Sulfa drug allergy')
  })

  test('E28: a patient with no history returns an empty list', async () => {
    const id = await patientIdByName('Kavita Rao')
    const { status, body } = await json<{ consultations: unknown[] }>(
      `/patients/${id}/consultations`,
    )
    expect(status).toBe(200)
    expect(body.consultations).toEqual([])
  })

  test('history for a missing patient is 404, distinguishable from empty', async () => {
    const { status, body } = await json<{ error: { code: string } }>(
      `/patients/${MISSING_UUID}/consultations`,
    )
    expect(status).toBe(404)
    expect(body.error.code).toBe('PATIENT_NOT_FOUND')
  })
})

describe('GET /consultations/:id (F6 reload)', () => {
  test('returns both the AI output and the confirmed version', async () => {
    const patientId = await patientIdByName('Ramesh Iyer')
    const { body: history } = await json<{ consultations: Array<{ id: string }> }>(
      `/patients/${patientId}/consultations`,
    )
    const first = history.consultations[0]
    expect(first).toBeDefined()

    const { status, body } = await json<{
      consultation: { aiNote: unknown; confirmedNote: unknown; status: string }
    }>(`/consultations/${first?.id}`)

    expect(status).toBe(200)
    // Separate columns, both present in the payload -- F14 provenance needs
    // to show what the AI said next to what the doctor accepted.
    expect(body.consultation).toHaveProperty('aiNote')
    expect(body.consultation).toHaveProperty('confirmedNote')
    expect(body.consultation.confirmedNote).not.toBeNull()
  })

  test('a missing consultation is 404 CONSULTATION_NOT_FOUND', async () => {
    const { status, body } = await json<{ error: { code: string } }>(
      `/consultations/${MISSING_UUID}`,
    )
    expect(status).toBe(404)
    expect(body.error.code).toBe('CONSULTATION_NOT_FOUND')
  })
})

describe('GET /search (F17)', () => {
  test('finds a patient by partial name', async () => {
    const { status, body } = await json<{
      patients: Array<{ name: string }>
    }>('/search?q=sunit')

    expect(status).toBe(200)
    expect(body.patients.map((p) => p.name)).toContain('Sunita Devi')
  })

  test('finds a consultation by note content', async () => {
    const { body } = await json<{
      consultations: Array<{ patientName: string; excerpt: string }>
    }>('/search?q=amlodipine')

    expect(body.consultations.length).toBeGreaterThan(0)
    expect(body.consultations[0]?.excerpt.toLowerCase()).toContain('amlodipine')
  })

  test('a query under two characters is 422 QUERY_TOO_SHORT', async () => {
    const { status, body } = await json<{ error: { code: string } }>('/search?q=a')
    expect(status).toBe(422)
    expect(body.error.code).toBe('QUERY_TOO_SHORT')
  })

  test('a nonsense query returns empty lists, not an error', async () => {
    const { status, body } = await json<{
      patients: unknown[]
      consultations: unknown[]
    }>('/search?q=zzzznomatch')

    expect(status).toBe(200)
    expect(body.patients).toEqual([])
    expect(body.consultations).toEqual([])
  })

  test('LIKE metacharacters are treated literally, not as wildcards', async () => {
    // Unescaped, "%a" would match every patient containing an "a".
    // %25 is the URL encoding of a literal "%".
    const { status, body } = await json<{ patients: unknown[] }>('/search?q=%25a')
    expect(status).toBe(200)
    expect(body.patients).toEqual([])

    // Same for the single-character wildcard: "_" must not match "a".
    const underscore = await json<{ patients: unknown[] }>('/search?q=_a')
    expect(underscore.body.patients).toEqual([])
  })
})
