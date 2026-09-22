/**
 * Appointment queries (F1).
 *
 * Business logic lives here; routes only validate, call and return. That
 * split is what lets A9's tests exercise behaviour without going through
 * HTTP for every assertion.
 */
import { CLINIC_TIMEZONE } from '@emr/shared'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { appointments, consultations, patients } from '../db/schema.ts'

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
