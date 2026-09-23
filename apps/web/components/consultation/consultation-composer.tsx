'use client'

/**
 * F4 -- the consultation composer (BUILD_ROADMAP C4).
 *
 * The textarea, the character counter, autosave, and Generate.
 *
 * GENERATE IS DISABLED IN TWO CASES, and they are different bugs:
 *
 *   E1  -- empty or whitespace-only notes. The API rejects these with 422
 *          anyway; disabling is the courtesy of not spending a round trip
 *          to be told something the button already knew.
 *   E24 -- a call already in flight. This is the one that matters. Two
 *          Generate presses are two model calls, two ai_generations rows,
 *          and two answers racing to overwrite each other's aiNote. The
 *          second is not merely wasteful, it is non-deterministic.
 */
import { LIMITS } from '@emr/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, SparklesIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ImageUpload } from '@/components/consultation/image-upload'
import { NotesEditor } from '@/components/consultation/notes-editor'
import {
  TranscriptNotice,
  TranscriptPreview,
} from '@/components/consultation/transcript-notice'
import { useUnsavedWork } from '@/components/consultation/unsaved-work-context'
import { ErrorState } from '@/components/states/error-state'
import { Button } from '@/components/ui/button'
import { api, unwrap } from '@/lib/api'
import { useAutosave } from '@/lib/use-autosave'

export function ConsultationComposer({
  consultationId,
  initialNotes,
  readOnly = false,
}: {
  consultationId: string
  initialNotes: string
  readOnly?: boolean
}) {
  const [notes, setNotes] = useState(initialNotes)
  const queryClient = useQueryClient()
  const { setDirty } = useUnsavedWork()

  /**
   * The transcript exactly as the model produced it, or null.
   *
   * Kept so the "machine-transcribed" notice can disappear the moment the
   * doctor edits a character -- the mark is a provenance claim, and it stops
   * being true as soon as the text is theirs.
   */
  const [transcript, setTranscript] = useState<string | null>(null)

  const { status, flush } = useAutosave({
    value: notes,
    enabled: !readOnly,
    onSave: async (value) => {
      unwrap(await api.consultations({ id: consultationId }).patch({ rawNotes: value }))
      // The consultation query now holds stale rawNotes. Invalidating rather
      // than writing the cache directly keeps one source of truth.
      await queryClient.invalidateQueries({
        queryKey: ['consultation', consultationId],
      })
    },
  })

  const structure = useMutation({
    mutationFn: async () => {
      /**
       * Flush BEFORE generating, not after.
       *
       * The structure endpoint deliberately takes no body -- it reads the
       * STORED rawNotes, so the client cannot structure text the server
       * never saved and break the audit chain (§4.8). That design means an
       * unflushed debounce would structure the previous draft, silently
       * producing a note for text the doctor had already changed.
       */
      await flush()
      return unwrap(await api.consultations({ id: consultationId }).structure.post())
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['consultation', consultationId],
      })
      toast.success('Note generated', {
        description: 'Review it below before saving.',
      })
    },
  })

  /**
   * Report unsaved keystrokes to the navigation guard (C8, F16).
   *
   * `pending` means the debounce is still running, `saving` that the request
   * is in flight, `error` that it failed. All three mean the server does not
   * yet hold what is on screen. `idle` and `saved` mean it does.
   */
  useEffect(() => {
    const unsaved = status === 'pending' || status === 'saving' || status === 'error'
    setDirty('notes', unsaved)
    return () => setDirty('notes', false)
  }, [status, setDirty])

  const trimmed = notes.trim()
  const isEmpty = trimmed.length < LIMITS.notesMinChars // E1
  const isTooLong = notes.length > LIMITS.notesMaxChars // E3
  const isGenerating = structure.isPending // E24

  return (
    <div className="space-y-4">
      {/*
        F8 -- above the textarea, because photographing the page is how the
        notes get there in the first place. It is an accelerant beside the
        textarea, never a replacement: typing works on its own (§3.5).
      */}
      {!readOnly && (
        <ImageUpload
          disabled={isGenerating}
          onTranscribed={({ text }) => {
            /**
             * Append rather than replace.
             *
             * A doctor who has already typed something and then photographs
             * a second page must not lose what they wrote. Replacing would
             * be silent data loss of exactly the kind §4.6 forbids
             * elsewhere, and there is no undo here.
             *
             * The transcript marker tracks the FULL resulting text, so the
             * notice reflects what is actually in the box.
             */
            const next = notes.trim() === '' ? text : `${notes.trimEnd()}\n\n${text}`
            setNotes(next)
            setTranscript(next)
          }}
        />
      )}

      {transcript !== null && (
        <>
          <TranscriptNotice transcript={transcript} currentText={notes} />
          <TranscriptPreview text={notes} />
        </>
      )}

      <NotesEditor
        value={notes}
        onChange={setNotes}
        status={status}
        disabled={readOnly}
      />

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => structure.mutate()}
            disabled={isEmpty || isTooLong || isGenerating}
            /*
              Belt and braces against E24. `disabled` stops the second click
              from reaching the handler; `aria-busy` tells assistive
              technology the action is running rather than broken.
            */
            aria-busy={isGenerating}
          >
            {isGenerating ? (
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <SparklesIcon className="size-4" aria-hidden="true" />
            )}
            {isGenerating ? 'Generating…' : 'Generate structured note'}
          </Button>

          {/*
            Say WHY the button is disabled. A greyed-out control with no
            explanation is the most common way a UI makes someone feel
            stupid, and the reason here is always actionable.
          */}
          {isEmpty && (
            <p className="text-muted-foreground text-sm">Write some notes first.</p>
          )}
          {isTooLong && (
            <p className="text-destructive text-sm">
              Notes are over the {LIMITS.notesMaxChars.toLocaleString()} character limit.
            </p>
          )}
        </div>
      )}

      {structure.error && (
        <ErrorState error={structure.error} onRetry={() => structure.mutate()} />
      )}
    </div>
  )
}
