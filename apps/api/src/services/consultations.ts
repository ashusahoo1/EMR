/**
 * Consultation queries (F6 reload).
 */
import type { ConsultationStatus, StructuredNote, VerificationResult } from '@emr/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { consultations } from '../db/schema.ts'
import { AppError, ErrorCode } from '../errors.ts'

export interface ConsultationDetail {
  id: string
  appointmentId: string
  patientId: string
  rawNotes: string
  aiNote: StructuredNote | null
  confirmedNote: StructuredNote | null
  status: ConsultationStatus
  verification: VerificationResult | null
  createdAt: string
  updatedAt: string
}

/**
 * One consultation, with BOTH the raw AI output and the confirmed version.
 *
 * Returning both is the point of the separate columns (§4.8, F13): the
 * frontend needs them side by side to show what the AI said versus what the
 * doctor accepted (F14 provenance).
 */
export async function getConsultation(id: string): Promise<ConsultationDetail> {
  const [row] = await db
    .select()
    .from(consultations)
    .where(eq(consultations.id, id))
    .limit(1)
  if (!row) throw new AppError(ErrorCode.CONSULTATION_NOT_FOUND)

  return {
    id: row.id,
    appointmentId: row.appointmentId,
    patientId: row.patientId,
    rawNotes: row.rawNotes,
    aiNote: row.aiNote,
    confirmedNote: row.confirmedNote,
    status: row.status,
    verification: row.verification,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
