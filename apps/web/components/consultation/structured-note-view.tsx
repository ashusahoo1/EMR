/**
 * Read-only rendering of a StructuredNote (BUILD_ROADMAP C3, F3).
 *
 * Used by the history panel here and reused by C6's review screen, so the
 * confirmed note a doctor reads back looks identical to the one they
 * approved. Two renderings of the same data would be a quiet way to make
 * them distrust both.
 *
 * `sourceSpan` IS NOT SHOWN. §4.5 is explicit that it is machinery for
 * verification and provenance, "never shown to the doctor as itself".
 * Printing it here would double the visual weight of every item with text
 * the doctor already wrote, for no clinical gain.
 */
import type { SourcedItem, StructuredNote } from '@emr/shared'

/** Field order, chosen to read like a consultation rather than like JSON. */
const SECTIONS: Array<{
  key: 'symptoms' | 'relevantHistory' | 'medicationsMentioned' | 'doctorPlan'
  label: string
}> = [
  { key: 'symptoms', label: 'Symptoms' },
  { key: 'relevantHistory', label: 'Relevant history' },
  // "Mentioned", never "Prescribed" -- the weaker verb is deliberate in the
  // schema (§4.10) and softening it here would undo that.
  { key: 'medicationsMentioned', label: 'Medications mentioned' },
  { key: 'doctorPlan', label: 'Plan' },
]

export function StructuredNoteView({ note }: { note: StructuredNote }) {
  const populated = SECTIONS.filter((section) => note[section.key].length > 0)

  return (
    <div className="space-y-4 text-sm">
      {note.chiefComplaint && (
        <Section label="Chief complaint">
          <p>{note.chiefComplaint.text}</p>
        </Section>
      )}

      {populated.map((section) => (
        <Section key={section.key} label={section.label}>
          <ItemList items={note[section.key]} />
        </Section>
      ))}

      {/*
        missingInformation is a NUDGE, never a blocker (§1.3, §4.7). Styled
        quietly and placed last: it tells the doctor what the notes did not
        record, which is useful context, not an error to resolve.
      */}
      {note.missingInformation.length > 0 && (
        <Section label="Not recorded">
          <ul className="space-y-1 text-muted-foreground">
            {note.missingInformation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>
      )}

      {isEmpty(note) && (
        <p className="text-muted-foreground italic">
          This consultation has no structured content.
        </p>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </h4>
      {children}
    </div>
  )
}

function ItemList({ items }: { items: SourcedItem[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        // The text is the identity: two items with identical text in one
        // list would be a duplicate, not two distinct findings.
        <li key={item.text} className="flex gap-2">
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** Whether every field is empty -- E29 allows saving a note like this. */
function isEmpty(note: StructuredNote): boolean {
  return (
    note.chiefComplaint === null &&
    note.symptoms.length === 0 &&
    note.relevantHistory.length === 0 &&
    note.medicationsMentioned.length === 0 &&
    note.doctorPlan.length === 0 &&
    note.missingInformation.length === 0
  )
}
