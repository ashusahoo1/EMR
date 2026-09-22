/**
 * The stage 4 verification contract (BUILD_ROADMAP Appendix 1, EMR_PLAN §4.6).
 *
 * Lives in shared because three places need the same shape: B4 produces it,
 * the API serves it, and C6 renders the flags to the doctor. Defining it
 * three times is how the "unverified" badge ends up meaning three things.
 *
 * Stage 4 uses NO MODEL. Checking AI output with more AI is non-deterministic,
 * costs a call, can hallucinate its own approval, and raises the question of
 * who checks the checker. String operations are deterministic, free, instant,
 * and explainable to a doctor: "this line does not appear in your notes."
 */
import { type Static, Type as t } from '@sinclair/typebox'
import { StructuredNote } from './schema.ts'

/** Which check raised a flag. */
export const VerificationCheck = {
  /** Parse + schema validation. Failures here are hard failures. */
  Schema: 'schema',
  /** Does each sourceSpan actually occur in the source text? (E14, E15) */
  Grounding: 'grounding',
  /** Every number in the output must appear in the input. (E13) */
  Numeric: 'numeric',
  /** A negated span must survive as a negative. (E16) */
  Negation: 'negation',
  /** An allergy in the notes must reach relevantHistory. (E17) */
  Survival: 'survival',
} as const
export type VerificationCheck = (typeof VerificationCheck)[keyof typeof VerificationCheck]

/**
 * Severity tiers (§4.6).
 *
 * hard       -- unparseable or schema-invalid; retry once, then error state
 * repairable -- ungrounded item or numeric violation; retry once with the
 *               errors fed back
 * soft       -- negation suspicion or borderline numeric; show to the doctor
 *               marked "unverified"
 *
 * Flag, never silently drop. Deleting data behind a doctor's back is worse
 * than showing them something suspect.
 */
export const FlagSeverity = {
  Hard: 'hard',
  Repairable: 'repairable',
  Soft: 'soft',
} as const
export type FlagSeverity = (typeof FlagSeverity)[keyof typeof FlagSeverity]

export const VerificationFlag = t.Object(
  {
    /**
     * Which field the flag attaches to; null for whole-note flags.
     *
     * Written as explicit literals rather than `GROUNDED_FIELDS.map(...)`.
     * A union built from a mapped array is a `TUnion<TLiteral<string>[]>`,
     * whose members TypeScript cannot enumerate statically -- and nesting
     * that inside another union (here, `VerificationResult | null` in a
     * route response) exceeds Elysia's handler inference and produces an
     * unreadable "not assignable to Response" error. The literals below are
     * kept in step with GROUNDED_FIELDS by a test in schema.test.ts.
     */
    field: t.Union([
      t.Literal('chiefComplaint'),
      t.Literal('symptoms'),
      t.Literal('relevantHistory'),
      t.Literal('medicationsMentioned'),
      t.Literal('doctorPlan'),
      t.Literal('missingInformation'),
      t.Null(),
    ]),
    /** Index within an array field; null for chiefComplaint or whole-note. */
    index: t.Union([t.Integer({ minimum: 0 }), t.Null()]),
    check: t.Union([
      t.Literal('schema'),
      t.Literal('grounding'),
      t.Literal('numeric'),
      t.Literal('negation'),
      t.Literal('survival'),
    ]),
    severity: t.Union([t.Literal('hard'), t.Literal('repairable'), t.Literal('soft')]),
    /**
     * Doctor-readable, and shown verbatim in the UI. Write these as a
     * sentence a clinician would understand -- "'BP 130/80' does not appear
     * in your notes" -- not as an internal error string.
     */
    message: t.String({ minLength: 1, maxLength: 300 }),
  },
  { additionalProperties: false },
)
export type VerificationFlag = Static<typeof VerificationFlag>

export const VerificationResult = t.Object(
  {
    status: t.Union([
      t.Literal('passed'),
      t.Literal('repaired'),
      t.Literal('flagged'),
      t.Literal('failed'),
    ]),
    flags: t.Array(VerificationFlag, { maxItems: 100 }),
    /** True when the one permitted retry ran and produced this result. */
    repaired: t.Boolean(),
  },
  { additionalProperties: false },
)
export type VerificationResult = Static<typeof VerificationResult>

/** The payload returned by POST /consultations/:id/structure. */
export const StructureResponse = t.Object(
  {
    note: StructuredNote,
    verification: VerificationResult,
  },
  { additionalProperties: false },
)
export type StructureResponse = Static<typeof StructureResponse>
