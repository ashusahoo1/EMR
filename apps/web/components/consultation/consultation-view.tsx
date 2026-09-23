'use client'

/**
 * The consultation screen (BUILD_ROADMAP C4).
 *
 * Loads the consultation and renders the composer. C6 adds the AI draft
 * review below this; C7 adds save and status. Kept as its own component so
 * the page stays a thin server shell that only awaits `params`.
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { ConsultationComposer } from '@/components/consultation/consultation-composer'
import { StructuredNoteView } from '@/components/consultation/structured-note-view'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { api, unwrap } from '@/lib/api'
import { formatDateShort } from '@/lib/format'

export function ConsultationView({ consultationId }: { consultationId: string }) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['consultation', consultationId],
    queryFn: async () => unwrap(await api.consultations({ id: consultationId }).get()),
  })

  if (isPending) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <LoadingState rows={3} variant="form" label="Loading consultation" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </main>
    )
  }

  const { consultation } = data
  const isConfirmed = consultation.status === 'confirmed'

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href={`/patients/${consultation.patientId}`}
        className="mb-6 inline-flex items-center gap-1.5 rounded-sm text-muted-foreground text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
        Back to patient
      </Link>

      <header className="mb-6">
        <h1 className="font-semibold text-2xl tracking-tight">Consultation</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          {formatDateShort(consultation.createdAt)}
          {isConfirmed ? ' · Saved' : ' · Draft'}
        </p>
      </header>

      {/*
        A confirmed consultation is immutable (the API returns 409 on a
        PATCH). Rendering it read-only means the doctor meets that rule as a
        disabled field rather than as a rejected save.
      */}
      <ConsultationComposer
        consultationId={consultationId}
        initialNotes={consultation.rawNotes}
        readOnly={isConfirmed}
      />

      {/*
        A minimal draft preview so C4 is usable on its own. C6 replaces this
        with the editable review, provenance and verification flags.
      */}
      {consultation.aiNote && (
        <section className="mt-8 rounded-lg border bg-card p-4">
          <h2 className="mb-3 font-medium text-sm">AI draft</h2>
          <StructuredNoteView note={consultation.aiNote} />
        </section>
      )}

      {isConfirmed && consultation.confirmedNote && (
        <section className="mt-8 rounded-lg border bg-card p-4">
          <h2 className="mb-3 font-medium text-sm">Saved note</h2>
          <StructuredNoteView note={consultation.confirmedNote} />
        </section>
      )}
    </main>
  )
}
