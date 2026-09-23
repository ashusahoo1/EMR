'use client'

/**
 * The rough-notes textarea (BUILD_ROADMAP C4, F4).
 *
 * This is stage 2 of the pipeline: what the doctor types, or what they
 * corrected after a transcription (C5). It is the input to structuring and
 * the text every stage-4 check grounds against, so what is in this box is
 * the source of truth for the whole consultation.
 */
import { LIMITS } from '@emr/shared'
import { Textarea } from '@/components/ui/textarea'
import type { SaveStatus } from '@/lib/use-autosave'
import { cn } from '@/lib/utils'

export function NotesEditor({
  value,
  onChange,
  status,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  status: SaveStatus
  disabled?: boolean
}) {
  const { length } = value
  const max = LIMITS.notesMaxChars
  const remaining = max - length

  /**
   * Quiet until it matters. A counter that is red from the first character
   * is noise; one that changes at 90% is information. E3's cap is enforced
   * server-side regardless -- this is the courtesy warning before a wasted
   * round trip, never the enforcement point (§4.2).
   */
  const nearLimit = remaining <= max * 0.1
  const overLimit = remaining < 0

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor="raw-notes" className="font-medium text-sm">
          Consultation notes
        </label>
        <SaveIndicator status={status} />
      </div>

      <Textarea
        id="raw-notes"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        // Tall by default: these are clinical notes, not a comment box, and
        // a doctor should not have to scroll to see what they just wrote.
        className="min-h-64 font-mono text-sm leading-relaxed"
        placeholder={
          'C/O fever x3d, mild cough\nno breathlessness\nadvised hydration, rest'
        }
        // Describes the counter below, so a screen reader reaching the field
        // hears the limit rather than discovering it on rejection.
        aria-describedby="notes-counter"
      />

      <div className="flex items-baseline justify-between gap-4">
        <p className="text-muted-foreground text-xs">
          Shorthand is fine — it is normalised when the note is structured.
        </p>
        <p
          id="notes-counter"
          className={cn(
            'text-xs tabular-nums',
            overLimit
              ? 'font-medium text-destructive'
              : nearLimit
                ? 'text-amber-700'
                : 'text-muted-foreground',
          )}
        >
          {length.toLocaleString()} / {max.toLocaleString()}
        </p>
      </div>
    </div>
  )
}

/**
 * Autosave feedback.
 *
 * `aria-live="polite"` so the change is announced without interrupting
 * typing. Silent while idle: a permanent "Saved" badge on an untouched
 * draft is a claim about work that never happened.
 */
function SaveIndicator({ status }: { status: SaveStatus }) {
  const text =
    status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? 'Draft saved'
        : status === 'error'
          ? 'Could not save'
          : status === 'pending'
            ? 'Unsaved changes'
            : null

  return (
    <span
      aria-live="polite"
      className={cn(
        'text-xs',
        status === 'error' ? 'font-medium text-destructive' : 'text-muted-foreground',
      )}
    >
      {text}
    </span>
  )
}
