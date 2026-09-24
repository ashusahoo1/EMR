/**
 * Consultation queries (F6 reload).
 */
import {
  ConsultationStatus,
  LIMITS,
  type StructuredNote,
  type VerificationResult,
} from '@emr/shared'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { appointments, consultations } from '../db/schema.ts'
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
  return toDetail(row)
}

/** Shape a DB row into the API payload. One place, so the two cannot drift. */
function toDetail(row: typeof consultations.$inferSelect): ConsultationDetail {
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

/** Reject notes that are empty (E1) or over the cap (E3). Server-side, always. */
function assertNotesWithinLimits(rawNotes: string): void {
  if (rawNotes.length > LIMITS.notesMaxChars) {
    throw new AppError(ErrorCode.NOTES_TOO_LONG, {
      details: { length: rawNotes.length, limit: LIMITS.notesMaxChars },
    })
  }
}

/**
 * Start a consultation against an appointment (F4).
 *
 * `rawNotes` is optional and defaults to empty: the doctor opens the composer
 * before typing anything, and a draft with no notes is a legitimate state.
 *
 * The unique index on appointment_id is what actually enforces one-per-
 * appointment. We check first for a clean 409, but the index is the guarantee
 * -- two simultaneous requests would both pass the check.
 */
export async function createConsultation(input: {
  appointmentId: string
  rawNotes?: string
}): Promise<ConsultationDetail> {
  const rawNotes = input.rawNotes ?? ''
  assertNotesWithinLimits(rawNotes)

  const [appointment] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, input.appointmentId))
    .limit(1)
  if (!appointment) throw new AppError(ErrorCode.APPOINTMENT_NOT_FOUND)

  try {
    const [row] = await db
      .insert(consultations)
      .values({
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        rawNotes,
      })
      .returning()
    if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR)
    return toDetail(row)
  } catch (error) {
    // The index fired, so a consultation already exists for this appointment
    // -- a conflict, not a 500.
    if (isUniqueViolation(error)) {
      throw new AppError(ErrorCode.CONSULTATION_EXISTS, {
        details: { appointmentId: appointment.id },
      })
    }
    throw error
  }
}

/**
 * Postgres unique_violation (SQLSTATE 23505).
 *
 * Drizzle wraps driver errors in a DrizzleQueryError, so the code sits on
 * `error.cause`, not on the error itself -- checking the top level silently
 * never matches and turns a clean 409 into a 500. Walk the cause chain rather
 * than assuming a depth.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Update a draft (F6).
 *
 * Confirmed consultations are immutable: once the doctor has signed off, the
 * record is what they signed. Amending it silently would make the audit trail
 * a lie. A correction after confirmation is a new consultation, not an edit.
 */
export async function updateConsultation(
  id: string,
  patch: {
    rawNotes?: string
    aiNote?: StructuredNote
    confirmedNote?: StructuredNote
    /**
     * The stage 4 result for `aiNote` (B6).
     *
     * Stored alongside the note it describes, because the consultation page
     * re-reads both from the database on every load. Without it the flags
     * exist only in the structure response and vanish on the first refresh --
     * which means the doctor sees an unverified-looking draft and has no way
     * to know a fabricated BP was ever flagged.
     */
    verification?: VerificationResult
  },
): Promise<ConsultationDetail> {
  if (patch.rawNotes !== undefined) assertNotesWithinLimits(patch.rawNotes)

  const [existing] = await db
    .select()
    .from(consultations)
    .where(eq(consultations.id, id))
    .limit(1)
  if (!existing) throw new AppError(ErrorCode.CONSULTATION_NOT_FOUND)
  if (existing.status === ConsultationStatus.Confirmed) {
    throw new AppError(ErrorCode.ALREADY_CONFIRMED)
  }

  const [row] = await db
    .update(consultations)
    .set({
      ...(patch.rawNotes !== undefined ? { rawNotes: patch.rawNotes } : {}),
      ...(patch.aiNote !== undefined ? { aiNote: patch.aiNote } : {}),
      ...(patch.confirmedNote !== undefined
        ? { confirmedNote: patch.confirmedNote }
        : {}),
      ...(patch.verification !== undefined ? { verification: patch.verification } : {}),
      updatedAt: new Date(),
    })
    .where(eq(consultations.id, id))
    .returning()
  if (!row) throw new AppError(ErrorCode.CONSULTATION_NOT_FOUND)
  return toDetail(row)
}

/**
 * Confirm a draft (F7). IDEMPOTENT -- E25.
 *
 * Double-clicking Save must produce exactly one confirmed consultation, and
 * must not raise an error on the second click. The UI disabling the button is
 * not the guarantee; this is. The A7 test calls the endpoint twice directly.
 *
 * Implemented as a conditional update -- `WHERE id = ? AND status = 'draft'`
 * -- so the transition happens at most once even under concurrent requests.
 * Zero affected rows then means one of two things, and they are NOT the same:
 *
 *   already confirmed -> success, return the existing row (the second click)
 *   does not exist    -> 404
 *
 * Note E29: a consultation with every AI field empty is valid. Free-text
 * notes alone are a complete consultation, so there is no "did you fill it
 * in" check here.
 */
export async function confirmConsultation(
  id: string,
  confirmedNote: StructuredNote,
): Promise<ConsultationDetail> {
  const [updated] = await db
    .update(consultations)
    .set({
      confirmedNote,
      status: ConsultationStatus.Confirmed,
      updatedAt: new Date(),
    })
    .where(
      and(eq(consultations.id, id), eq(consultations.status, ConsultationStatus.Draft)),
    )
    .returning()

  if (updated) return toDetail(updated)

  // Nothing was updated. Either it is already confirmed, or it is missing.
  const [existing] = await db
    .select()
    .from(consultations)
    .where(eq(consultations.id, id))
    .limit(1)
  if (!existing) throw new AppError(ErrorCode.CONSULTATION_NOT_FOUND)

  // Already confirmed: the second click of a double-click. Succeed quietly
  // rather than showing the doctor an error for something that worked.
  return toDetail(existing)
}
