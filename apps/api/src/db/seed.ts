/**
 * Seed data (BUILD_ROADMAP A4).
 *
 * Two properties this file must hold, both tested at the bottom of the step:
 *
 *   1. IDEMPOTENT. Running it twice produces the same database, not double
 *      the rows. It deletes in FK-safe order first, so re-seeding mid-demo is
 *      safe rather than destructive-in-a-surprising-way.
 *
 *   2. RELATIVE TO TODAY. Appointment times are computed from the current
 *      date, never hardcoded. A hardcoded date means the reviewer clones the
 *      repo, runs it, and sees an empty dashboard -- which reads as a broken
 *      app, not a stale fixture.
 *
 * Patients match SYNTHETIC_NOTES_TEST.md exactly (name, age, sex) so the
 * golden set and the seeded app tell one coherent story in the demo: the
 * handwritten note you photograph belongs to a patient who is actually in
 * the database.
 *
 * All names and details are invented. No real patient data. (§5.9)
 */
import type { StructuredNote } from '@emr/shared'
import { db, sql } from './client.ts'
import {
  aiGenerations,
  appointments,
  consultations,
  doctors,
  patients,
} from './schema.ts'

/**
 * Local-time date at a given hour/minute today, offset by whole days.
 *
 * Times are interpreted in the SERVER's local zone, which is what a clinic
 * means by "09:00". Stored as timestamptz, so the instant is unambiguous.
 *
 * Note for A6: `scheduled_at::date = current_date` evaluates in the database
 * session's timezone, not the clinic's. The seeded clinic hours (09:00-12:30
 * IST = 03:30-07:00 UTC) sit inside a single UTC day so the naive filter
 * happens to work -- but an appointment after 18:30 IST would land on the
 * next UTC date and vanish from "today". The appointments query must filter
 * on an explicit zone, not on the session default.
 */
function at(hour: number, minute: number, dayOffset = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d
}

// --- Patients --------------------------------------------------------------
// Allergies and conditions are drawn from the golden-set notes themselves
// where the note states one (N04's sulfa allergy, N01's penicillin allergy),
// so the E17 survival check has real data behind it.

const PATIENTS = [
  {
    key: 'rahul',
    name: 'Rahul Sharma',
    age: 34,
    sex: 'M',
    phone: '+91 98200 11234',
    allergies: ['Penicillin'],
    existingConditions: [],
  },
  {
    key: 'priya',
    name: 'Priya Singh',
    age: 28,
    sex: 'F',
    phone: '+91 98200 22345',
    allergies: [],
    existingConditions: ['Hypothyroidism'],
  },
  {
    key: 'amit',
    name: 'Amit Kumar',
    age: 45,
    sex: 'M',
    phone: '+91 98200 33456',
    allergies: [],
    existingConditions: [],
  },
  {
    key: 'sunita',
    name: 'Sunita Devi',
    age: 52,
    sex: 'F',
    phone: '+91 98200 44567',
    // N04 -- the allergy that must survive into relevantHistory (E17).
    allergies: ['Sulfa drugs'],
    existingConditions: ['Type 2 Diabetes Mellitus'],
  },
  {
    key: 'ramesh',
    name: 'Ramesh Iyer',
    age: 61,
    sex: 'M',
    phone: '+91 98200 55678',
    allergies: [],
    existingConditions: ['Hypertension'],
  },
  {
    // N06 / E28 -- deliberately left with no consultation history so the
    // empty state is visible in the demo rather than theoretical.
    key: 'kavita',
    name: 'Kavita Rao',
    age: 23,
    sex: 'F',
    phone: '+91 98200 66789',
    allergies: [],
    existingConditions: [],
  },
  {
    key: 'farhan',
    name: 'Farhan Qureshi',
    age: 38,
    sex: 'M',
    phone: '+91 98200 77890',
    allergies: [],
    existingConditions: [],
  },
  {
    key: 'deepak',
    name: 'Deepak Menon',
    age: 47,
    sex: 'M',
    phone: '+91 98200 88901',
    allergies: [],
    existingConditions: ['Gastro-oesophageal reflux disease'],
  },
  {
    key: 'neha',
    name: 'Neha Bhatt',
    age: 31,
    sex: 'F',
    phone: '+91 98200 99012',
    allergies: [],
    existingConditions: [],
  },
  {
    key: 'arjun',
    name: 'Arjun Nair',
    age: 19,
    sex: 'M',
    phone: '+91 98200 10123',
    allergies: [],
    existingConditions: [],
  },
  {
    key: 'meera',
    name: 'Meera Joshi',
    age: 40,
    sex: 'F',
    phone: '+91 98200 21234',
    allergies: [],
    existingConditions: [],
  },
  {
    key: 'vikram',
    name: 'Vikram Patel',
    age: 55,
    sex: 'M',
    phone: '+91 98200 32345',
    allergies: [],
    existingConditions: ['Type 2 Diabetes Mellitus'],
  },
] as const

