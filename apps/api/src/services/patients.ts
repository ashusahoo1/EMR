/**
 * Patient queries (F2, F3).
 */
import { ConsultationStatus, type StructuredNote } from '@emr/shared'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { consultations, patients } from '../db/schema.ts'
import { AppError, ErrorCode } from '../errors.ts'

export interface PatientProfile {
  id: string
  name: string
  age: number
  sex: string
  phone: string | null
  allergies: string[]
  existingConditions: string[]
}

/**
 * A patient, or a 404.
 *
 * Throws rather than returning null: a route that returns `{ patient: null }`
 * with a 200 forces every caller to re-check, and one of them will forget.
 */
export async function getPatient(id: string): Promise<PatientProfile> {
  const [row] = await db.select().from(patients).where(eq(patients.id, id)).limit(1)
  if (!row) throw new AppError(ErrorCode.PATIENT_NOT_FOUND)

  return {
    id: row.id,
    name: row.name,
    age: row.age,
    sex: row.sex,
    phone: row.phone,
    allergies: row.allergies,
    existingConditions: row.existingConditions,
  }
}

export interface ConsultationHistoryItem {
  id: string
  createdAt: string
  rawNotes: string
  confirmedNote: StructuredNote | null
  status: string
}

/**
 * This patient's consultation history, most recent first (F3).
 *
 * Confirmed only. A draft is work in progress, not record -- showing drafts
 * in history would imply the doctor signed off on something they have not
 * (§4.7: nothing is clinical until a human says so).
 *
 * Hits the consultations_patient_created_idx index directly.
 */
export async function listConsultations(
  patientId: string,
): Promise<ConsultationHistoryItem[]> {
  // Surface a missing patient as 404 rather than an empty list, so the
  // frontend can tell "no history" apart from "no such patient" (E28).
  await getPatient(patientId)

  const rows = await db
    .select()
    .from(consultations)
    .where(
      and(
        eq(consultations.patientId, patientId),
        eq(consultations.status, ConsultationStatus.Confirmed),
      ),
    )
    .orderBy(desc(consultations.createdAt))

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    rawNotes: row.rawNotes,
    confirmedNote: row.confirmedNote,
    status: row.status,
  }))
}
