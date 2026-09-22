/**
 * The structured-output contract (EMR_PLAN §4.10).
 *
 * This file is the spine of the project. The same schema:
 *   1. validates the API request/response boundary (Elysia reads TypeBox),
 *   2. becomes the JSON Schema handed to OpenAI strict structured outputs (B3),
 *   3. types the doctor's review form on the frontend (C6).
 *
 * DO NOT ADD FIELDS. The restraint is the point: every field added is a box
 * the model feels obliged to fill. `vitals`, `diagnosis`, `dosage` and
 * `severity` are deliberately absent -- see REJECTED_FIELDS below.
 */
import { type Static, Type as t } from '@sinclair/typebox'

/**
 * One clinical item, grounded in the notes it came from.
 *
 * `sourceSpan` is the verbatim substring of the doctor's notes that this item
 * was derived from. It is machinery for stage 4 verification and provenance
 * highlighting -- not content, and never shown to the doctor as itself (§4.5).
 *
 * We ask the model for the substring, never character offsets: models are
 * unreliable at counting characters, so `{start: 12, end: 28}` rejects valid
 * output over off-by-several errors. Let the model copy text; let indexOf
 * find it.
 */
export const SourcedItem = t.Object(
  {
    text: t.String({
      minLength: 1,
      maxLength: 500,
      description: 'The normalised clinical statement.',
    }),
    sourceSpan: t.String({
      minLength: 1,
      maxLength: 1000,
      description:
        'The exact substring of the source notes this was derived from, copied verbatim.',
    }),
  },
  {
    additionalProperties: false,
    description: 'A clinical item together with the text it came from.',
  },
)
export type SourcedItem = Static<typeof SourcedItem>

/**
 * The fixed schema from the brief.
 *
 * `additionalProperties: false` is a schema-level guardrail and is cheaper
 * than prompting: the model cannot invent a `bloodPressure` key that does not
 * exist in the contract (E12).
 */
export const StructuredNote = t.Object(
  {
    /**
     * Nullable rather than optional, deliberately. A nullable field forces the
     * model to make an explicit choice; an optional field lets it silently
     * omit. Null is an answer, absence is ambiguity. Golden-set note N10
     * (three words of input) is the case that proves this matters.
     */
    chiefComplaint: t.Union([SourcedItem, t.Null()], {
      description: 'The one-line reason for the visit, or null if the notes state none.',
    }),

    /** Including stated negatives -- "no breathing difficulty" must survive. */
    symptoms: t.Array(SourcedItem, { maxItems: 50 }),

    /** Allergies, existing conditions, prior events. */
    relevantHistory: t.Array(SourcedItem, { maxItems: 50 }),

    /**
     * MENTIONED, not prescribed. The weaker verb records what was said rather
     * than issuing anything, and it keeps the model in scribe mode (§4.10).
     */
    medicationsMentioned: t.Array(SourcedItem, { maxItems: 50 }),

    /** Advice, instructions, follow-up conditions. */
    doctorPlan: t.Array(SourcedItem, { maxItems: 50 }),

    /**
     * Absences. Plain strings with no sourceSpan -- by definition these
     * describe what is NOT in the notes, so there is nothing to ground them
     * against. Rendered as a nudge above the save action, never a blocker
     * (§1.3, §4.7).
     */
    missingInformation: t.Array(t.String({ minLength: 1, maxLength: 300 }), {
      maxItems: 20,
    }),
  },
  {
    additionalProperties: false,
    description: 'A consultation record. Not a prescription.',
  },
)
export type StructuredNote = Static<typeof StructuredNote>

/** The array-valued fields, for iteration in verification and UI code. */
export const NOTE_LIST_FIELDS = [
  'symptoms',
  'relevantHistory',
  'medicationsMentioned',
  'doctorPlan',
] as const
export type NoteListField = (typeof NOTE_LIST_FIELDS)[number]

/** Every field carrying a sourceSpan, i.e. everything verification can ground. */
export const GROUNDED_FIELDS = ['chiefComplaint', ...NOTE_LIST_FIELDS] as const
export type GroundedField = (typeof GROUNDED_FIELDS)[number]

/**
 * Fields deliberately NOT in the schema, kept as documentation so the decision
 * survives contact with a future contributor who thinks the note looks thin.
 * The cheapest hallucination guardrail is not giving the model a box to fill.
 */
export const REJECTED_FIELDS = {
  vitals: "The brief's own hallucination example. No slot, no temptation.",
  bloodPressure: 'Same. E13 is the headline case this schema exists to prevent.',
  temperature: 'Same.',
  diagnosis: 'Invites the model to infer a clinical conclusion the doctor never stated.',
  dosage: 'Turns the output into a prescription, which is out of scope.',
  frequency: 'Same.',
  icdCode: 'Requires clinical judgement we are not equipped to make.',
  severity: 'Same.',
} as const

/** An empty note. The correct starting point for a doctor writing manually. */
export function emptyStructuredNote(): StructuredNote {
  return {
    chiefComplaint: null,
    symptoms: [],
    relevantHistory: [],
    medicationsMentioned: [],
    doctorPlan: [],
    missingInformation: [],
  }
}
