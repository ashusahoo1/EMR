/**
 * The database schema (BUILD_ROADMAP Appendix 2, EMR_PLAN §7).
 *
 * The audit columns land HERE, in the first migration -- ai_generations as a
 * table, and ai_note / confirmed_note as separate columns on consultations.
 * EMR_PLAN §3.5 is explicit: nearly free on day one, expensive to retrofit,
 * and F13 (the AI audit trail) is impossible without them.
 */
import type {
  AppointmentStatus,
  ConsultationStatus,
  GenerationType,
  Sex,
  StructuredNote,
  VerificationResult,
  VerificationStatus,
} from '@emr/shared'
import { relations, sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/** Shared column builders, so every table dates itself the same way. */
const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/** M1 -- the clinician. One seeded record is enough until F21. */
export const doctors = pgTable('doctors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  specialty: text('specialty'),
  createdAt,
})

/** M2 -- demographics, allergies, existing conditions. */
export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    age: integer('age').notNull(),
    /**
     * Stored as text rather than a pg enum: the value set is stable, and a
     * text column keeps migrations cheap if it ever is not. Narrowed to the
     * Sex union at the type level.
     */
    sex: text('sex').$type<Sex>().notNull(),
    phone: text('phone'),
    /**
     * Drives the E17 survival-check story: the doctor's notes mention an
     * allergy, and it must reach relevantHistory in the structured output.
     */
    allergies: text('allergies').array().notNull().default(sql`'{}'::text[]`),
    existingConditions: text('existing_conditions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt,
  },
  (table) => [index('patients_name_idx').on(table.name)],
)

/** M3 -- a scheduled slot linking a doctor and a patient. */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'cascade' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
    /** Transitions are guarded server-side at A7 (E31). */
    status: text('status').$type<AppointmentStatus>().notNull().default('waiting'),
    createdAt,
  },
  (table) => [
    index('appointments_scheduled_at_idx').on(table.scheduledAt),
    index('appointments_status_idx').on(table.status),
  ],
)

/**
 * M4 -- the visit record.
 *
 * ai_note and confirmed_note are SEPARATE COLUMNS on purpose (§4.8, F13).
 * Overwriting one with the other destroys the only evidence of what the
 * doctor actually changed, which is the question the audit trail exists to
 * answer.
 */
export const consultations = pgTable(
  'consultations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** One consultation per appointment -- enforced by the unique index. */
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    /** Denormalised from the appointment so F3's history query is one join. */
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    /**
     * Stage 2 output: what the doctor typed, or the transcription after the
     * doctor corrected it. This is the source text every verification check
     * grounds against.
     */
    rawNotes: text('raw_notes').notNull().default(''),
    /** Raw AI output, unmodified. Never overwritten by doctor edits. */
    aiNote: jsonb('ai_note').$type<StructuredNote>(),
    /** The doctor-confirmed version. Only this one is clinical record. */
    confirmedNote: jsonb('confirmed_note').$type<StructuredNote>(),
    /** Last stage 4 result, including any flags shown to the doctor. */
    verification: jsonb('verification').$type<VerificationResult>(),
    status: text('status').$type<ConsultationStatus>().notNull().default('draft'),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('consultations_appointment_id_key').on(table.appointmentId),
    /** F3's exact query: this patient's consultations, most recent first. */
    index('consultations_patient_created_idx').on(
      table.patientId,
      table.createdAt.desc(),
    ),
  ],
)

/**
 * M5 -- one row per model call.
 *
 * A separate table, not columns on consultations (§7.3): regenerating
 * produces several attempts against one consultation, and a transcription
 * plus a structuring call are two generations for the same visit. Columns
 * cannot hold that; a row per attempt can.
 *
 * One table for BOTH stages, discriminated by `type`. Transcription and
 * structuring store the same things, so splitting them duplicates the schema
 * for no gain.
 */
export const aiGenerations = pgTable(
  'ai_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Nullable: a transcription happens before the doctor has necessarily
     * committed to a consultation, and an audit row with no parent is still
     * worth keeping.
     */
    consultationId: uuid('consultation_id').references(() => consultations.id, {
      onDelete: 'cascade',
    }),
    type: text('type').$type<GenerationType>().notNull(),
    /** The notes sent, or a description of the image. The image itself is
     * never stored (§2.3) -- only the transcript. */
    input: text('input').notNull(),
    /** Exactly what came back, before any repair or normalisation. */
    /**
     * Nullable: a call that timed out or was refused produced no output, and
     * B6 requires the attempt be audited anyway -- "a failed generation is
     * exactly what an audit trail is for". Forcing a placeholder value here
     * would make "no output" indistinguishable from "the model returned
     * null", which is precisely the distinction the trail exists to record.
     */
    rawOutput: jsonb('raw_output'),
    /**
     * §4.8: without the model name and prompt version this audit trail is
     * uninterpretable six months later. One extra column each.
     */
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    verificationStatus: text('verification_status').$type<VerificationStatus>(),
    verificationFlags: jsonb('verification_flags'),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** Populated on failure -- failures are audited too (B6). */
    errorCode: text('error_code'),
    createdAt,
  },
  (table) => [
    index('ai_generations_consultation_created_idx').on(
      table.consultationId,
      table.createdAt,
    ),
  ],
)

// --- Relations -------------------------------------------------------------

export const doctorsRelations = relations(doctors, ({ many }) => ({
  appointments: many(appointments),
}))

export const patientsRelations = relations(patients, ({ many }) => ({
  appointments: many(appointments),
  consultations: many(consultations),
}))

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  doctor: one(doctors, {
    fields: [appointments.doctorId],
    references: [doctors.id],
  }),
  patient: one(patients, {
    fields: [appointments.patientId],
    references: [patients.id],
  }),
  consultation: one(consultations),
}))

export const consultationsRelations = relations(consultations, ({ one, many }) => ({
  appointment: one(appointments, {
    fields: [consultations.appointmentId],
    references: [appointments.id],
  }),
  patient: one(patients, {
    fields: [consultations.patientId],
    references: [patients.id],
  }),
  generations: many(aiGenerations),
}))

export const aiGenerationsRelations = relations(aiGenerations, ({ one }) => ({
  consultation: one(consultations, {
    fields: [aiGenerations.consultationId],
    references: [consultations.id],
  }),
}))

// --- Inferred row types ----------------------------------------------------

export type Doctor = typeof doctors.$inferSelect
export type NewDoctor = typeof doctors.$inferInsert
export type Patient = typeof patients.$inferSelect
export type NewPatient = typeof patients.$inferInsert
export type Appointment = typeof appointments.$inferSelect
export type NewAppointment = typeof appointments.$inferInsert
export type Consultation = typeof consultations.$inferSelect
export type NewConsultation = typeof consultations.$inferInsert
export type AiGeneration = typeof aiGenerations.$inferSelect
export type NewAiGeneration = typeof aiGenerations.$inferInsert
