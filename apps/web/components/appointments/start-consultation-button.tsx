'use client'

/**
 * Open or start the consultation for an appointment (BUILD_ROADMAP C4).
 *
 * The bridge between F1's list and F4's composer. An appointment either
 * already has a consultation (open it) or does not (create one, then open
 * it), and the row carries `consultationId` so the client knows which
 * without an extra request.
 *
 * E25 -- ONE CONSULTATION PER APPOINTMENT. The API enforces this with a
 * unique index and answers a duplicate create with 409 CONSULTATION_EXISTS,
 * so the guarantee does not depend on this button behaving. But a doctor
 * double-clicking should not SEE a 409 either, so the mutation is disabled
 * while in flight and the 409 is handled as success -- someone else (or
 * another tab) created it, which is the outcome we wanted anyway.
 */
import { useMutation } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ApiError, api, unwrap } from '@/lib/api'

export function StartConsultationButton({
  appointmentId,
  consultationId,
  size = 'sm',
  className,
}: {
  appointmentId: string
  consultationId: string | null
  size?: 'sm' | 'default'
  className?: string
}) {
  const router = useRouter()

  const start = useMutation({
    mutationFn: async () => {
      /**
       * F15 -- move the appointment into `in_consultation` (C7).
       *
       * The transition rules are waiting -> in_consultation -> completed,
       * so skipping this step makes the save's waiting -> completed jump
       * ILLEGAL and the API answers 409 INVALID_STATUS_TRANSITION. The
       * appointment then sits on "Waiting" forever even though the note is
       * saved, which is what manual testing found.
       *
       * Deliberately not allowed to block opening the consultation: a
       * scheduling label is not worth standing between a doctor and the
       * notes they came here to write. Re-applying an existing status is a
       * no-op success server-side, so reopening is safe too.
       */
      try {
        await api.appointments({ id: appointmentId }).status.patch({
          status: 'in_consultation',
        })
      } catch {
        // Already in_consultation or completed -- either is fine.
      }

      if (consultationId) return consultationId

      try {
        const created = unwrap(
          await api.consultations.post({ appointmentId, rawNotes: '' }),
        )
        return created.consultation.id
      } catch (error) {
        // The consultation already exists -- a race with another tab, or a
        // double-click that beat the disabled state. Not an error from the
        // doctor's point of view.
        if (error instanceof ApiError && error.code === 'CONSULTATION_EXISTS') {
          const existing = unwrap(
            await api.appointments.get({ query: {} }),
          ).appointments.find((row) => row.id === appointmentId)

          if (existing?.consultationId) return existing.consultationId
        }
        throw error
      }
    },
    onSuccess: (id) => router.push(`/consultations/${id}`),
    onError: (error) => {
      toast.error('Could not start the consultation', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      })
    },
  })

  return (
    <Button
      className={className}
      size={size}
      variant={consultationId ? 'outline' : 'default'}
      onClick={() => start.mutate()}
      disabled={start.isPending}
      aria-busy={start.isPending}
    >
      {start.isPending && (
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
      )}
      {consultationId ? 'Open consultation' : 'Start consultation'}
    </Button>
  )
}
