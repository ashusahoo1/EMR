/**
 * The AI audit trail, end to end (BUILD_ROADMAP B6, EMR_PLAN §4.8).
 *
 * B6's done-when, stated exactly: "a real call on N01 returns a verified
 * note and exactly one ai_generations row exists."
 *
 * §4.8's goal is to make it possible to answer "what did the AI say, and
 * what did the doctor actually accept?" These tests check that the row can
 * actually answer it -- not merely that a row appears.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { GenerationType, PROMPT_VERSION } from '@emr/shared'
import { desc, eq } from 'drizzle-orm'
import { app } from '../app.ts'
import { db } from '../db/client.ts'
import { aiGenerations } from '../db/schema.ts'
import { N01_TRANSCRIPT, STUB_MODEL, stubLlm } from '../llm/stub.ts'
import { LlmFailure } from '../llm/types.ts'
import { fakeJpeg } from './fixtures.ts'
import { api, freshAppointment, ok, resetDb } from './helpers.ts'

beforeEach(async () => {
  await resetDb()
  stubLlm.reset()
  process.env.LLM_ENABLED = 'true'
})

/** A draft consultation carrying the N01 notes. */
async function draftN01(): Promise<string> {
  const appointment = await freshAppointment()
  const created = ok(
    await api.consultations.post({
      appointmentId: appointment.id,
      rawNotes: N01_TRANSCRIPT,
    }),
  )
  return created.consultation.id
}

/**
 * Upload an image to /transcribe.
 *
 * Uses `app.handle` with a raw Request rather than Eden, which expects the
 * object form for multipart and rejects a bare FormData at the type layer.
 */
async function transcribe(): Promise<number> {
  const form = new FormData()
  form.append('image', new File([fakeJpeg()], 'note.jpg', { type: 'image/jpeg' }))
  const res = await app.handle(
    new Request('http://localhost/transcribe', { method: 'POST', body: form }),
  )
  return res.status
}

/** The most recently written audit row. */
async function latestRow() {
  const [row] = await db
    .select()
    .from(aiGenerations)
    .orderBy(desc(aiGenerations.createdAt))
    .limit(1)
  return row
}

/** Every audit row for a consultation, newest last. */
async function rowsFor(consultationId: string) {
  return await db
    .select()
    .from(aiGenerations)
    .where(eq(aiGenerations.consultationId, consultationId))
    .orderBy(aiGenerations.createdAt)
}

describe("B6's done-when: N01 end to end", () => {
  test('a call on N01 returns a verified note and writes exactly one row', async () => {
    const id = await draftN01()

    const result = ok(await api.consultations({ id }).structure.post())

    // Verified, not merely returned.
    expect(result.verification.status).toBe('passed')
    expect(result.verification.flags).toEqual([])
    expect(result.note.chiefComplaint?.text).toBe('Fever')

    // EXACTLY one row -- a clean call must not retry.
    const rows = await rowsFor(id)
    expect(rows).toHaveLength(1)
    expect(stubLlm.structureCalls).toHaveLength(1)
  })

  test('the row can answer "what did the AI say?"', async () => {
    const id = await draftN01()
    ok(await api.consultations({ id }).structure.post())

    const [row] = await rowsFor(id)

    // The input that was sent...
    expect(row?.input).toBe(N01_TRANSCRIPT)
    // ...and exactly what came back, unmodified.
    expect(row?.rawOutput).toMatchObject({ chiefComplaint: { text: 'Fever' } })
  })

  test('the row records model and prompt version (§4.8)', async () => {
    // "Without it the audit trail is uninterpretable six months later."
    const id = await draftN01()
    ok(await api.consultations({ id }).structure.post())

    const [row] = await rowsFor(id)
    expect(row?.model).toBe(STUB_MODEL)
    expect(row?.promptVersion).toBe(PROMPT_VERSION.structuring)
    expect(row?.type).toBe(GenerationType.Structuring)
  })

  test('the row records the verification outcome and its flags', async () => {
    const id = await draftN01()
    ok(await api.consultations({ id }).structure.post())

    const [row] = await rowsFor(id)
    expect(row?.verificationStatus).toBe('passed')
    expect(row?.verificationFlags).toEqual([])
  })

  test('latency and token counts are captured', async () => {
    const id = await draftN01()
    ok(await api.consultations({ id }).structure.post())

    const [row] = await rowsFor(id)
    expect(row?.latencyMs).not.toBeNull()
    expect(row?.inputTokens).not.toBeNull()
    expect(row?.outputTokens).not.toBeNull()
  })
})

