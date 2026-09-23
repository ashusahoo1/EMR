'use client'

/**
 * F5 + F6 -- review and edit the AI draft (BUILD_ROADMAP C6).
 *
 * "The heart of the product."
 *
 * F14 -- AI-GENERATED vs DOCTOR-CONFIRMED MUST BE VISUALLY DISTINCT, and
 * the brief lists this under its UX criteria. The distinction is not
 * cosmetic: it is the difference between "a machine suggested this" and "a
 * clinician stands behind this", and a record that blurs the two is
 * precisely what makes AI in clinical software untrustworthy. So an
 * unconfirmed draft carries a dashed border, a tinted background and an
 * explicit "AI draft — not saved" badge; the confirmed note (C7) does not.
 */
import type { StructuredNote, VerificationResult } from '@emr/shared'
import { SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { MissingInfoNudge } from '@/components/consultation/missing-info-nudge'
import { NoteEditor } from '@/components/consultation/note-editor'
import { VerificationSummary } from '@/components/consultation/verification-flags'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function DraftReview({
  note,
  verification,
  onChange,
  onRegenerate,
  isRegenerating = false,
  hasEdits = false,
  footer,
}: {
  note: StructuredNote
  verification: VerificationResult | null
  onChange: (note: StructuredNote) => void
  onRegenerate?: (() => void) | undefined
  isRegenerating?: boolean
  /** True once the doctor has changed anything -- drives the E30 prompt. */
  hasEdits?: boolean
  /** C7's save controls, rendered below the nudge. */
  footer?: React.ReactNode
}) {
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)

  const handleRegenerate = () => {
    // E30 -- "Editing then regenerating: the doctor's edits are not silently
    // overwritten; confirm first." Regeneration replaces the whole note, so
    // without this a doctor who spent two minutes correcting a drug name
    // loses that work to one click with no warning and no undo.
    if (hasEdits) {
      setConfirmRegenerate(true)
      return
    }
    onRegenerate?.()
  }

  return (
    <section
      /*
        F14, structurally: dashed border and a tint mark this as provisional.
        A doctor glancing at the screen should be able to tell a draft from a
        record without reading a word.
      */
      className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/[0.03] p-4"
      aria-labelledby="draft-heading"
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" aria-hidden="true" />
          <h2 id="draft-heading" className="font-medium text-sm">
            AI draft
          </h2>
          <Badge variant="outline" className="border-primary/40 text-primary">
            Not saved
          </Badge>
        </div>

        {onRegenerate && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
            disabled={isRegenerating}
            aria-busy={isRegenerating}
          >
            {isRegenerating ? 'Regenerating…' : 'Regenerate'}
          </Button>
        )}
      </header>

      <p className="mb-3 text-muted-foreground text-xs">
        Every field is editable. Nothing here is saved until you confirm it.
      </p>

      <div className="mb-4">
        <VerificationSummary verification={verification} />
      </div>

      <NoteEditor note={note} verification={verification} onChange={onChange} />

      {/*
        The nudge sits ABOVE the save controls, per C6, and has no ability to
        block them -- it takes no callback that could gate a submit.
      */}
      <div className="mt-6 space-y-3">
        <MissingInfoNudge items={note.missingInformation} />
        {footer}
      </div>

      <Dialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace your edits?</DialogTitle>
            <DialogDescription>
              You have changed this draft. Regenerating builds a new note from your
              consultation notes and discards those changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Keep my edits</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmRegenerate(false)
                onRegenerate?.()
              }}
            >
              Regenerate anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
