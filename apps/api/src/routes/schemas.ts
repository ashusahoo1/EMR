/**
 * Shared TypeBox schemas for route validation.
 *
 * Every route declares BOTH its inputs and its response. A route without a
 * response schema still works at runtime but breaks Eden Treaty's inference,
 * which silently degrades the frontend to `any` -- the exact failure the C0
 * done-when check is written to catch.
 */
import { StructuredNote, VerificationResult } from '@emr/shared'
import { t } from 'elysia'

/** Path parameter: a single UUID called `id`. */
export const IdParam = t.Object({ id: t.String({ format: 'uuid' }) })

export const PatientSummary = t.Object({
  id: t.String(),
  name: t.String(),
  age: t.Integer(),
  sex: t.String(),
})

export const AppointmentListResponse = t.Object({
  appointments: t.Array(
    t.Object({
      id: t.String(),
      scheduledAt: t.String(),
      reason: t.Union([t.String(), t.Null()]),
      status: t.String(),
      patient: PatientSummary,
      consultationId: t.Union([t.String(), t.Null()]),
    }),
  ),
})

export const PatientResponse = t.Object({
  patient: t.Object({
    id: t.String(),
    name: t.String(),
    age: t.Integer(),
    sex: t.String(),
    phone: t.Union([t.String(), t.Null()]),
    allergies: t.Array(t.String()),
    existingConditions: t.Array(t.String()),
  }),
})

export const ConsultationHistoryResponse = t.Object({
  consultations: t.Array(
    t.Object({
      id: t.String(),
      createdAt: t.String(),
      rawNotes: t.String(),
      confirmedNote: t.Union([StructuredNote, t.Null()]),
      status: t.String(),
    }),
  ),
})

export const ConsultationResponse = t.Object({
  consultation: t.Object({
    id: t.String(),
    appointmentId: t.String(),
    patientId: t.String(),
    rawNotes: t.String(),
    aiNote: t.Union([StructuredNote, t.Null()]),
    confirmedNote: t.Union([StructuredNote, t.Null()]),
    status: t.String(),
    verification: t.Union([VerificationResult, t.Null()]),
    createdAt: t.String(),
    updatedAt: t.String(),
  }),
})

export const SearchResponse = t.Object({
  patients: t.Array(PatientSummary),
  consultations: t.Array(
    t.Object({
      id: t.String(),
      patientId: t.String(),
      patientName: t.String(),
      createdAt: t.String(),
      excerpt: t.String(),
    }),
  ),
})
