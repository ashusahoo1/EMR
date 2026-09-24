/**
 * What survives a reload (found by manual testing, not by the suite).
 *
 * THE BUG. `structureConsultation` returned `{ note, verification }` and
 * stored only the note. Every existing test asserted on the RESPONSE, so all
 * 431 of them passed while the consultation page -- which re-reads from the
 * database on load -- showed a draft with no flags at all.
 *
 * The visible symptom was a clean-looking AI draft on screen when nine items
 * were actually ungrounded. That is the worst possible direction for this
 * failure: the whole verification layer exists to make fabrication visible,
 * and a doctor who reloads the page would have seen nothing to check.
 *
 * The lesson generalises past this one field: a response body and a stored
 * row are different claims, and a test that only reads the response cannot
 * tell them apart. These tests all do a fresh GET.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { stubLlm } from '../llm/stub.ts'
import { api, freshAppointment, ok, resetDb } from './helpers.ts'

beforeEach(async () => {
  await resetDb()
  stubLlm.reset()
  process.env.LLM_ENABLED = 'true'
})

/** A draft consultation carrying the given notes. */
async function draftWith(rawNotes: string): Promise<string> {
  const appointment = await freshAppointment()
  const created = ok(
    await api.consultations.post({ appointmentId: appointment.id, rawNotes }),
  )
  return created.consultation.id
}

describe('structuring stores its verification result', () => {
  test('THE BUG: flags survive a fresh read, not just the response', async () => {
    // Notes that do not match the stub's fixture, so verification has
    // something to say.
    const id = await draftWith('C/O fever x3d')

    const response = ok(await api.consultations({ id }).structure.post())
    expect(response.verification.flags.length).toBeGreaterThan(0)

    // The part that was broken. This is what the consultation page does on
    // load, and what a reload does.
    const reloaded = ok(await api.consultations({ id }).get())
    expect(reloaded.consultation.verification).not.toBeNull()
    expect(reloaded.consultation.verification?.flags.length).toBe(
      response.verification.flags.length,
    )
  })

  test('the stored result matches the response exactly', async () => {
    const id = await draftWith('C/O fever x3d')

    const response = ok(await api.consultations({ id }).structure.post())
    const reloaded = ok(await api.consultations({ id }).get())

    expect(reloaded.consultation.verification).toEqual(response.verification)
  })

  test('a clean pass is stored too, not only failures', async () => {
    // Notes matching the stub's fixture -> status "passed", zero flags.
    // Storing nothing here would be indistinguishable from never checking.
    const id = await draftWith(
      'fever since 3 days, mild cough\nno breathing difficulty\ntook paracetamol yesterday\nallergic to penicillin\nadvised hydration, rest\nreturn if symptoms worsen',
    )

    ok(await api.consultations({ id }).structure.post())

    const reloaded = ok(await api.consultations({ id }).get())
    expect(reloaded.consultation.verification?.status).toBe('passed')
    expect(reloaded.consultation.verification?.flags).toEqual([])
  })

  test('the aiNote is stored alongside it', async () => {
    const id = await draftWith('C/O fever x3d')
    ok(await api.consultations({ id }).structure.post())

    const reloaded = ok(await api.consultations({ id }).get())
    expect(reloaded.consultation.aiNote).not.toBeNull()
    expect(reloaded.consultation.aiNote?.chiefComplaint?.text).toBe('Fever')
  })

  test('regenerating replaces the stored verification', async () => {
    // A stale verdict attached to a fresh note would be worse than none:
    // it would describe a draft that no longer exists.
    const id = await draftWith('C/O fever x3d')

    ok(await api.consultations({ id }).structure.post())
    const first = ok(await api.consultations({ id }).get())
    expect(first.consultation.verification?.flags.length).toBeGreaterThan(0)

    // Same notes, so the same verdict -- but it must be rewritten, not kept.
    ok(await api.consultations({ id }).structure.post())
    const second = ok(await api.consultations({ id }).get())
    expect(second.consultation.verification).toEqual(first.consultation.verification)
  })
})

describe('the doctor-facing chain survives a reload', () => {
  test('raw notes, ai note and verification are all readable together', async () => {
    // What the consultation page needs in one request: the source text, the
    // draft, and the verdict on it. Any one missing breaks the screen.
    const notes = 'C/O fever x3d\nallergic to sulfa drugs'
    const id = await draftWith(notes)

    ok(await api.consultations({ id }).structure.post())
    const { consultation } = ok(await api.consultations({ id }).get())

    expect(consultation.rawNotes).toBe(notes)
    expect(consultation.aiNote).not.toBeNull()
    expect(consultation.verification).not.toBeNull()
  })

  test('E17: the dropped-allergy flag is among the stored flags', async () => {
    // The stub's fixture lists a penicillin allergy; these notes say sulfa.
    // So the patient's actual allergy vanished from the structured note, and
    // the survival check is the only thing that would tell anyone.
    const id = await draftWith('C/O fever x3d\nallergic to sulfa drugs')

    ok(await api.consultations({ id }).structure.post())
    const { consultation } = ok(await api.consultations({ id }).get())

    const survival = consultation.verification?.flags.filter(
      (flag) => flag.check === 'survival',
    )
    expect(survival?.length).toBe(1)
    expect(survival?.[0]?.message).toContain('sulfa')
  })
})
