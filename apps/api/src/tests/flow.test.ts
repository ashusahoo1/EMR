/**
 * THE END-TO-END FLOW (BUILD_ROADMAP A9).
 *
 * With E2E and component tests deliberately dropped (§2.4), EMR_PLAN §5.2 is
 * explicit that THIS is what proves the brief's 25% end-to-end criterion. It
 * must walk the whole path in one test -- appointment -> patient ->
 * consultation -> structure -> edit -> save -> appears in history -- rather
 * than hitting endpoints individually.
 *
 * Every step is a real HTTP request through the real router and the real
 * database. Only the LLM is stubbed, at the service seam.
 *
 * If any single link breaks, this test fails loudly and names the step.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import type { StructuredNote } from '@emr/shared'
import { api, doctorNote, freshAppointment, ok, resetDb } from './helpers.ts'

beforeEach(async () => {
  await resetDb()
  process.env.LLM_ENABLED = 'true'
})

describe('the complete consultation flow', () => {
  test("a doctor works a patient from today's list through to saved history", async () => {
    // --- 1. The doctor opens today's list (F1) -----------------------------
    const today = ok(await api.appointments.get({ query: {} }))
    expect(today.appointments.length).toBeGreaterThan(0)

    // Use a purpose-made appointment so the test does not depend on which
    // seeded row happens to be free.
    const appointment = await freshAppointment('Fever and cough')
    const refreshed = ok(await api.appointments.get({ query: {} }))
    const target = refreshed.appointments.find((a) => a.id === appointment.id)
    expect(target).toBeDefined()
    expect(target?.status).toBe('waiting')
    expect(target?.consultationId).toBeNull()

    // --- 2. They open the patient (F2) -------------------------------------
    const patientId = appointment.patientId
    const profile = ok(await api.patients({ id: patientId }).get())
    expect(profile.patient.id).toBe(patientId)
    expect(profile.patient.name).toBeTruthy()

    // --- 3. And check the history so far (F3) ------------------------------
    const historyBefore = ok(await api.patients({ id: patientId }).consultations.get())
    const countBefore = historyBefore.consultations.length

    // --- 4. Start the consultation (F15: waiting -> in_consultation) -------
    const started = ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'in_consultation',
      }),
    )
    expect(started.appointment.status).toBe('in_consultation')

    // --- 5. Type the rough notes (F4) --------------------------------------
    const rawNotes = 'fever since 3 days, mild cough\nno breathing difficulty'
    const created = ok(
      await api.consultations.post({ appointmentId: appointment.id, rawNotes }),
    )
    const consultationId = created.consultation.id
    expect(created.consultation.status).toBe('draft')
    expect(created.consultation.rawNotes).toBe(rawNotes)

    // --- 6. Press Generate (F5, LLM stubbed at the service seam) -----------
    const structured = ok(
      await api.consultations({ id: consultationId }).structure.post(),
    )
    expect(structured.note.chiefComplaint?.text).toBeTruthy()
    expect(structured.verification.status).toBe('passed')

    // The AI's output is a DRAFT. Nothing is clinical yet (§4.7).
    const afterStructure = ok(await api.consultations({ id: consultationId }).get())
    expect(afterStructure.consultation.aiNote).not.toBeNull()
    expect(afterStructure.consultation.confirmedNote).toBeNull()
    expect(afterStructure.consultation.status).toBe('draft')

    // --- 7. The doctor corrects a field (F6) -------------------------------
    // This edit is the whole point of the human checkpoint: the AI said
    // "Fever", the doctor knows it is "High fever".
    const edited: StructuredNote = {
      ...structured.note,
      chiefComplaint: {
        text: 'High fever',
        sourceSpan: structured.note.chiefComplaint?.sourceSpan ?? rawNotes,
      },
    }
    const patched = ok(
      await api.consultations({ id: consultationId }).patch({ confirmedNote: edited }),
    )
    expect(patched.consultation.confirmedNote?.chiefComplaint?.text).toBe('High fever')

    // --- 8. Save (F7) ------------------------------------------------------
    const confirmed = ok(
      await api.consultations({ id: consultationId }).confirm.post({
        confirmedNote: edited,
      }),
    )
    expect(confirmed.consultation.status).toBe('confirmed')

    // --- 9. IT MUST APPEAR IN HISTORY (F3) ---------------------------------
    // The link the brief actually cares about: work done in the composer
    // shows up in the patient's record.
    const historyAfter = ok(await api.patients({ id: patientId }).consultations.get())
    expect(historyAfter.consultations.length).toBe(countBefore + 1)

    const saved = historyAfter.consultations.find((c) => c.id === consultationId)
    expect(saved).toBeDefined()
    expect(saved?.status).toBe('confirmed')
    expect(saved?.rawNotes).toBe(rawNotes)
    // The DOCTOR's version is what became record, not the AI's.
    expect(saved?.confirmedNote?.chiefComplaint?.text).toBe('High fever')

    // --- 10. Close the appointment (F15) -----------------------------------
    const completed = ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'completed',
      }),
    )
    expect(completed.appointment.status).toBe('completed')

    // --- 11. The dashboard reflects all of it ------------------------------
    const finalList = ok(await api.appointments.get({ query: {} }))
    const finalRow = finalList.appointments.find((a) => a.id === appointment.id)
    expect(finalRow?.status).toBe('completed')
    // The row now links to the consultation that was created from it.
    expect(finalRow?.consultationId).toBe(consultationId)
  })

  test('the audit trail survives the whole flow (F13)', async () => {
    // What the AI said and what the doctor accepted must both be recoverable
    // afterwards. That difference is the entire point of the separate
    // columns (§4.8), and it is only observable end to end.
    const appointment = await freshAppointment()
    const created = ok(
      await api.consultations.post({
        appointmentId: appointment.id,
        rawNotes: 'fever since 3 days',
      }),
    )
    const id = created.consultation.id

    const structured = ok(await api.consultations({ id }).structure.post())
    const aiSaid = structured.note.chiefComplaint?.text

    const doctorAccepted = doctorNote({
      chiefComplaint: {
        text: 'Pyrexia of unknown origin',
        sourceSpan: 'fever since 3 days',
      },
    })
    await api.consultations({ id }).confirm.post({ confirmedNote: doctorAccepted })

    const final = ok(await api.consultations({ id }).get())
    expect(final.consultation.aiNote?.chiefComplaint?.text).toBe(aiSaid ?? '')
    expect(final.consultation.confirmedNote?.chiefComplaint?.text).toBe(
      'Pyrexia of unknown origin',
    )
    // They differ. That is the audit trail doing its job.
    expect(final.consultation.aiNote?.chiefComplaint?.text).not.toBe(
      final.consultation.confirmedNote?.chiefComplaint?.text,
    )
  })

  test('E23: the same flow completes with the AI switched off', async () => {
    // The degradation guarantee, walked end to end rather than asserted on a
    // single endpoint. If this ever fails, the AI has become a dependency.
    process.env.LLM_ENABLED = 'false'

    const appointment = await freshAppointment()

    await api.appointments({ id: appointment.id }).status.patch({
      status: 'in_consultation',
    })

    const created = ok(
      await api.consultations.post({
        appointmentId: appointment.id,
        rawNotes: 'fever 3 days, advised rest and fluids, review if worse',
      }),
    )
    const id = created.consultation.id

    // Generate is unavailable...
    const structure = await api.consultations({ id }).structure.post()
    expect(structure.status).toBe(503)

    // ...but the doctor writes the note by hand and saves it anyway (E29).
    const confirmed = ok(
      await api.consultations({ id }).confirm.post({
        confirmedNote: doctorNote({ chiefComplaint: null, symptoms: [] }),
      }),
    )
    expect(confirmed.consultation.status).toBe('confirmed')

    const history = ok(
      await api.patients({ id: appointment.patientId }).consultations.get(),
    )
    expect(history.consultations.map((c) => c.id)).toContain(id)

    await api.appointments({ id: appointment.id }).status.patch({ status: 'completed' })
  })

  test('search finds the consultation once it is saved (F17)', async () => {
    const appointment = await freshAppointment()
    const marker = 'xylophone'
    const created = ok(
      await api.consultations.post({
        appointmentId: appointment.id,
        rawNotes: `patient reports ${marker} sensitivity`,
      }),
    )
    const id = created.consultation.id

    // A draft must NOT be searchable -- it is not record yet.
    const beforeConfirm = ok(await api.search.get({ query: { q: marker } }))
    expect(beforeConfirm.consultations.map((c) => c.id)).not.toContain(id)

    await api.consultations({ id }).confirm.post({ confirmedNote: doctorNote() })

    const afterConfirm = ok(await api.search.get({ query: { q: marker } }))
    expect(afterConfirm.consultations.map((c) => c.id)).toContain(id)
  })
})
