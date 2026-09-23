'use client'

/**
 * F6 -- the editable structured note (BUILD_ROADMAP C6).
 *
 * "Every field editable -- NO READ-ONLY AI OUTPUT, NO EXCEPTIONS."
 *
 * That rule is not a UI preference, it is the safety model. §4.7: AI output
 * is a draft, and the doctor's edit is what turns it into a record. A
 * read-only field would force a doctor who spots a wrong drug name to
 * either accept it or throw the whole note away -- and under time pressure,
 * in a clinic, they will accept it.
 *
 * EDITING PRESERVES sourceSpan. The span is what stage 4 grounds against,
 * and the doctor's correction is authoritative by definition -- so the item
 * keeps its provenance rather than being silently re-verified against text
 * it no longer claims to come from. Re-running verification on a
 * doctor-edited note would flag the human for disagreeing with the model,
 * which is precisely backwards.
 */
import type {
  NoteListField,
  SourcedItem,
  StructuredNote,
  VerificationResult,
} from '@emr/shared'
import { PlusIcon, XIcon } from 'lucide-react'
import { flagsForItem, ItemFlags } from '@/components/consultation/verification-flags'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Stable React keys for list items.
 *
 * A WeakMap keyed on the item OBJECT, so identity follows the item through
 * reorders. Every edit creates a new object (state is immutable), so a
 * re-keyed item on edit would remount the input and drop focus mid-word --
 * hence `setItem` below preserves the identity by registering the
 * replacement under the same key before React re-renders.
 *
 * Weak, so removed items are collected rather than accumulating for the life
 * of the page.
 */
const itemIds = new WeakMap<object, string>()
let nextItemId = 0

function itemKey(field: NoteListField, item: SourcedItem): string {
  const existing = itemIds.get(item)
  if (existing) return existing

  const id = `${field}-${nextItemId++}`
  itemIds.set(item, id)
  return id
}

/** Carry an item's key across an immutable update, so focus is not lost. */
function inheritKey(from: SourcedItem, to: SourcedItem): SourcedItem {
  const id = itemIds.get(from)
  if (id) itemIds.set(to, id)
  return to
}

const LIST_SECTIONS: Array<{ key: NoteListField; label: string; placeholder: string }> = [
  { key: 'symptoms', label: 'Symptoms', placeholder: 'Fever for 3 days' },
  {
    key: 'relevantHistory',
    label: 'Relevant history',
    placeholder: 'Penicillin allergy',
  },
  {
    key: 'medicationsMentioned',
    // "Mentioned", never "Prescribed". The weaker verb is deliberate in the
    // schema (§4.10) and softening it here would undo the point.
    label: 'Medications mentioned',
    placeholder: 'Paracetamol',
  },
  { key: 'doctorPlan', label: 'Plan', placeholder: 'Hydration' },
]

export function NoteEditor({
  note,
  verification,
  onChange,
}: {
  note: StructuredNote
  verification: VerificationResult | null
  onChange: (note: StructuredNote) => void
}) {
  const setChiefComplaint = (text: string) => {
    onChange({
      ...note,
      chiefComplaint:
        text.trim() === ''
          ? // Null, not an empty item. The schema makes this nullable rather
            // than optional precisely so "no stated reason" is an answer
            // (§4.10), and an empty string would be neither.
            null
          : {
              text,
              sourceSpan: note.chiefComplaint?.sourceSpan ?? text,
            },
    })
  }

  const setItem = (field: NoteListField, index: number, text: string) => {
    const items = [...note[field]]
    const existing = items[index]
    if (!existing) return
    // The replacement inherits the original's key, so React updates the
    // input in place instead of remounting it and stealing the cursor.
    items[index] = inheritKey(existing, { text, sourceSpan: existing.sourceSpan })
    onChange({ ...note, [field]: items })
  }

  const addItem = (field: NoteListField) => {
    // A doctor-added item is grounded in itself: they wrote it, so it is
    // true by authorship. An empty span makes no claim about the notes,
    // which is honest -- the alternative would be asserting provenance the
    // item does not have.
    const added: SourcedItem = { text: '', sourceSpan: '' }
    onChange({ ...note, [field]: [...note[field], added] })
  }

  const removeItem = (field: NoteListField, index: number) => {
    onChange({ ...note, [field]: note[field].filter((_, i) => i !== index) })
  }

  return (
    <div className="space-y-5">
      <section>
        <label
          htmlFor="chief-complaint"
          className="mb-1 block font-medium text-muted-foreground text-xs uppercase tracking-wide"
        >
          Chief complaint
        </label>
        <Input
          id="chief-complaint"
          value={note.chiefComplaint?.text ?? ''}
          onChange={(event) => setChiefComplaint(event.target.value)}
          placeholder="Not stated"
        />
        <ItemFlags flags={flagsForItem(verification, 'chiefComplaint', null)} />
      </section>

      {LIST_SECTIONS.map(({ key, label, placeholder }) => (
        <section key={key}>
          <h3 className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {label}
          </h3>

          {note[key].length === 0 && (
            <p className="mb-2 text-muted-foreground text-sm italic">
              {/*
                An empty array is a CORRECT answer (E4/E5), not a gap. Saying
                so stops a doctor wondering whether generation failed -- and
                stops them padding it to look complete, which is the same
                pressure B3's prompt resists on the model's side.
              */}
              None recorded
            </p>
          )}

          <ul className="space-y-2">
            {note[key].map((item, index) => (
              /*
                Keyed by identity, not index. These items genuinely reorder:
                removing the second of four shifts every one after it, and an
                index key would leave React reusing the wrong <Input> --
                keeping the doctor's cursor and any in-progress text on the
                item BELOW the one they deleted. `itemKey` is stable across
                edits because it is assigned once per item and follows it.
              */
              <li key={itemKey(key, item)}>
                <div className="flex items-start gap-2">
                  <Input
                    value={item.text}
                    onChange={(event) => setItem(key, index, event.target.value)}
                    placeholder={placeholder}
                    aria-label={`${label} item ${index + 1}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(key, index)}
                    aria-label={`Remove ${label.toLowerCase()} item ${index + 1}`}
                  >
                    <XIcon className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <ItemFlags flags={flagsForItem(verification, key, index)} />
              </li>
            ))}
          </ul>

          <Button
            variant="ghost"
            size="sm"
            className="mt-1.5"
            onClick={() => addItem(key)}
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
            Add {label.toLowerCase()}
          </Button>
        </section>
      ))}
    </div>
  )
}