describe('failures are audited too (B6)', () => {
  test('a flagged generation still writes a row', async () => {
    // "Write the ai_generations row EVEN WHEN verification fails -- a failed
    // generation is exactly what an audit trail is for."
    const appointment = await freshAppointment()
    const created = ok(
      await api.consultations.post({
        appointmentId: appointment.id,
        rawNotes: 'follow up for hypertension',
      }),
    )
    const id = created.consultation.id

    // A fabricated BP: grounded nowhere, and the brief's headline case.
    const fabricated = {
      chiefComplaint: {
        text: 'Hypertension follow-up',
        sourceSpan: 'follow up for hypertension',
      },
      symptoms: [{ text: 'BP 130/80', sourceSpan: 'follow up for hypertension' }],
      relevantHistory: [],
      medicationsMentioned: [],
      doctorPlan: [],
      missingInformation: [],
    }
    stubLlm.queueStructure(fabricated)
    stubLlm.queueStructure(fabricated) // the retry returns it again

    const result = ok(await api.consultations({ id }).structure.post())
    expect(result.verification.status).toBe('flagged')

    const rows = await rowsFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.verificationStatus).toBe('flagged')
    // The flags themselves, not just the status: six months later
    // "flagged" alone cannot say whether it was a fabricated BP or a
    // re-punctuated span.
    expect(rows[0]?.verificationFlags).not.toEqual([])
  })

  test('a provider failure writes a row with the error code', async () => {
    const id = await draftN01()
    stubLlm.queueStructureFailure(LlmFailure.Timeout)

    const response = await api.consultations({ id }).structure.post()
    expect(response.status).toBe(504)

    const rows = await rowsFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.errorCode).toBe('AI_TIMEOUT')
    // Verification never ran, so there is no verification result to record.
    // Recording `failed` would conflate "produced something wrong" with
    // "produced nothing".
    expect(rows[0]?.verificationStatus).toBeNull()
    expect(rows[0]?.rawOutput).toBeNull()
  })

  test('a hard schema failure writes a row before the request errors', async () => {
    const id = await draftN01()
    stubLlm.queueStructure({ not: 'a note' })
    stubLlm.queueStructure({ still: 'not a note' })

    const response = await api.consultations({ id }).structure.post()
    expect(response.status).toBe(502)

    const rows = await rowsFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.verificationStatus).toBe('failed')
    // The raw output is kept even though it was rejected -- that is the
    // whole point of an audit trail.
    //
    // It is the FIRST attempt's output, not the retry's: when a retry also
    // comes back invalid the service keeps the original rather than
    // adopting a second bad response, so that is what was considered.
    expect(rows[0]?.rawOutput).toEqual({ not: 'a note' })
  })
})

describe('the retry writes one row, not two', () => {
  test('a rescued generation records the attempt that was kept', async () => {
    // One row per RESULT, not per HTTP call to the provider. The row
    // describes what the doctor was shown.
    const id = await draftN01()
    stubLlm.queueStructure({ malformed: true })
    // The retry falls through to the stub's good N01 default.

    const result = ok(await api.consultations({ id }).structure.post())
    expect(result.verification.status).toBe('passed')
    expect(result.verification.repaired).toBe(true)

    const rows = await rowsFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.verificationStatus).toBe('passed')
  })

  test('regenerating adds a second row (§7.3)', async () => {
    // "Regenerating produces several attempts against one consultation.
    // Columns cannot hold that; a row per attempt can."
    const id = await draftN01()
    ok(await api.consultations({ id }).structure.post())
    ok(await api.consultations({ id }).structure.post())

    expect(await rowsFor(id)).toHaveLength(2)
  })
})

describe('transcription is audited separately (§7.3)', () => {
  test('a transcription writes a row with no consultation parent', async () => {
    expect(await transcribe()).toBe(200)

    const row = await latestRow()
    expect(row?.type).toBe(GenerationType.Transcription)
    // Null by design: a transcription happens before the doctor has
    // committed to a consultation.
    expect(row?.consultationId).toBeNull()
    expect(row?.promptVersion).toBe(PROMPT_VERSION.transcription)
  })

  test('the image itself is never stored (§2.3)', async () => {
    // Only a description of it. Storing bytes would mean object storage, a
    // lifecycle policy and a far larger data-protection footprint.
    expect(await transcribe()).toBe(200)

    const row = await latestRow()
    // Dimensions and size, so the trail can say what was submitted without
    // retaining the image itself.
    expect(row?.input).toContain('1200x900')
    expect(row?.input).toContain('jpeg')
    expect(row?.rawOutput).toBe(N01_TRANSCRIPT)
  })

  test('the two stages are discriminated by type, in one table', async () => {
    const id = await draftN01()
    ok(await api.consultations({ id }).structure.post())
    expect(await transcribe()).toBe(200)

    const all = await db.select().from(aiGenerations)
    const types = all.map((row) => row.type).sort()
    expect(types).toEqual([GenerationType.Structuring, GenerationType.Transcription])
  })
})

describe('the audit write never breaks the request', () => {
  test('the doctor still gets their note if the audit insert fails', async () => {
    // Losing an audit row is bad. Failing a clinical request because
    // bookkeeping failed is worse.
    const id = await draftN01()

    const original = db.insert.bind(db)
    // biome-ignore lint/suspicious/noExplicitAny: narrowly stubbing one method
    ;(db as any).insert = (table: unknown) => {
      if (table === aiGenerations) throw new Error('simulated audit failure')
      return original(table as Parameters<typeof original>[0])
    }

    try {
      const result = ok(await api.consultations({ id }).structure.post())
      expect(result.note.chiefComplaint?.text).toBe('Fever')
      expect(result.verification.status).toBe('passed')
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: restoring the stub
      ;(db as any).insert = original
    }

    // And nothing was written, which is the condition we simulated.
    expect(await rowsFor(id)).toHaveLength(0)
  })
})
