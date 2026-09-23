/**
 * Cross-cutting guardrails (BUILD_ROADMAP B7, EMR_PLAN §4.11).
 *
 * "Each is small; skipping them is what §4.11 warns about, because they only
 * surface when something breaks -- which, during a live demo, it will."
 *
 * The roadmap is explicit about the last one: "Verify it, do not assume it."
 * So this file verifies rather than trusts, including the guardrails that
 * were already true by construction.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { LIMITS } from '@emr/shared'
import { app } from '../app.ts'
import { AppError, ErrorCode } from '../errors.ts'
import { checkRateLimit, resetRateLimits } from '../rate-limit.ts'
import { fakeJpeg } from './fixtures.ts'
import { api, doctorNote, freshAppointment, ok, resetDb } from './helpers.ts'

/** The suite-wide override from scripts/test-setup.ts, restored per test. */
const SUITE_RATE_LIMIT = process.env.AI_RATE_LIMIT_MAX ?? '100000'

beforeEach(async () => {
  await resetDb()
  resetRateLimits()
  // Undo any lowering done by exhaustBudget(), so a rate-limit test cannot
  // throttle whatever runs after it.
  process.env.AI_RATE_LIMIT_MAX = SUITE_RATE_LIMIT
  process.env.LLM_ENABLED = 'true'
})

describe("B7's done-when: LLM_ENABLED=false, full consultation end to end", () => {
  test('E23: a doctor completes a whole visit with the AI switched off', async () => {
    // §4.11 calls this "the most important one" and "the easiest guardrail
    // to skip, because it only surfaces when something breaks". The AI is an
    // accelerant, not a dependency.
    process.env.LLM_ENABLED = 'false'

    const appointment = await freshAppointment()

    // 1. Start the consultation.
    ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'in_consultation',
      }),
    )

    // 2. Write free-text notes by hand.
    const created = ok(
      await api.consultations.post({
        appointmentId: appointment.id,
        rawNotes: 'fever x3d, advised PCM and fluids, review if worse',
      }),
    )
    const id = created.consultation.id

    // 3. Generate is refused -- honestly, and with a code the UI can switch
    //    on rather than a generic failure.
    const structure = await api.consultations({ id }).structure.post()
    expect(structure.status).toBe(503)

    // 4. Transcribe is refused too.
    const form = new FormData()
    form.append('image', new File([fakeJpeg()], 'note.jpg', { type: 'image/jpeg' }))
    const transcribe = await app.handle(
      new Request('http://localhost/transcribe', { method: 'POST', body: form }),
    )
    expect(transcribe.status).toBe(503)

    // 5. The doctor writes the structured note themselves and saves it.
    const confirmed = ok(
      await api.consultations({ id }).confirm.post({
        confirmedNote: doctorNote({
          chiefComplaint: { text: 'Fever', sourceSpan: 'fever x3d' },
          symptoms: [{ text: 'Fever for 3 days', sourceSpan: 'fever x3d' }],
        }),
      }),
    )
    expect(confirmed.consultation.status).toBe('confirmed')

    // 6. And it appears in the patient's history.
    const history = ok(
      await api.patients({ id: created.consultation.patientId }).consultations.get(),
    )
    expect(history.consultations.some((row) => row.id === id)).toBe(true)
  })

  test('the refusal explains the situation rather than reporting a fault', () => {
    // A doctor reading this must understand they can carry on working, not
    // that the application is broken. The wording matters as much as the
    // status code.
    // Read through the public constructor rather than exporting the message
    // table: this is the message a client actually receives.
    expect(new AppError(ErrorCode.AI_UNAVAILABLE).message).toMatch(
      /still|manually|yourself|without/i,
    )
  })
})

