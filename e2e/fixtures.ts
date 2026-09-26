/**
 * Shared E2E fixtures.
 *
 * Two things every spec needs and none should reimplement:
 *
 *   1. A known database. `resetDb` re-seeds through the API's own seed
 *      script, so every spec starts from the same six appointments and the
 *      same four past consultations that the manual test plan describes.
 *   2. Direct API access for SETUP and ASSERTION only. Reaching into the API
 *      to create a consultation is fine; reaching into it to *drive* the flow
 *      under test is not -- that is exactly the mistake that let three bugs
 *      through the L2 suite. If a spec needs a consultation in a given state,
 *      it clicks its way there.
 */

import { spawnSync } from 'node:child_process'
import { test as base, expect } from '@playwright/test'
import { API_PORT, API_URL } from '../playwright.config'

/** Re-seed the E2E database. Runs the same script `bun run seed` does. */
export function resetDb(): void {
  const result = spawnSync('bun', ['run', 'src/db/seed.ts'], {
    cwd: 'apps/api',
    env: { ...process.env, PORT: String(API_PORT), NODE_ENV: 'test' },
    stdio: 'pipe',
    shell: true,
  })
  if (result.status !== 0) {
    throw new Error(`seed failed:\n${result.stderr?.toString() ?? ''}`)
  }
}

export interface AppointmentRow {
  id: string
  scheduledAt: string
  reason: string | null
  status: string
  patient: { id: string; name: string; age: number; sex: string }
  consultationId: string | null
}

/** Today's appointments, straight from the API. */
export async function listAppointments(): Promise<AppointmentRow[]> {
  const res = await fetch(`${API_URL}/appointments`)
  const body = (await res.json()) as { appointments: AppointmentRow[] }
  return body.appointments
}

/** A patient's id by name -- tests should read as intent, not UUIDs. */
export async function patientId(name: string): Promise<string> {
  const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(name)}`)
  const body = (await res.json()) as { patients: Array<{ id: string; name: string }> }
  const match = body.patients.find((p) => p.name === name)
  if (!match) throw new Error(`seed has no patient named "${name}"`)
  return match.id
}

/** History entries for a patient, as the API returns them. */
export async function history(patient: string): Promise<unknown[]> {
  const id = await patientId(patient)
  const res = await fetch(`${API_URL}/patients/${id}/consultations`)
  const body = (await res.json()) as { consultations: unknown[] }
  return body.consultations
}

/**
 * The stub's fixed transcript / the N01 golden-set note text.
 *
 * Paste this into the notes box and the stub's structured output grounds
 * against it perfectly -- zero verification flags. Anything else and the
 * flags fire, which is correct and is what several specs rely on.
 */
export const N01_NOTES = [
  'fever since 3 days, mild cough',
  'no breathing difficulty',
  'took paracetamol yesterday',
  'allergic to penicillin',
  'advised hydration, rest',
  'return if symptoms worsen',
].join('\n')

/**
 * Re-seed before each test so order never matters and one test's saves
 * cannot leak into another's counts.
 *
 * Typed as `undefined` rather than `void`: Playwright's fixture value is what
 * `use()` is called with, and `void` as a value type is the confusing thing
 * the linter objects to. The fixture is `auto`, so specs never reference it.
 */
export const test = base.extend<{ freshDb: undefined }>({
  freshDb: [
    // Playwright parses this signature statically and REQUIRES the object
    // destructuring form -- a named parameter is rejected at load time. So
    // the empty pattern the linter dislikes is not a style choice here.
    // biome-ignore lint/correctness/noEmptyPattern: required by Playwright
    async ({}, use) => {
      resetDb()
      await use(undefined)
    },
    { auto: true },
  ],
})

export { expect }
