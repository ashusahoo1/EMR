/**
 * Test helpers (BUILD_ROADMAP A9).
 *
 * Eden Treaty is what makes L2 cheap: passing the Elysia instance directly to
 * `treaty()` calls `app.handle` with no network request and no server to
 * start, so the whole flow runs in milliseconds with no ports and no teardown
 * flakiness (§2.5). It is also END-TO-END TYPED -- if a route's response
 * schema changes, these tests stop compiling rather than failing at runtime.
 */
import { treaty } from '@elysiajs/eden'
import type { StructuredNote } from '@emr/shared'
import { eq } from 'drizzle-orm'
import { app } from '../app.ts'
import { db } from '../db/client.ts'
import { appointments, patients } from '../db/schema.ts'
import { seed } from '../db/seed.ts'

/**
 * The typed in-process client.
 *
 * No base URL, no fetch, no port. `api.appointments.get()` resolves against
 * the app object itself.
 */
export const api = treaty(app)

/** Re-seed to a known state. Named resetDb per the step; seed() truncates. */
export async function resetDb(): Promise<void> {
  await seed()
}

/**
 * A patient's id by name, so tests read as intent rather than UUIDs.
 * Throws rather than returning undefined -- a missing fixture is a broken
 * test, not a condition to handle.
 */
export async function patientIdByName(name: string): Promise<string> {
  const [row] = await db.select().from(patients).where(eq(patients.name, name)).limit(1)
  if (!row) throw new Error(`seed is missing patient "${name}"`)
  return row.id
}

/**
 * A brand-new waiting appointment.
 *
 * Tests create their own rather than consuming a seeded one: a consultation
 * is unique per appointment, so sharing seeded rows makes tests depend on
 * execution order.
 */
export async function freshAppointment(reason = 'Test appointment'): Promise<{
  id: string
  patientId: string
  doctorId: string
}> {
  const [template] = await db.select().from(appointments).limit(1)
  if (!template) throw new Error('seed has no appointments to copy from')

  const [created] = await db
    .insert(appointments)
    .values({
      doctorId: template.doctorId,
      patientId: template.patientId,
      scheduledAt: new Date(),
      reason,
      status: 'waiting',
    })
    .returning()
  if (!created) throw new Error('failed to create test appointment')

  return {
    id: created.id,
    patientId: created.patientId,
    doctorId: created.doctorId,
  }
}

/** A note shaped like something a doctor would actually confirm. */
export function doctorNote(overrides: Partial<StructuredNote> = {}): StructuredNote {
  return {
    chiefComplaint: { text: 'Fever', sourceSpan: 'fever since 3 days' },
    symptoms: [{ text: 'Fever for 3 days', sourceSpan: 'fever since 3 days' }],
    relevantHistory: [],
    medicationsMentioned: [],
    doctorPlan: [{ text: 'Rest', sourceSpan: 'advised rest' }],
    missingInformation: [],
    ...overrides,
  }
}

/** A uuid that is syntactically valid but never exists. */
export const MISSING_UUID = '00000000-0000-4000-8000-000000000000'

/**
 * Narrow an Eden response that must have succeeded.
 *
 * Eden types `data` as `T | null` because an error is always possible. In a
 * test, a null here means the request failed, and reporting the status beats
 * a downstream "cannot read property of null".
 */
export function ok<T>(response: { data: T | null; status: number; error?: unknown }): T {
  if (response.data === null || response.data === undefined) {
    throw new Error(
      `expected a successful response, got ${response.status}: ${JSON.stringify(
        response.error,
      )}`,
    )
  }
  return response.data
}