describe('E21 — the AI endpoints are rate limited', () => {
  test('the limiter is wired to /structure', async () => {
    // Driven through the real HTTP path, with the budget exhausted directly
    // rather than by making a hundred calls.
    const appointment = await freshAppointment()
    const created = ok(
      await api.consultations.post({
        appointmentId: appointment.id,
        rawNotes: 'fever since 3 days',
      }),
    )

    exhaustBudget()

    const response = await api
      .consultations({ id: created.consultation.id })
      .structure.post()
    expect(response.status).toBe(429)
  })

  test('the limiter is wired to /transcribe', async () => {
    exhaustBudget()

    const form = new FormData()
    form.append('image', new File([fakeJpeg()], 'note.jpg', { type: 'image/jpeg' }))
    const response = await app.handle(
      new Request('http://localhost/transcribe', { method: 'POST', body: form }),
    )
    expect(response.status).toBe(429)
  })

  test('it returns the RATE_LIMITED code with a retry hint', async () => {
    exhaustBudget()

    const form = new FormData()
    form.append('image', new File([fakeJpeg()], 'note.jpg', { type: 'image/jpeg' }))
    const response = await app.handle(
      new Request('http://localhost/transcribe', { method: 'POST', body: form }),
    )
    const body = (await response.json()) as {
      error: { code: string; message: string; details?: { retryAfterSeconds?: number } }
    }

    expect(body.error.code).toBe('RATE_LIMITED')
    expect(body.error.details?.retryAfterSeconds).toBeGreaterThan(0)
    // The same code a provider 429 maps to: from the doctor's side it is the
    // same situation with the same remedy.
    expect(body.error.message).toMatch(/wait|moment|try again/i)
  })

  test('the READ endpoints are NOT rate limited', async () => {
    // Throttling cheap database queries would degrade the app without
    // protecting anything. The limit exists to protect the AI bill.
    exhaustBudget()
    const response = await api.appointments.get({ query: {} })
    expect(response.status).toBe(200)
  })

  test('the WRITE endpoints are NOT rate limited', async () => {
    // Critically, this includes saving. A doctor who has hit the AI limit
    // must still be able to write and confirm their note -- otherwise the
    // guardrail has become the outage it was meant to prevent.
    exhaustBudget()

    const appointment = await freshAppointment()
    const created = await api.consultations.post({
      appointmentId: appointment.id,
      rawNotes: 'written by hand while rate limited',
    })
    expect(created.status).toBe(201)
  })

  test('the rate limiter blocks BEFORE any model call is made', async () => {
    // A rejected request must cost nothing. If the limiter ran after the
    // call it would protect the response but not the bill.
    const { stubLlm } = await import('../llm/stub.ts')
    stubLlm.reset()

    exhaustBudget()

    const form = new FormData()
    form.append('image', new File([fakeJpeg()], 'note.jpg', { type: 'image/jpeg' }))
    await app.handle(
      new Request('http://localhost/transcribe', { method: 'POST', body: form }),
    )

    expect(stubLlm.transcribeCalls).toHaveLength(0)
  })
})

/**
 * Use up the current window's budget for the in-process test client.
 *
 * Lowers the limit to 1 for the duration rather than making
 * AI_RATE_LIMIT.max calls: the suite runs with a deliberately huge limit
 * (see scripts/test-setup.ts), and filling it would be a hundred thousand
 * calls against a growing array -- quadratic, and it hangs the suite.
 *
 * `beforeEach` resets both the override and the recorded hits.
 */
function exhaustBudget(): void {
  resetRateLimits()
  process.env.AI_RATE_LIMIT_MAX = '1'
  checkRateLimit('unknown')
}

describe('token and cost caps per request (§4.11)', () => {
  test('both stages have an output cap', () => {
    // The rate limiter bounds request COUNT; this bounds SPEND. One request
    // with a huge note costs more than ten small ones.
    expect(LIMITS.transcribeMaxOutputTokens).toBeGreaterThan(0)
    expect(LIMITS.structureMaxOutputTokens).toBeGreaterThan(0)
  })

  test('the caps are generous enough for a real note', () => {
    // Sized from the artefact, not guessed: a handwritten OPD note is a few
    // hundred characters, so roughly 4 chars per token puts a long one well
    // under 500 tokens. The cap must not truncate legitimate work.
    expect(LIMITS.transcribeMaxOutputTokens).toBeGreaterThan(1_000)
  })

  test('structuring gets the larger cap', () => {
    // The same clinical content plus JSON scaffolding and a duplicated
    // sourceSpan per item.
    expect(LIMITS.structureMaxOutputTokens).toBeGreaterThan(
      LIMITS.transcribeMaxOutputTokens,
    )
  })

  test('every model call is bounded by a timeout (E22)', () => {
    expect(LIMITS.llmTimeoutMs).toBeGreaterThan(0)
    expect(LIMITS.llmTimeoutMs).toBeLessThanOrEqual(60_000)
  })
})

describe('E37 — the API key is server-side only', () => {
  test('no response body contains the key, on success or failure', async () => {
    // The brief names this as its own example of a good engineering
    // decision, so it is asserted rather than assumed.
    process.env.OPENAI_API_KEY = 'sk-test-canary-value-must-never-leak'

    try {
      const appointment = await freshAppointment()
      const created = ok(
        await api.consultations.post({
          appointmentId: appointment.id,
          rawNotes: 'fever since 3 days',
        }),
      )

      const responses = await Promise.all([
        app.handle(new Request('http://localhost/health')),
        app.handle(new Request('http://localhost/appointments')),
        app.handle(
          new Request(
            `http://localhost/consultations/${created.consultation.id}/structure`,
            { method: 'POST' },
          ),
        ),
        // A deliberate 500, which is where a leak is most likely.
        app.handle(new Request('http://localhost/consultations/not-a-uuid')),
      ])

      for (const response of responses) {
        const text = await response.text()
        expect(text).not.toContain('sk-test-canary')
        expect(text).not.toContain('OPENAI_API_KEY')
      }
    } finally {
      delete process.env.OPENAI_API_KEY
    }
  })

  test('the OpenAPI document does not advertise the key', async () => {
    // /docs is public and easy to forget about.
    const response = await app.handle(new Request('http://localhost/docs/json'))
    const text = await response.text()
    expect(text).not.toContain('OPENAI_API_KEY')
  })
})
