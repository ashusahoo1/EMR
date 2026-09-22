/**
 * The five read routes (A6): F1, F2, F3, F6-reload and F17.
 *
 * Routes validate, call a service, and return. No business logic here --
 * services are what the A9 tests exercise, and keeping them free of HTTP
 * concerns is what makes that possible.
 */
import { Elysia, t } from 'elysia'
import { listAppointments } from '../services/appointments.ts'
import { getConsultation } from '../services/consultations.ts'
import { getPatient, listConsultations } from '../services/patients.ts'
import { search } from '../services/search.ts'
import {
  AppointmentListResponse,
  ConsultationHistoryResponse,
  ConsultationResponse,
  IdParam,
  PatientResponse,
  SearchResponse,
} from './schemas.ts'

export const readRoutes = new Elysia()
  /** F1 -- today's list, or a given date. Defaults to today, server-side. */
  .get(
    '/appointments',
    async ({ query }) => ({ appointments: await listAppointments(query.date) }),
    {
      query: t.Object({
        date: t.Optional(
          t.String({
            // Rejects "2026-13-45" shapes before they reach SQL.
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            description:
              'ISO date (YYYY-MM-DD) in the clinic timezone. Defaults to today.',
          }),
        ),
      }),
      response: AppointmentListResponse,
      detail: { summary: 'Appointments for a day', tags: ['appointments'] },
    },
  )

  /** F2 -- demographics, allergies, conditions. */
  .get(
    '/patients/:id',
    async ({ params }) => ({ patient: await getPatient(params.id) }),
    {
      params: IdParam,
      response: PatientResponse,
      detail: { summary: 'Patient profile', tags: ['patients'] },
    },
  )

  /** F3 -- confirmed consultations, most recent first. */
  .get(
    '/patients/:id/consultations',
    async ({ params }) => ({ consultations: await listConsultations(params.id) }),
    {
      params: IdParam,
      response: ConsultationHistoryResponse,
      detail: { summary: 'Consultation history', tags: ['patients'] },
    },
  )

  /** F6 -- reload a draft, with both the AI output and the confirmed version. */
  .get(
    '/consultations/:id',
    async ({ params }) => ({ consultation: await getConsultation(params.id) }),
    {
      params: IdParam,
      response: ConsultationResponse,
      detail: { summary: 'One consultation', tags: ['consultations'] },
    },
  )

  /** F17 -- patients and consultations. */
  .get('/search', async ({ query }) => await search(query.q), {
    query: t.Object({
      q: t.String({ description: 'Search term, minimum 2 characters.' }),
    }),
    response: SearchResponse,
    detail: { summary: 'Search patients and consultations', tags: ['search'] },
  })
