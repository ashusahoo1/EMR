/**
 * Idempotency and state transitions (BUILD_ROADMAP A9).
 *
 * E25 -- double-clicking Save creates exactly one consultation
 * E31 -- an invalid status transition is rejected at the API
 *
 * A7 already covers these at the service level. This file exercises them
 * through the typed client, and adds the concurrency cases: "it worked when I
 * clicked twice slowly" is not the same guarantee as "it works when two
 * requests arrive together".
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { consultations } from '../db/schema.ts'
import { api, doctorNote, freshAppointment, ok, resetDb } from './helpers.ts'

async function countConsultationsFor(appointmentId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(consultations)
    .where(sql`${consultations.appointmentId} = ${appointmentId}`)
  return row?.n ?? 0
}

beforeEach(async () => {
  await resetDb()
  process.env.LLM_ENABLED = 'true'
})

describe('E25 — confirm is idempotent', () => {
  test('two sequential confirms both succeed and leave one row', async () => {
    const appointment = await freshAppointment()
    const created = ok(await api.consultations.post({ appointmentId: appointment.id }))
    const id = created.consultation.id

    const first = await api.consultations({ id }).confirm.post({
      confirmedNote: doctorNote(),
    })
    const second = await api.consultations({ id }).confirm.post({
      confirmedNote: doctorNote(),
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(ok(first).consultation.status).toBe('confirmed')
    expect(ok(second).consultation.status).toBe('confirmed')
    expect(await countConsultationsFor(appointment.id)).toBe(1)
  })

  test('five simultaneous confirms still leave one row', async () => {
    // The real double-click: requests in flight together, not one after the
    // other. The conditional UPDATE ... WHERE status = 'draft' is what makes
    // this safe rather than lucky.
    const appointment = await freshAppointment()
    const created = ok(await api.consultations.post({ appointmentId: appointment.id }))
    const id = created.consultation.id

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api.consultations({ id }).confirm.post({ confirmedNote: doctorNote() }),
      ),
    )

    for (const result of results) {
      expect(result.status).toBe(200)
    }
    expect(await countConsultationsFor(appointment.id)).toBe(1)
  })

  test('the confirmed note is not overwritten by a later duplicate click', async () => {
    // The first confirm wins. A second click carrying stale data must not
    // silently replace what was already signed off.
    const appointment = await freshAppointment()
    const created = ok(await api.consultations.post({ appointmentId: appointment.id }))
    const id = created.consultation.id

    await api.consultations({ id }).confirm.post({
      confirmedNote: doctorNote({
        chiefComplaint: { text: 'Original', sourceSpan: 'fever since 3 days' },
      }),
    })
    await api.consultations({ id }).confirm.post({
      confirmedNote: doctorNote({
        chiefComplaint: { text: 'Stale duplicate', sourceSpan: 'fever since 3 days' },
      }),
    })

    const final = ok(await api.consultations({ id }).get())
    expect(final.consultation.confirmedNote?.chiefComplaint?.text).toBe('Original')
  })
})

describe('E25 — creating a consultation is safe under concurrency', () => {
  test('simultaneous creates for one appointment produce exactly one', async () => {
    // The unique index is the guarantee here, not the pre-check: both
    // requests can pass the "does one exist?" read before either inserts.
    const appointment = await freshAppointment()

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        api.consultations.post({ appointmentId: appointment.id }),
      ),
    )

    const created = results.filter((r) => r.status === 201)
    const conflicts = results.filter((r) => r.status === 409)

    expect(created).toHaveLength(1)
    expect(conflicts).toHaveLength(3)
    expect(await countConsultationsFor(appointment.id)).toBe(1)
  })
})

describe('E31 — status transitions are guarded at the API', () => {
  const legal = [
    ['waiting', 'in_consultation'],
    ['in_consultation', 'completed'],
    ['in_consultation', 'waiting'],
  ] as const

  const illegal = [
    ['waiting', 'completed'],
    ['completed', 'waiting'],
    ['completed', 'in_consultation'],
  ] as const

  /** Drive an appointment into a given status using only legal moves. */
  async function drive(id: string, to: 'waiting' | 'in_consultation' | 'completed') {
    if (to === 'waiting') return
    await api.appointments({ id }).status.patch({ status: 'in_consultation' })
    if (to === 'completed') {
      await api.appointments({ id }).status.patch({ status: 'completed' })
    }
  }

  for (const [from, to] of legal) {
    test(`${from} -> ${to} is allowed`, async () => {
      const appointment = await freshAppointment()
      await drive(appointment.id, from)

      const result = await api.appointments({ id: appointment.id }).status.patch({
        status: to,
      })
      expect(result.status).toBe(200)
      expect(ok(result).appointment.status).toBe(to)
    })
  }

  for (const [from, to] of illegal) {
    test(`${from} -> ${to} is rejected with 409`, async () => {
      const appointment = await freshAppointment()
      await drive(appointment.id, from)

      const result = await api.appointments({ id: appointment.id }).status.patch({
        status: to,
      })
      expect(result.status).toBe(409)
    })
  }

  test('a rejected transition leaves the status unchanged', async () => {
    // Rejecting is not enough -- the row must not have moved either.
    const appointment = await freshAppointment()
    await drive(appointment.id, 'completed')

    await api.appointments({ id: appointment.id }).status.patch({ status: 'waiting' })

    const list = ok(await api.appointments.get({ query: {} }))
    const row = list.appointments.find((a) => a.id === appointment.id)
    expect(row?.status).toBe('completed')
  })

  test('re-applying the current status is a no-op success', async () => {
    const appointment = await freshAppointment()
    const result = await api.appointments({ id: appointment.id }).status.patch({
      status: 'waiting',
    })
    expect(result.status).toBe(200)
    expect(ok(result).appointment.status).toBe('waiting')
  })
})
