'use client'

/**
 * Stateful wrapper around the draft review (BUILD_ROADMAP C6).
 *
 * Owns the doctor's working copy of the note and the regenerate mutation,
 * so `DraftReview` stays a presentational component that C7 can also render
 * with its own save footer.
 *
 * THE WORKING COPY IS LOCAL, deliberately. The doctor's edits live in React
 * state until they confirm (C7) -- AI output is never saved as final by
 * default (§4.7), and autosaving an in-progress correction would blur
 * `aiNote` and `confirmedNote`, which are separate columns precisely so the
 * audit trail can say what the doctor changed (§4.8, F13).
 */
import type { StructuredNote, VerificationResult } from '@emr/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DraftReview } from '@/components/consultation/draft-review'
import { SaveConsultation } from '@/components/consultation/save-consultation'
import { useUnsavedWork } from '@/components/consultation/unsaved-work-context'
import { ErrorState } from '@/components/states/error-state'
import { api, unwrap } from '@/lib/api'

export function DraftReviewPanel({
  consultationId,
  appointmentId,
  patientId,
  aiNote,
  verification,
}: {
  consultationId: string
  appointmentId: string
  patientId: string
  aiNote: StructuredNote
  verification: VerificationResult | null
}) {
  /**
   * Keyed by the AI note itself, so a regenerate resets the working copy.
   *
   * `useState` keeps its initial value across re-renders, so without this
   * the doctor would still be editing the PREVIOUS draft after regenerating
   * -- a silent, confusing staleness.
   */
  const [draftKey, setDraftKey] = useState(() => JSON.stringify(aiNote))
  const [note, setNote] = useState<StructuredNote>(aiNote)
  const [hasEdits, setHasEdits] = useState(false)
  const { setDirty } = useUnsavedWork()

  const currentKey = JSON.stringify(aiNote)
  if (currentKey !== draftKey) {
    // Render-phase reset, the documented React pattern for "derive state
    // from props when a key changes" -- cheaper and less flicker-prone than
    // an effect, which would render the stale note once first.
    setDraftKey(currentKey)
    setNote(aiNote)
    setHasEdits(false)
  }

  /**
   * Report unsaved edits to the page's navigation guard (C8, F16).
   *
   * An effect, not a render-phase call: updating a PARENT's state during
   * render is a React error, and the provider lives above this component.
   * The delay is one paint, which no human click can beat.
   *
   * Cleared on unmount, so leaving the page does not strand a dirty flag
   * that would then guard an unrelated screen.
   */
  useEffect(() => {
    setDirty('draft', hasEdits)
    return () => setDirty('draft', false)
  }, [hasEdits, setDirty])

  const queryClient = useQueryClient()

  const regenerate = useMutation({
    mutationFn: async () =>
      unwrap(await api.consultations({ id: consultationId }).structure.post()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['consultation', consultationId],
      })
      toast.success('New draft generated')
    },
  })

  return (
    <div className="space-y-3">
      <DraftReview
        note={note}
        verification={verification}
        hasEdits={hasEdits}
        isRegenerating={regenerate.isPending}
        onChange={(next) => {
          setNote(next)
          setHasEdits(true)
        }}
        onRegenerate={() => regenerate.mutate()}
        footer={
          /*
            C7's save controls fill the slot C6 left open, so they sit below
            the nudge without the nudge being able to gate them -- they are
            siblings, not parent and child.

            `note` is the doctor's edited working copy, not `aiNote`. Saving
            the AI's version would discard every correction they just made,
            which is the exact failure F13's separate columns exist to make
            impossible.
          */
          <SaveConsultation
            consultationId={consultationId}
            appointmentId={appointmentId}
            patientId={patientId}
            note={note}
          />
        }
      />

      {regenerate.error && (
        <ErrorState error={regenerate.error} onRetry={() => regenerate.mutate()} />
      )}
    </div>
  )
}
