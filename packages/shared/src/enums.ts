/**
 * The four enums from EMR_PLAN §7.2.
 *
 * Written as `const` objects rather than TypeScript `enum` so the values
 * survive as plain strings across the API boundary, the database and the
 * frontend without a runtime import of an enum object.
 */

/** M6 — Appointment lifecycle (F15). */
export const AppointmentStatus = {
  Waiting: 'waiting',
  InConsultation: 'in_consultation',
  Completed: 'completed',
} as const
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus]

/**
 * The only legal appointment transitions (E31).
 *
 * `in_consultation -> waiting` exists as an undo for a doctor who opened the
 * wrong row. Everything absent from this map is rejected at the API with
 * INVALID_STATUS_TRANSITION -- EMR_PLAN §5.6 is explicit that hiding an
 * invalid transition in the UI does not count.
 */
export const ALLOWED_APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  [AppointmentStatus.Waiting]: [AppointmentStatus.InConsultation],
  [AppointmentStatus.InConsultation]: [
    AppointmentStatus.Completed,
    AppointmentStatus.Waiting,
  ],
  [AppointmentStatus.Completed]: [],
} as const

/** M7 — Draft vs confirmed. Nothing is clinical until a human says so (§4.7). */
export const ConsultationStatus = {
  Draft: 'draft',
  Confirmed: 'confirmed',
} as const
export type ConsultationStatus =
  (typeof ConsultationStatus)[keyof typeof ConsultationStatus]

/**
 * M8 — Which pipeline stage produced an AiGeneration row.
 * One table for both stages, discriminated by this (§7.3).
 */
export const GenerationType = {
  Transcription: 'transcription',
  Structuring: 'structuring',
} as const
export type GenerationType = (typeof GenerationType)[keyof typeof GenerationType]

/** M9 — Outcome of the stage 4 verification pass (§4.6 severity tiers). */
export const VerificationStatus = {
  Passed: 'passed',
  Repaired: 'repaired',
  Flagged: 'flagged',
  Failed: 'failed',
} as const
export type VerificationStatus =
  (typeof VerificationStatus)[keyof typeof VerificationStatus]

/** Patient sex, as stored. Kept narrow; not a clinical judgement field. */
export const Sex = {
  Male: 'M',
  Female: 'F',
  Other: 'O',
} as const
export type Sex = (typeof Sex)[keyof typeof Sex]
