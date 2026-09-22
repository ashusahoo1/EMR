/**
 * Search across patients and consultations (F17).
 */
import { ConsultationStatus, LIMITS } from '@emr/shared'
import { and, desc, eq, ilike, or } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { consultations, patients } from '../db/schema.ts'
import { AppError, ErrorCode } from '../errors.ts'

export interface SearchResults {
  patients: Array<{ id: string; name: string; age: number; sex: string }>
  consultations: Array<{
    id: string
    patientId: string
    patientName: string
    createdAt: string
    excerpt: string
  }>
}

const MAX_RESULTS = 20
const EXCERPT_CHARS = 140

/**
 * Case-insensitive substring search over patient names and consultation notes.
 *
 * `ilike` with a leading wildcard cannot use the patients_name_idx btree, which
 * is fine at this scale and honest about it. A real deployment would want a
 * trigram index or tsvector; noted rather than built, since F17 is a P1 bonus
 * and the seeded dataset is twelve patients.
 */
export async function search(query: string): Promise<SearchResults> {
  const trimmed = query.trim()
  if (trimmed.length < LIMITS.searchMinChars) {
    throw new AppError(ErrorCode.QUERY_TOO_SHORT, {
      details: { minimum: LIMITS.searchMinChars, received: trimmed.length },
    })
  }

  // Escape LIKE metacharacters so a search for "100%" is a literal search.
  const pattern = `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

  const patientRows = await db
    .select({
      id: patients.id,
      name: patients.name,
      age: patients.age,
      sex: patients.sex,
    })
    .from(patients)
    .where(ilike(patients.name, pattern))
    .orderBy(patients.name)
    .limit(MAX_RESULTS)

  const consultationRows = await db
    .select({
      id: consultations.id,
      patientId: consultations.patientId,
      patientName: patients.name,
      createdAt: consultations.createdAt,
      rawNotes: consultations.rawNotes,
    })
    .from(consultations)
    .innerJoin(patients, eq(patients.id, consultations.patientId))
    .where(
      and(
        // Confirmed only: a draft is not yet record, and surfacing one in
        // search would expose work the doctor has not signed off.
        eq(consultations.status, ConsultationStatus.Confirmed),
        or(ilike(consultations.rawNotes, pattern), ilike(patients.name, pattern)),
      ),
    )
    .orderBy(desc(consultations.createdAt))
    .limit(MAX_RESULTS)

  return {
    patients: patientRows,
    consultations: consultationRows.map((row) => ({
      id: row.id,
      patientId: row.patientId,
      patientName: row.patientName,
      createdAt: row.createdAt.toISOString(),
      excerpt: excerpt(row.rawNotes, trimmed),
    })),
  }
}

/** A window of the notes around the match, so results are scannable. */
function excerpt(notes: string, term: string): string {
  const flat = notes.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(term.toLowerCase())
  if (at === -1) return flat.slice(0, EXCERPT_CHARS)

  const start = Math.max(0, at - 40)
  const slice = flat.slice(start, start + EXCERPT_CHARS)
  return (start > 0 ? '…' : '') + slice + (start + EXCERPT_CHARS < flat.length ? '…' : '')
}
