'use client'

/**
 * "This text came from a photograph" (BUILD_ROADMAP C5).
 *
 * C5: transcribed text lands in the normal editable textarea, "visibly
 * marked machine-transcribed UNTIL EDITED".
 *
 * The "until edited" is the interesting half. The mark is not decoration --
 * it is a claim about provenance, and the moment the doctor changes a
 * character the text is no longer purely machine output. Leaving the badge
 * up after that would be a small, steady lie, and §4.4's whole argument is
 * that the doctor's correction is what makes the transcript trustworthy.
 *
 * The illegible count is surfaced here too, because a transcript with three
 * unreadable words needs a different amount of attention from one with none,
 * and that is worth knowing before reading rather than after.
 */
import { AlertCircleIcon, CameraIcon } from 'lucide-react'
import {
  countIllegible,
  IllegibleHighlight,
} from '@/components/consultation/illegible-highlight'

export function TranscriptNotice({
  transcript,
  currentText,
}: {
  /** The text exactly as the model produced it. */
  transcript: string
  /** What is in the textarea now. */
  currentText: string
}) {
  const edited = currentText !== transcript
  const illegibleCount = countIllegible(currentText)

  // Once edited, the provenance claim no longer holds -- drop the notice
  // rather than qualifying it.
  if (edited) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-muted-foreground text-xs">
        <CameraIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Transcribed from a photograph. Read it through and correct anything misread
          before generating the note.
        </span>
      </div>

      {illegibleCount > 0 && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 text-xs"
          /*
            `alert`, because this is the one thing the doctor must not skim
            past. §4.3: a guess here is invisible to every later check, so
            the marker existing at all is the system working -- but only if
            it is read.
          */
          role="alert"
        >
          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold">
              {illegibleCount} {illegibleCount === 1 ? 'word' : 'words'} could not be
              read.
            </strong>{' '}
            They are marked below. Type what the page actually says — the model
            deliberately did not guess.
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * A read-only rendering of the transcript with markers highlighted.
 *
 * Shown ABOVE the textarea rather than inside it, because a `<textarea>`
 * cannot contain markup -- highlighting inside one means a contenteditable
 * or an overlay hack, both of which break text selection, spellcheck and
 * mobile keyboards. A short reference copy costs none of that.
 */
export function TranscriptPreview({ text }: { text: string }) {
  if (countIllegible(text) === 0) return null

  return (
    <details className="rounded-md border bg-card px-3 py-2">
      <summary className="cursor-pointer text-muted-foreground text-xs">
        Show the unreadable words in context
      </summary>
      <p className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed">
        <IllegibleHighlight text={text} />
      </p>
    </details>
  )
}