type PatientKey = (typeof PATIENTS)[number]['key']

// --- Past consultations ----------------------------------------------------
// Fully populated structured notes so F3 (history) is not empty on first
// click, and so C6's provenance display has real content to render.

function note(partial: Partial<StructuredNote>): StructuredNote {
  return {
    chiefComplaint: null,
    symptoms: [],
    relevantHistory: [],
    medicationsMentioned: [],
    doctorPlan: [],
    missingInformation: [],
    ...partial,
  }
}

const PAST_CONSULTATIONS: ReadonlyArray<{
  patient: PatientKey
  daysAgo: number
  hour: number
  reason: string
  rawNotes: string
  confirmedNote: StructuredNote
}> = [
  {
    patient: 'ramesh',
    daysAgo: 35,
    hour: 10,
    reason: 'Hypertension follow-up',
    rawNotes:
      'follow up for hypertension\nno chest pain, no breathlessness\ncontinues amlodipine\nadvised low salt diet, daily walk\nreview after 1 month',
    confirmedNote: note({
      chiefComplaint: {
        text: 'Hypertension follow-up',
        sourceSpan: 'follow up for hypertension',
      },
      symptoms: [
        { text: 'No chest pain', sourceSpan: 'no chest pain' },
        { text: 'No breathlessness', sourceSpan: 'no breathlessness' },
      ],
      relevantHistory: [
        { text: 'Hypertension', sourceSpan: 'follow up for hypertension' },
      ],
      medicationsMentioned: [{ text: 'Amlodipine', sourceSpan: 'continues amlodipine' }],
      doctorPlan: [
        { text: 'Low salt diet', sourceSpan: 'advised low salt diet' },
        { text: 'Daily walk', sourceSpan: 'daily walk' },
        { text: 'Review after 1 month', sourceSpan: 'review after 1 month' },
      ],
      missingInformation: ['Blood pressure was not recorded'],
    }),
  },
  {
    patient: 'ramesh',
    daysAgo: 96,
    hour: 11,
    reason: 'Routine review',
    rawNotes:
      'routine review, feels well\nno giddiness, no palpitations\non amlodipine\nadvised to continue same, review in 3 months',
    confirmedNote: note({
      chiefComplaint: { text: 'Routine review', sourceSpan: 'routine review' },
      symptoms: [
        { text: 'Feels well', sourceSpan: 'feels well' },
        { text: 'No giddiness', sourceSpan: 'no giddiness' },
        { text: 'No palpitations', sourceSpan: 'no palpitations' },
      ],
      relevantHistory: [{ text: 'Hypertension', sourceSpan: 'on amlodipine' }],
      medicationsMentioned: [{ text: 'Amlodipine', sourceSpan: 'on amlodipine' }],
      doctorPlan: [
        { text: 'Continue current medication', sourceSpan: 'continue same' },
        { text: 'Review in 3 months', sourceSpan: 'review in 3 months' },
      ],
      missingInformation: ['Blood pressure was not recorded'],
    }),
  },
  {
    patient: 'sunita',
    daysAgo: 21,
    hour: 12,
    reason: 'Burning urination',
    rawNotes:
      'burning urination x4d\nmild lower abdominal pain\nh/o diabetes, on metformin\nALLERGIC TO SULFA DRUGS\nstarted on nitrofurantoin\nadvised plenty of fluids\nurine culture sent',
    confirmedNote: note({
      chiefComplaint: {
        text: 'Burning urination',
        sourceSpan: 'burning urination x4d',
      },
      symptoms: [
        { text: 'Burning urination for 4 days', sourceSpan: 'burning urination x4d' },
        {
          text: 'Mild lower abdominal pain',
          sourceSpan: 'mild lower abdominal pain',
        },
      ],
      relevantHistory: [
        { text: 'Diabetes', sourceSpan: 'h/o diabetes' },
        // E17 -- this is the item that must never be dropped.
        { text: 'Sulfa drug allergy', sourceSpan: 'ALLERGIC TO SULFA DRUGS' },
      ],
      medicationsMentioned: [
        { text: 'Metformin', sourceSpan: 'on metformin' },
        { text: 'Nitrofurantoin', sourceSpan: 'started on nitrofurantoin' },
      ],
      doctorPlan: [
        { text: 'Plenty of fluids', sourceSpan: 'advised plenty of fluids' },
        { text: 'Urine culture sent', sourceSpan: 'urine culture sent' },
      ],
    }),
  },
  {
    patient: 'sunita',
    daysAgo: 74,
    hour: 9,
    reason: 'Diabetes review',
    rawNotes:
      'diabetes review\nno polyuria, no polydipsia\ncontinues metformin\nadvised HbA1c, review with reports',
    confirmedNote: note({
      chiefComplaint: { text: 'Diabetes review', sourceSpan: 'diabetes review' },
      symptoms: [
        { text: 'No polyuria', sourceSpan: 'no polyuria' },
        { text: 'No polydipsia', sourceSpan: 'no polydipsia' },
      ],
      relevantHistory: [{ text: 'Diabetes', sourceSpan: 'diabetes review' }],
      medicationsMentioned: [{ text: 'Metformin', sourceSpan: 'continues metformin' }],
      doctorPlan: [
        { text: 'HbA1c', sourceSpan: 'advised HbA1c' },
        { text: 'Review with reports', sourceSpan: 'review with reports' },
      ],
      missingInformation: ['Weight was not recorded'],
    }),
  },
]

