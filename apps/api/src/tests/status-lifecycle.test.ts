/**
 * Appointment status transitions (found by manual testing, F15/E31).
 *
 * THE BUG. Saving a consultation patched the appointment straight from
 * `waiting` to `completed`. The allowed transitions are
 * waiting -> in_consultation -> completed, so the API correctly answered 409
 * INVALID_STATUS_TRANSITION -- and because the save deliberately swallows
 * that failure (a scheduling label must never block a clinical save), the
 * note was stored while the row sat on "Waiting" forever.
 *
 * WHY THE SUITE MISSED IT. flow.test.ts walks the same path but patches to
 * `in_consultation` explicitly, as a test author naturally would. The UI
 * never did. So the test asserted a sequence the application did not
 * perform -- which is the failure mode of any test that drives the API
 * directly instead of the sequence the client actually sends.
 *
 * These tests therefore assert the transitions as a LIFECYCLE, including the
 * illegal jump, rather than checking each patch in isolation.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { api, freshAppointment, ok, resetDb } from './helpers.ts'

beforeEach(async () => {
  await resetDb()
})

describe('the transition rules', () => {
  test('waiting -> in_consultation is allowed', async () => {
    const appointment = await freshAppointment()

    const result = ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'in_consultation',
      }),
    )
    expect(result.appointment.status).toBe('in_consultation')
  })

  test('in_consultation -> completed is allowed', async () => {
    const appointment = await freshAppointment()

    ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'in_consultation',
      }),
    )
    const result = ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'completed',
      }),
    )
    expect(result.appointment.status).toBe('completed')
  })

  test('THE BUG: waiting -> completed is REJECTED', async () => {
    // The jump the save was making. A 409 here is correct behaviour; the
    // fault was the client attempting it at all.
    const appointment = await freshAppointment()

    const response = await api.appointments({ id: appointment.id }).status.patch({
      status: 'completed',
    })
    expect(response.status).toBe(409)
  })

  test('completed is terminal', async () => {
    const appointment = await freshAppointment()
    ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'in_consultation',
      }),
    )
    ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'completed',
      }),
    )

    const response = await api.appointments({ id: appointment.id }).status.patch({
      status: 'waiting',
    })
    expect(response.status).toBe(409)
  })

  test('re-applying the current status is a no-op success, not a conflict', async () => {
    // A double-clicked "Start consultation" must not show an error for
    // something that already happened.
    const appointment = await freshAppointment()

    ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'in_consultation',
      }),
    )
    const again = ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'in_consultation',
      }),
    )
    expect(again.appointment.status).toBe('in_consultation')
  })
})

describe('the sequence the UI actually performs', () => {
  test('open consultation then save leaves the appointment completed', async () => {
    // The full client sequence, in order:
    //   1. Start consultation -> patch in_consultation, create the draft
    //   2. Save               -> confirm, then patch completed
    const appointment = await freshAppointment()

    // 1. What StartConsultationButton does.
    ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'in_consultation',
      }),
    )
    const created = ok(
      await api.consultations.post({
        appointmentId: appointment.id,
        rawNotes: 'C/O fever x3d',
      }),
    )

    // 2. What SaveConsultation does.
    ok(
      await api.consultations({ id: created.consultation.id }).confirm.post({
        confirmedNote: {
          chiefComplaint: { text: 'Fever', sourceSpan: 'C/O fever x3d' },
          symptoms: [],
          relevantHistory: [],
          medicationsMentioned: [],
          doctorPlan: [],
          missingInformation: [],
        },
      }),
    )
    ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'completed',
      }),
    )

    // The assertion that was failing in the browser.
    const listed = ok(await api.appointments.get({ query: {} }))
    const row = listed.appointments.find((item) => item.id === appointment.id)
    expect(row?.status).toBe('completed')
  })

  test('the recovery path: a waiting appointment can still be completed', async () => {
    // A consultation reached by a direct URL or bookmark never passed
    // through StartConsultationButton, so the appointment is still
    // `waiting`. The save steps through the intermediate state rather than
    // leaving the row stuck.
    const appointment = await freshAppointment()

    const direct = await api.appointments({ id: appointment.id }).status.patch({
      status: 'completed',
    })
    expect(direct.status).toBe(409)

    // Step through, exactly as the save's catch block does.
    ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'in_consultation',
      }),
    )
    const result = ok(
      await api.appointments({ id: appointment.id }).status.patch({
        status: 'completed',
      }),
    )
    expect(result.appointment.status).toBe('completed')
  })
})
