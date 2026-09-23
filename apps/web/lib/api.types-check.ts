/**
 * C0's done-when, enforced by the compiler (BUILD_ROADMAP C0, §2.2).
 *
 * "A component calls api.appointments.get() and AUTOCOMPLETE SHOWS THE REAL
 * RESPONSE FIELDS. If it shows `any`, stop and fix the type import."
 *
 * Autocomplete cannot be asserted in a test runner, but the thing underneath
 * it can: if Eden's inference is working, wrong field names and wrong types
 * are compile errors. So this file is a set of deliberate mistakes, each
 * marked `@ts-expect-error`. It is checked by `bun run typecheck`, and it
 * fails in BOTH directions:
 *
 *   - inference breaks  -> the positive assertions stop compiling
 *   - inference becomes `any` -> the @ts-expect-error lines report
 *     "unused '@ts-expect-error' directive", because nothing errored
 *
 * That second case is the one that matters. A silently-degraded Eden client
 * still works at runtime, so nothing else in the project would notice.
 *
 * NOT a runtime test, and deliberately NOT named `.test.ts`: the bindings
 * below are `declare const`, which has no runtime value at all, so `bun test`
 * would pick the file up and fail with "appointments is not defined". The
 * type checker is the assertion here; `bun run typecheck` is what runs it.
 */
import type { StructuredNote, VerificationResult } from '@emr/shared'
import { api } from './api.ts'

/** Awaited response data for a given Eden call. */
type DataOf<T> = Awaited<T> extends { data: infer D } ? NonNullable<D> : never

// --- The appointments list (F1) --------------------------------------------

type AppointmentsResponse = DataOf<ReturnType<typeof api.appointments.get>>

declare const appointments: AppointmentsResponse

// The real field exists and is an array.
const _list: unknown[] = appointments.appointments

// @ts-expect-error -- `appointment` is not a field on the response; the
// wrapper key is `appointments`. If Eden were `any`, this would compile.
const _wrongKey = appointments.appointment

// @ts-expect-error -- a typo in a real field name must not compile.
const _typo = appointments.appointmnets

// --- A single consultation (F4) --------------------------------------------

type ConsultationResponse = DataOf<
  ReturnType<ReturnType<typeof api.consultations>['get']>
>

declare const consultationResponse: ConsultationResponse

/**
 * The structured note types flow through unchanged.
 *
 * This is the assignment that proves the whole chain: the API's TypeBox
 * schema (A2) -> Elysia's response type -> Eden's inference -> the shared
 * `StructuredNote` type the UI renders. If any link were `any`, this would
 * still compile, which is why the negative cases above exist alongside it.
 */
const _aiNote: StructuredNote | null = consultationResponse.consultation.aiNote
const _rawNotes: string = consultationResponse.consultation.rawNotes

// @ts-expect-error -- rawNotes is a string, not a number.
const _wrongType: number = consultationResponse.consultation.rawNotes

// --- Structuring, including the verification result (F5, B6) ---------------

type StructureResponse = DataOf<
  ReturnType<ReturnType<typeof api.consultations>['structure']['post']>
>

declare const structured: StructureResponse

const _note: StructuredNote = structured.note
const _verification: VerificationResult = structured.verification
/** The flags C6 renders to the doctor, typed end to end. */
const _flags: VerificationResult['flags'] = structured.verification.flags

// @ts-expect-error -- `status` is a closed union; 'definitely-fine' is not a
// member. This is what stops the UI switching on a status that cannot occur.
const _badStatus: 'definitely-fine' = structured.verification.status

// --- Request bodies are typed too ------------------------------------------

// @ts-expect-error -- creating a consultation requires appointmentId and
// rawNotes; an empty body must not compile.
const _emptyBody = api.consultations.post({})

// @ts-expect-error -- appointmentId is a string, not a number.
const _wrongBodyType = api.consultations.post({ appointmentId: 1, rawNotes: 'x' })

/**
 * Suppress unused-variable noise.
 *
 * Every binding above exists for its type, not its value. Referencing them
 * once keeps the file honest without weakening the checks.
 */
export const __typeProbe = [
  _list,
  _wrongKey,
  _typo,
  _aiNote,
  _rawNotes,
  _wrongType,
  _note,
  _verification,
  _flags,
  _badStatus,
  _emptyBody,
  _wrongBodyType,
] as const
