/**
 * The seam, exercised through the real HTTP pipeline (B0).
 *
 * llm.test.ts tests the seam in isolation. This file proves the payoff: a
 * test can steer the AI's behaviour end to end by queueing a response, with
 * no mocking of the OpenAI SDK anywhere. That is the argument for the seam
 * existing (§2.3), demonstrated rather than asserted.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { stubLlm } from '../llm/stub.ts'
import { LlmFailure } from '../llm/types.ts'
import { fakeJpeg, imageForm } from './fixtures.ts'
import { api, freshAppointment, ok, resetDb } from './helpers.ts'

/** A consultation with notes, ready to structure. */
async function draft(notes = 'fever since 3 days'): Promise<string> {
  const appointment = await freshAppointment()
  const created = ok(
    await api.consultations.post({ appointmentId: appointment.id, rawNotes: notes }),
  )
  return created.consultation.id
}

beforeEach(async () => {
  await resetDb()
  stubLlm.reset()
  process.env.LLM_ENABLED = 'true'
})

describe('a queued response steers the whole pipeline', () => {
  test('the note the stub returns is the note the API serves', async () => {
    stubLlm.queueStructure({
      chiefComplaint: { text: 'Queued by the test', sourceSpan: 'fever since 3 days' },
      symptoms: [],
      relevantHistory: [],
      medicationsMentioned: [],
      doctorPlan: [],
      missingInformation: [],
    })

    const id = await draft()
    const result = ok(await api.consultations({ id }).structure.post())

    expect(result.note.chiefComplaint?.text).toBe('Queued by the test')
  })

  test("the stub receives the consultation's stored notes, not the request body", async () => {
    // §4.8 -- structuring reads the notes the server saved. Taking them from
    // the request would let a client structure text that was never stored,
    // breaking the audit chain.
    const id = await draft('unmistakable marker text')
    await api.consultations({ id }).structure.post()

    expect(stubLlm.structureCalls.at(-1)?.notes).toBe('unmistakable marker text')
  })

  test('E11: schema-invalid output is rejected, never persisted', async () => {
    // The provider's constrained decoding guarantees shape, not truth --
    // so the service validates before anything reaches the database (§4.5).
    stubLlm.queueStructure({ chiefComplaint: 'a bare string, not an object' })

    const id = await draft()
    const response = await api.consultations({ id }).structure.post()
    expect(response.status).toBe(502)

    const stored = ok(await api.consultations({ id }).get())
    expect(stored.consultation.aiNote).toBeNull()
  })

  test('E12: an invented extra key is rejected by the schema', async () => {
    stubLlm.queueStructure({
      chiefComplaint: { text: 'Fever', sourceSpan: 'fever since 3 days' },
      symptoms: [],
      relevantHistory: [],
      medicationsMentioned: [],
      doctorPlan: [],
      missingInformation: [],
      bloodPressure: '130/80',
    })

    const id = await draft()
    const response = await api.consultations({ id }).structure.post()
    expect(response.status).toBe(502)
  })
})

describe('provider failures map to the doctor-facing contract', () => {
  const cases = [
    [LlmFailure.Timeout, 504, 'AI_TIMEOUT'],
    [LlmFailure.RateLimited, 429, 'RATE_LIMITED'],
    [LlmFailure.Unavailable, 503, 'AI_UNAVAILABLE'],
    [LlmFailure.BadOutput, 502, 'AI_GENERATION_FAILED'],
  ] as const

  for (const [failure, status, code] of cases) {
    test(`${failure} -> ${status} ${code}`, async () => {
      stubLlm.queueStructureFailure(failure)
      const id = await draft()

      const response = await api.consultations({ id }).structure.post()
      expect(response.status).toBe(status)
      expect(
        (response.error?.value as { error: { code: string } } | undefined)?.error.code,
      ).toBe(code)
    })
  }

  test('E18: a refusal is NOT_CLINICAL_NOTES, distinct from a technical error', async () => {
    stubLlm.queueTranscribeFailure(LlmFailure.Refused, 'that is a selfie')

    const form = imageForm(fakeJpeg(), 'x.jpg')
    const res = await (await import('../app.ts')).app.handle(
      new Request('http://localhost/transcribe', { method: 'POST', body: form }),
    )
    const body = (await res.json()) as { error: { code: string } }

    expect(res.status).toBe(422)
    expect(body.error.code).toBe('NOT_CLINICAL_NOTES')
  })
})

describe('transcription flows through the seam', () => {
  test('a queued transcript reaches the API, with the illegible flag set', async () => {
    stubLlm.queueTranscript('fever x3d\ntook [illegible] yesterday')

    const form = imageForm(fakeJpeg(), 'n.jpg')
    const res = await (await import('../app.ts')).app.handle(
      new Request('http://localhost/transcribe', { method: 'POST', body: form }),
    )
    const body = (await res.json()) as { text: string; hasIllegible: boolean }

    expect(res.status).toBe(200)
    expect(body.text).toContain('[illegible]')
    // §4.4 -- the frontend highlights these so the doctor's eye goes to them.
    expect(body.hasIllegible).toBe(true)
  })

  test('a clean transcript reports no illegible markers', async () => {
    stubLlm.queueTranscript('fever x3d, mild cough')

    const form = imageForm(fakeJpeg(), 'n.jpg')
    const res = await (await import('../app.ts')).app.handle(
      new Request('http://localhost/transcribe', { method: 'POST', body: form }),
    )
    const body = (await res.json()) as { hasIllegible: boolean }
    expect(body.hasIllegible).toBe(false)
  })
})
