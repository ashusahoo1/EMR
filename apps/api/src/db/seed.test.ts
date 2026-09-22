/**
 * Seed integrity (BUILD_ROADMAP A4).
 *
 * These hit the real database. They are cheap, and they guard two properties
 * that fail silently and embarrassingly: a seed that doubles its rows on the
 * second run, and a seed dated in the past so the reviewer's dashboard is
 * empty on first launch.
 */
import { describe, expect, test } from 'bun:test'
import { sql as dsql, eq } from 'drizzle-orm'
import { db } from './client.ts'
import { appointments, consultations, doctors, patients } from './schema.ts'
import { seed } from './seed.ts'

/**
 * Narrows away `T | undefined` by failing the test rather than asserting.
 * `?.` would quietly query with `undefined` and pass for the wrong reason.
 */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to exist in the seed`)
  return value
}

/** Appointments whose local calendar date is today. */
async function todaysAppointmentCount(): Promise<number> {
  const rows = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(appointments)
    .where(dsql`${appointments.scheduledAt}::date = current_date`)
  return rows[0]?.n ?? 0
}

describe('seed', () => {
  test('is idempotent -- twice leaves 6 appointments today, not 12', async () => {
    await seed()
    const first = await todaysAppointmentCount()
    await seed()
    const second = await todaysAppointmentCount()

    expect(first).toBe(6)
    expect(second).toBe(6)
  })

  test('seeds exactly one doctor and twelve patients', async () => {
    await seed()
    const [d] = await db.select({ n: dsql<number>`count(*)::int` }).from(doctors)
    const [p] = await db.select({ n: dsql<number>`count(*)::int` }).from(patients)
    expect(d?.n).toBe(1)
    expect(p?.n).toBe(12)
  })

  test("today's appointments span all three statuses", async () => {
    await seed()
    const rows = await db
      .select({ status: appointments.status, n: dsql<number>`count(*)::int` })
      .from(appointments)
      .where(dsql`${appointments.scheduledAt}::date = current_date`)
      .groupBy(appointments.status)

    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]))
    expect(byStatus.completed).toBe(2)
    expect(byStatus.in_consultation).toBe(1)
    expect(byStatus.waiting).toBe(3)
  })

  test('dates are relative to today, not hardcoded', async () => {
    await seed()
    // If the fixture were hardcoded to a past date this would be 0, and the
    // reviewer would see an empty dashboard that reads as a broken app.
    expect(await todaysAppointmentCount()).toBeGreaterThan(0)
  })

  test('E28: at least one patient has no consultation history', async () => {
    await seed()
    const [kavita] = await db
      .select()
      .from(patients)
      .where(eq(patients.name, 'Kavita Rao'))
    const kavitaRow = must(kavita, 'Kavita Rao')

    const history = await db
      .select()
      .from(consultations)
      .where(eq(consultations.patientId, kavitaRow.id))
    expect(history).toHaveLength(0)
  })

  test('F3: history is non-empty for at least one patient', async () => {
    await seed()
    const [ramesh] = await db
      .select()
      .from(patients)
      .where(eq(patients.name, 'Ramesh Iyer'))
    const history = await db
      .select()
      .from(consultations)
      .where(eq(consultations.patientId, must(ramesh, 'Ramesh Iyer').id))
    expect(history.length).toBeGreaterThanOrEqual(2)
  })

  test('E17 fixture: Sunita Devi carries a sulfa allergy into relevantHistory', async () => {
    await seed()
    const [sunita] = await db
      .select()
      .from(patients)
      .where(eq(patients.name, 'Sunita Devi'))
    const sunitaRow = must(sunita, 'Sunita Devi')
    expect(sunitaRow.allergies).toContain('Sulfa drugs')

    const history = await db
      .select()
      .from(consultations)
      .where(eq(consultations.patientId, sunitaRow.id))
    const allHistoryText = history.flatMap(
      (c) => c.confirmedNote?.relevantHistory.map((h) => h.text) ?? [],
    )
    expect(allHistoryText).toContain('Sulfa drug allergy')
  })

  test('seeded consultations are confirmed with no fabricated AI attempt', async () => {
    await seed()
    const rows = await db.select().from(consultations)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.status).toBe('confirmed')
      expect(row.confirmedNote).not.toBeNull()
      // Seeded history predates the AI feature. Inventing ai_note rows here
      // would put fiction in the audit trail F13 exists to make trustworthy.
      expect(row.aiNote).toBeNull()
    }
  })
})