// --- Today's appointments --------------------------------------------------
// 2 completed, 1 in consultation, 3 waiting -- so the dashboard shows every
// status without anyone having to click through a flow first.

const TODAY_APPOINTMENTS: ReadonlyArray<{
  patient: PatientKey
  hour: number
  minute: number
  reason: string
  status: 'waiting' | 'in_consultation' | 'completed'
}> = [
  {
    patient: 'ramesh',
    hour: 9,
    minute: 0,
    reason: 'Hypertension follow-up',
    status: 'completed',
  },
  {
    patient: 'priya',
    hour: 9,
    minute: 30,
    reason: 'Sore throat',
    status: 'completed',
  },
  {
    patient: 'rahul',
    hour: 10,
    minute: 0,
    reason: 'Fever and cough',
    status: 'in_consultation',
  },
  { patient: 'amit', hour: 11, minute: 0, reason: 'Headache', status: 'waiting' },
  {
    patient: 'kavita',
    hour: 11,
    minute: 30,
    reason: 'General check-up',
    status: 'waiting',
  },
  {
    patient: 'deepak',
    hour: 12,
    minute: 30,
    reason: 'Acidity and bloating',
    status: 'waiting',
  },
]

// --- Run -------------------------------------------------------------------

export interface SeedCounts {
  doctors: number
  patients: number
  todaysAppointments: number
  pastConsultations: number
}

export async function seed(): Promise<SeedCounts> {
  // Delete in FK-safe order. Cascades would handle most of this, but being
  // explicit means the order is documented and a schema change that breaks it
  // fails loudly here rather than silently leaving orphans.
  await db.delete(aiGenerations)
  await db.delete(consultations)
  await db.delete(appointments)
  await db.delete(patients)
  await db.delete(doctors)

  const [doctor] = await db
    .insert(doctors)
    .values({ name: 'Dr. Anjali Verma', specialty: 'General Medicine' })
    .returning()
  if (!doctor) throw new Error('seed: doctor insert returned no row')

  const inserted = await db
    .insert(patients)
    .values(
      PATIENTS.map((p) => ({
        name: p.name,
        age: p.age,
        sex: p.sex,
        phone: p.phone,
        allergies: [...p.allergies],
        existingConditions: [...p.existingConditions],
      })),
    )
    .returning()

  /** key -> id, so the fixtures below can reference patients by name. */
  const patientId = new Map<PatientKey, string>()
  PATIENTS.forEach((p, i) => {
    const row = inserted[i]
    if (!row) throw new Error(`seed: no row returned for patient ${p.name}`)
    patientId.set(p.key, row.id)
  })

  const idOf = (key: PatientKey): string => {
    const id = patientId.get(key)
    if (!id) throw new Error(`seed: unknown patient key ${key}`)
    return id
  }

  // Past consultations, each with its own completed appointment, so history
  // rows are reachable from a real appointment rather than floating.
  for (const past of PAST_CONSULTATIONS) {
    const scheduledAt = at(past.hour, 0, -past.daysAgo)
    const [appointment] = await db
      .insert(appointments)
      .values({
        doctorId: doctor.id,
        patientId: idOf(past.patient),
        scheduledAt,
        reason: past.reason,
        status: 'completed',
      })
      .returning()
    if (!appointment) throw new Error('seed: appointment insert returned no row')

    await db.insert(consultations).values({
      appointmentId: appointment.id,
      patientId: idOf(past.patient),
      rawNotes: past.rawNotes,
      // Seeded history is doctor-confirmed record. aiNote stays null: these
      // predate the AI feature, and pretending otherwise would put fake
      // entries in the audit trail that F13 exists to make trustworthy.
      confirmedNote: past.confirmedNote,
      status: 'confirmed',
      createdAt: scheduledAt,
      updatedAt: scheduledAt,
    })
  }

  await db.insert(appointments).values(
    TODAY_APPOINTMENTS.map((a) => ({
      doctorId: doctor.id,
      patientId: idOf(a.patient),
      scheduledAt: at(a.hour, a.minute),
      reason: a.reason,
      status: a.status,
    })),
  )

  return {
    doctors: 1,
    patients: PATIENTS.length,
    todaysAppointments: TODAY_APPOINTMENTS.length,
    pastConsultations: PAST_CONSULTATIONS.length,
  }
}

if (import.meta.main) {
  try {
    console.log('Seeded:', await seed())
  } finally {
    await sql.end()
  }
}
