/**
 * Contract tests for the structured-note schema.
 *
 * These guard the schema-level guardrails from EMR_PLAN §4.5 -- the ones that
 * are cheaper than prompting because they hold regardless of what the model
 * does. If one of these ever goes red, a hallucination guardrail has been
 * removed.
 */
import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { ALLOWED_APPOINTMENT_TRANSITIONS, AppointmentStatus } from './enums.ts'
import {
  emptyStructuredNote,
  GROUNDED_FIELDS,
  type StructuredNote as Note,
  StructuredNote,
} from './schema.ts'
import { FlagSeverity, VerificationCheck, VerificationFlag } from './verification.ts'

const n01: Note = {
  chiefComplaint: { text: 'Fever', sourceSpan: 'fever since 3 days' },
  symptoms: [
    { text: 'Fever for 3 days', sourceSpan: 'fever since 3 days' },
    { text: 'No breathing difficulty', sourceSpan: 'no breathing difficulty' },
  ],
  relevantHistory: [{ text: 'Penicillin allergy', sourceSpan: 'allergic to penicillin' }],
  medicationsMentioned: [
    { text: 'Paracetamol', sourceSpan: 'took paracetamol yesterday' },
  ],
  doctorPlan: [{ text: 'Hydration', sourceSpan: 'advised hydration' }],
  missingInformation: ['Temperature was not recorded'],
}

describe('StructuredNote', () => {
  test('accepts the N01 golden-set note', () => {
    expect(Value.Check(StructuredNote, n01)).toBe(true)
  })

  test('accepts an entirely empty note (E29: free-text alone is valid)', () => {
    expect(Value.Check(StructuredNote, emptyStructuredNote())).toBe(true)
  })

  test('accepts empty arrays -- an empty array is a correct answer (E4, E5)', () => {
    const noMeds: Note = { ...n01, medicationsMentioned: [], doctorPlan: [] }
    expect(Value.Check(StructuredNote, noMeds)).toBe(true)
  })

  test('E12: rejects an invented key -- additionalProperties is false', () => {
    const fabricated = { ...n01, bloodPressure: '130/80' }
    expect(Value.Check(StructuredNote, fabricated)).toBe(false)
  })

  test('rejects an omitted chiefComplaint -- nullable, not optional', () => {
    const { chiefComplaint: _dropped, ...omitted } = n01
    expect(Value.Check(StructuredNote, omitted)).toBe(false)
  })

  test('accepts an explicitly null chiefComplaint (N10: three words in)', () => {
    expect(Value.Check(StructuredNote, { ...n01, chiefComplaint: null })).toBe(true)
  })

  test('rejects an item with no sourceSpan -- grounding is not optional', () => {
    const ungroundable = { ...n01, symptoms: [{ text: 'Fever' }] }
    expect(Value.Check(StructuredNote, ungroundable)).toBe(false)
  })

  test('rejects an empty sourceSpan string', () => {
    const blank = { ...n01, symptoms: [{ text: 'Fever', sourceSpan: '' }] }
    expect(Value.Check(StructuredNote, blank)).toBe(false)
  })

  test('missingInformation carries no sourceSpan -- plain strings only', () => {
    const sourced = { ...n01, missingInformation: [{ text: 'x', sourceSpan: 'y' }] }
    expect(Value.Check(StructuredNote, sourced)).toBe(false)
  })
})

describe('VerificationFlag literals stay in step with their sources', () => {
  // The schema spells these out by hand -- a union built from
  // `Object.values(...).map(t.Literal)` breaks Elysia's route inference (see
  // the note in verification.ts). These tests are what stop the two copies
  // drifting apart.
  const literalsOf = (schema: { anyOf?: Array<{ const?: unknown }> }) =>
    (schema.anyOf ?? [])
      .map((member) => member.const)
      .filter((value): value is string => typeof value === 'string')

  test('field covers every grounded field plus missingInformation', () => {
    const declared = literalsOf(
      VerificationFlag.properties.field as { anyOf?: Array<{ const?: unknown }> },
    )
    expect(declared).toEqual([...GROUNDED_FIELDS, 'missingInformation'])
  })

  test('check covers every VerificationCheck', () => {
    const declared = literalsOf(
      VerificationFlag.properties.check as { anyOf?: Array<{ const?: unknown }> },
    )
    expect(declared.sort()).toEqual(Object.values(VerificationCheck).sort())
  })

  test('severity covers every FlagSeverity', () => {
    const declared = literalsOf(
      VerificationFlag.properties.severity as { anyOf?: Array<{ const?: unknown }> },
    )
    expect(declared.sort()).toEqual(Object.values(FlagSeverity).sort())
  })
})

describe('appointment transitions (E31)', () => {
  test('completed is terminal -- no transition out of it', () => {
    expect(ALLOWED_APPOINTMENT_TRANSITIONS[AppointmentStatus.Completed]).toEqual([])
  })

  test('completed -> waiting is not permitted', () => {
    const allowed: readonly string[] =
      ALLOWED_APPOINTMENT_TRANSITIONS[AppointmentStatus.Completed]
    expect(allowed).not.toContain(AppointmentStatus.Waiting)
  })

  test('waiting -> in_consultation is permitted', () => {
    const allowed: readonly string[] =
      ALLOWED_APPOINTMENT_TRANSITIONS[AppointmentStatus.Waiting]
    expect(allowed).toContain(AppointmentStatus.InConsultation)
  })

  test('in_consultation -> waiting is permitted as an undo', () => {
    const allowed: readonly string[] =
      ALLOWED_APPOINTMENT_TRANSITIONS[AppointmentStatus.InConsultation]
    expect(allowed).toContain(AppointmentStatus.Waiting)
  })
})
