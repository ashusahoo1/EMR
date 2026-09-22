/**
 * Appointment queries (F1).
 *
 * Business logic lives here; routes only validate, call and return. That
 * split is what lets A9's tests exercise behaviour without going through
 * HTTP for every assertion.
 */
import {
  ALLOWED_APPOINTMENT_TRANSITIONS,
  type AppointmentStatus,
  CLINIC_TIMEZONE,
} from '@emr/shared'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { appointments, consultations, patients } from '../db/schema.ts'
import { AppError, ErrorCode } from '../errors.ts'

export interface AppointmentListItem {
  id: string
  scheduledAt: string
  reason: string | null
  status: string
  patient: { id: string; name: string; age: number; sex: string }
  consultationId: string | null
}

/**
 * Appointments on a given calendar date in the CLINIC's timezone.
 *
 * The comparison converts the stored instant into clinic-local time before
 * taking its date. Doing it the obvious way -- `scheduled_at::date = $1` --
 * uses the session timezone (UTC in our container, whatever the host feels
 * like in production) and quietly drops evening appointments into tomorrow.
 *
 * `date` is an ISO YYYY-MM-DD string; when omitted it means today, computed
 * in the clinic's zone rather than the server's.
 */
export async function listAppointments(date?: string): Promise<AppointmentListItem[]> {
  const targetDate = date
    ? sql`${date}::date`
    : sql`(now() AT TIME ZONE ${CLINIC_TIMEZONE})::date`

  const rows = await db
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduledAt,
      reason: appointments.reason,
      status: appointments.status,
      patientId: patients.id,
      patientName: patients.name,
      patientAge: patients.age,
      patientSex: patients.sex,
      consultationId: consultations.id,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(consultations, eq(consultations.appointmentId, appointments.id))
    .where(
      sql`(${appointments.scheduledAt} AT TIME ZONE ${CLINIC_TIMEZONE})::date = ${targetDate}`,
    )
    .orderBy(asc(appointments.scheduledAt))

  return rows.map((row) => ({
    id: row.id,
    scheduledAt: row.scheduledAt.toISOString(),
    reason: row.reason,
    status: row.status,
    patient: {
      id: row.patientId,
      name: row.patientName,
      age: row.patientAge,
      sex: row.patientSex,
    },
    consultationId: row.consultationId,
  }))
}

/** A single appointment, or undefined. Callers decide whether that is a 404. */
export async function findAppointment(id: string) {
  const [row] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, id))
    .limit(1)
  return row
}

/** Whether an appointment already has a consultation (A7's CONSULTATION_EXISTS). */
export async function findConsultationForAppointment(appointmentId: string) {
  const [row] = await db
    .select()
    .from(consultations)
    .where(and(eq(consultations.appointmentId, appointmentId)))
    .limit(1)
  return row
}

export interface AppointmentDetail {
  id: string
  doctorId: string
  patientId: string
  scheduledAt: string
  reason: string | null
  status: AppointmentStatus
  createdAt: string
}

/**
 * Move an appointment through its lifecycle (F15, E31).
 *
 * Validated against ALLOWED_APPOINTMENT_TRANSITIONS here, at the API, not in
 * the UI. §5.6 is explicit: hiding an invalid transition behind a disabled
 * button does not count, because the endpoint is still reachable.
 *
 * Re-applying the current status is a no-op success rather than a conflict --
 * a double-clicked "Start consultation" should not show the doctor an error
 * for something that already happened (same reasoning as E25).
 */
export async function updateAppointmentStatus(
  id: string,
  next: AppointmentStatus,
): Promise<AppointmentDetail> {
  const [existing] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, id))
    .limit(1)
  if (!existing) throw new AppError(ErrorCode.APPOINTMENT_NOT_FOUND)

  const current = existing.status

  if (current === next) {
    return toAppointmentDetail(existing)
  }

  const allowed = ALLOWED_APPOINTMENT_TRANSITIONS[current] ?? []
  if (!allowed.includes(next)) {
    throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION, {
      message: `Cannot move an appointment from ${current} to ${next}.`,
      details: { from: current, to: next, allowed: [...allowed] },
    })
  }

  const [row] = await db
    .update(appointments)
    .set({ status: next })
    .where(eq(appointments.id, id))
    .returning()
  if (!row) throw new AppError(ErrorCode.APPOINTMENT_NOT_FOUND)
  return toAppointmentDetail(row)
}

function toAppointmentDetail(row: typeof appointments.$inferSelect): AppointmentDetail {
  return {
    id: row.id,
    doctorId: row.doctorId,
    patientId: row.patientId,
    scheduledAt: row.scheduledAt.toISOString(),
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }
}
