'use client'

/**
 * F3 -- consultation history (BUILD_ROADMAP C3).
 *
 * Most recent first, each row expandable to the full structured note.
 *
 * NATIVE <details>, NOT A useState TOGGLE. It is keyboard-operable, correctly
 * announced as expandable, searchable by the browser's find-in-page even
 * while collapsed, and it works before hydration. A div with an onClick and
 * a boolean would need every one of those written by hand, and the hand-
 * written version is usually missing at least two.
 */
import type { StructuredNote } from '@emr/shared'
import { ChevronDownIcon } from 'lucide-react'
import { StructuredNoteView } from '@/components/consultation/structured-note-view'
import { formatDateShort } from '@/lib/format'

export interface HistoryEntry {
  id: string
  createdAt: string
  rawNotes: string
  confirmedNote: StructuredNote | null
  status: string
}

export function ConsultationHistory({ entries }: { entries: HistoryEntry[] }) {
  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.id}>
          <details className="group rounded-lg border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">
              <ChevronDownIcon
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden="true"
              />

              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">{formatDateShort(entry.createdAt)}</p>
                <p className="truncate text-muted-foreground text-sm">
                  {/*
                    The chief complaint is the one-line summary of a visit,
                    so it is what belongs in a collapsed row. Falling back to
                    the raw notes keeps a pre-AI or manually written
                    consultation from showing a blank line.
                  */}
                  {entry.confirmedNote?.chiefComplaint?.text ??
                    firstLine(entry.rawNotes) ??
                    'No summary recorded'}
                </p>
              </div>
            </summary>

            <div className="border-t px-4 py-4">
              {entry.confirmedNote ? (
                <StructuredNoteView note={entry.confirmedNote} />
              ) : (
                <p className="text-muted-foreground text-sm italic">
                  This consultation was saved without a structured note.
                </p>
              )}

              {/*
                The doctor's original notes, kept available underneath.
                §4.8's audit story only means something if the source text
                is actually reachable from the record it produced.
              */}
              {entry.rawNotes.trim() !== '' && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-muted-foreground text-xs hover:text-foreground">
                    Original notes
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded bg-muted px-3 py-2 font-mono text-xs">
                    {entry.rawNotes}
                  </pre>
                </details>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}

/** The first non-empty line of the raw notes, for the collapsed summary. */
function firstLine(notes: string): string | null {
  const line = notes
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0)
  return line ?? null
}
