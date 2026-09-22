/**
 * The four write routes (A7): F4, F6, F7 and F15.
 *
 * As with the read routes, these validate, call a service and return. The two
 * behaviours that matter -- idempotent confirm (E25) and guarded status
 * transitions (E31) -- live in the services, because the A9 tests call the
 * endpoints directly and a UI-level guard would not be exercised.
 */
import { Elysia } from 'elysia'
import { updateAppointmentStatus } from '../services/appointments.ts'
import {
  confirmConsultation,
  createConsultation,
  updateConsultation,
} from '../services/consultations.ts'
import {
  AppointmentResponse,
  AppointmentStatusBody,
  ConfirmConsultationBody,
  ConsultationResponse,
  CreateConsultationBody,
  IdParam,
  UpdateConsultationBody,
} from './schemas.ts'

export const writeRoutes = new Elysia()
  /** F4 -- start a consultation against an appointment. */
  .post(
    '/consultations',
    async ({ body, set }) => {
      const consultation = await createConsultation(body)
      set.status = 201
      return { consultation }
    },
    {
      body: CreateConsultationBody,
      response: { 201: ConsultationResponse },
      detail: { summary: 'Create a draft consultation', tags: ['consultations'] },
    },
  )

  /** F6 -- save edits to a draft. Confirmed consultations are immutable. */
  .patch(
    '/consultations/:id',
    async ({ params, body }) => ({
      consultation: await updateConsultation(params.id, body),
    }),
    {
      params: IdParam,
      body: UpdateConsultationBody,
      response: ConsultationResponse,
      detail: { summary: 'Update a draft consultation', tags: ['consultations'] },
    },
  )

  /** F7 -- confirm. Idempotent: a second call succeeds and changes nothing. */
  .post(
    '/consultations/:id/confirm',
    async ({ params, body }) => ({
      consultation: await confirmConsultation(params.id, body.confirmedNote),
    }),
    {
      params: IdParam,
      body: ConfirmConsultationBody,
      response: ConsultationResponse,
      detail: { summary: 'Confirm a consultation', tags: ['consultations'] },
    },
  )

  /** F15 -- move an appointment through its lifecycle, guarded. */
  .patch(
    '/appointments/:id/status',
    async ({ params, body }) => ({
      appointment: await updateAppointmentStatus(params.id, body.status),
    }),
    {
      params: IdParam,
      body: AppointmentStatusBody,
      response: AppointmentResponse,
      detail: { summary: 'Change appointment status', tags: ['appointments'] },
    },
  )
