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
}: {
  appointmentId: string
  consultationId: string | null
  size?: 'sm' | 'default'
}) {
  const router = useRouter()

  const start = useMutation({
    mutationFn: async () => {
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
