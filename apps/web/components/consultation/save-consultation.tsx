'use client'

/**
 * F7 + F15 -- confirm the note and advance the appointment (C7).
 *
 * The moment the AI draft becomes a clinical record. §4.7: nothing is
 * clinical until the doctor confirms it, and this button is that boundary.
 *
 * E25 ON THE CLIENT TOO, in addition to A7's server guarantee. The server
 * makes confirm idempotent with a conditional update, so a second call
 * succeeds and changes nothing -- the record cannot be corrupted by a
 * double-click. But "cannot be corrupted" is not the same as "behaves
 * well": two in-flight requests still mean two round trips, two status
 * patches and a confusing double toast. The disabled state is about the
 * doctor's experience; the server guarantee is about the data.
 *
 * ORDER MATTERS: confirm FIRST, then advance the appointment. If the status
 * patch fails, the note is still saved -- which is the outcome the doctor
 * cares about. Doing it the other way round could mark an appointment
 * completed for a consultation that was never stored.
 */
import type { StructuredNote } from '@emr/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, Loader2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useUnsavedWork } from '@/components/consultation/unsaved-work-context'
import { ErrorState } from '@/components/states/error-state'
import { Button } from '@/components/ui/button'
import { ApiError, api, unwrap } from '@/lib/api'

export function SaveConsultation({
  consultationId,
  appointmentId,
  patientId,
  note,
}: {
  consultationId: string
  appointmentId: string
  patientId: string
  note: StructuredNote
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { setDirty } = useUnsavedWork()

  const save = useMutation({
    mutationFn: async () => {
      const result = unwrap(
        await api.consultations({ id: consultationId }).confirm.post({
          confirmedNote: note,
        }),
      )

      /**
       * F15 -- advance the appointment to completed.
       *
       * Deliberately NOT allowed to fail the save. The note is already
       * stored by this point; a failed status patch is a scheduling
       * inconvenience, not a clinical one, and surfacing it as "save
       * failed" would be a lie that sends the doctor back to re-enter a
       * note that is safely in the database.
       *
       * Re-applying an existing status is a no-op success server-side, so
       * an already-completed appointment does not error here either.
       *
       * TWO STEPS, because the transitions are waiting -> in_consultation
       * -> completed and the API rejects the jump with 409. Opening the
       * consultation normally does the first step, but a consultation
       * reached another way -- a direct URL, a bookmark, a row whose status
       * was changed elsewhere -- would leave the appointment stuck on
       * "Waiting" with the note saved. Manual testing found exactly that.
       */
      try {
        await api.appointments({ id: appointmentId }).status.patch({
          status: 'completed',
        })
      } catch {
        // Likely still `waiting`. Step through the intermediate state and
        // try once more.
        try {
          await api.appointments({ id: appointmentId }).status.patch({
            status: 'in_consultation',
          })
          await api.appointments({ id: appointmentId }).status.patch({
            status: 'completed',
          })
        } catch {
          // Logged rather than surfaced; the save itself succeeded.
          console.warn('Consultation saved, but the appointment status did not advance.')
        }
      }

      return result
    },

    onSuccess: async () => {
      /**
       * Clear the guard BEFORE navigating (F16).
       *
       * The edits are now on the server, so they are no longer unsaved. The
       * unmount cleanup would eventually do this, but "eventually" is after
       * the transition has begun -- and a `beforeunload` firing in that
       * window would ask the doctor to confirm discarding work that was
       * successfully saved a moment earlier. Clearing here makes the flag
       * honest at every instant rather than almost every instant.
       */
      setDirty('draft', false)
      setDirty('notes', false)

      /**
       * "Visible immediately" is C7's done-when, and it is a cache problem
       * rather than a server one. The patient's history query already holds
       * a result without this consultation in it, so without invalidating,
       * the doctor lands on a history page that does not show what they
       * just saved -- and concludes the save failed.
       */
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['consultation', consultationId] }),
        queryClient.invalidateQueries({ queryKey: ['patient', patientId] }),
        queryClient.invalidateQueries({ queryKey: ['appointments'] }),
      ])

      toast.success('Consultation saved', {
        description: 'It now appears in the patient history.',
      })

      router.push(`/patients/${patientId}`)
    },
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          aria-busy={save.isPending}
        >
          {save.isPending ? (
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckIcon className="size-4" aria-hidden="true" />
          )}
          {save.isPending ? 'Saving…' : 'Save to patient record'}
        </Button>

        <p className="text-muted-foreground text-sm">
          {/*
            Said plainly, because it is the one irreversible step in the
            flow: a confirmed consultation is immutable (the API answers a
            later PATCH with 409).
          */}
          Saved notes cannot be edited afterwards.
        </p>
      </div>

      {save.error && (
        <ErrorState
          error={save.error}
          // ALREADY_CONFIRMED is not worth retrying -- it means the note is
          // already saved, which is what the doctor wanted.
          onRetry={
            save.error instanceof ApiError && save.error.code === 'ALREADY_CONFIRMED'
              ? undefined
              : () => save.mutate()
          }
        />
      )}
    </div>
  )
}
