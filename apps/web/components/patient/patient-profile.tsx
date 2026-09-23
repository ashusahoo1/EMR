'use client'

/**
 * The patient profile view (BUILD_ROADMAP C3, F2 + F3).
 *
 * Two independent queries rather than one combined endpoint, because the
 * profile and the history fail independently: a patient whose history query
 * errors should still show their allergies, which is exactly the
 * information a doctor most needs when something is going wrong.
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, FileTextIcon } from 'lucide-react'
import Link from 'next/link'
import { AllergyBanner } from '@/components/patient/allergy-banner'
import {
  ConsultationHistory,
  type HistoryEntry,
} from '@/components/patient/consultation-history'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { api, unwrap } from '@/lib/api'
import { formatPatientMeta } from '@/lib/format'

export function PatientProfile({ patientId }: { patientId: string }) {
  const patientQuery = useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => unwrap(await api.patients({ id: patientId }).get()),
  })

  const historyQuery = useQuery({
    queryKey: ['patient', patientId, 'consultations'],
    queryFn: async () =>
      unwrap(await api.patients({ id: patientId }).consultations.get()),
  })

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 rounded-sm text-muted-foreground text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
        Back to appointments
      </Link>

      {patientQuery.isPending && (
        <LoadingState rows={2} variant="text" label="Loading patient" />
      )}

      {patientQuery.error && (
        <ErrorState
          error={patientQuery.error}
          onRetry={() => void patientQuery.refetch()}
        />
      )}

      {patientQuery.data && (
        <>
          <header className="mb-4">
            <h1 className="font-semibold text-2xl tracking-tight">
              {patientQuery.data.patient.name}
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {formatPatientMeta(
                patientQuery.data.patient.age,
                patientQuery.data.patient.sex,
              )}
              {patientQuery.data.patient.phone
                ? ` · ${patientQuery.data.patient.phone}`
                : null}
            </p>
          </header>

          {/*
            FIRST, above everything else including conditions. C3's done-when
            is that an allergy is impossible to miss, and position carries
            as much of that as colour does.
          */}
          <div className="mb-4">
            <AllergyBanner allergies={patientQuery.data.patient.allergies} />
          </div>

          {patientQuery.data.patient.existingConditions.length > 0 && (
            <div className="mb-8 rounded-lg border bg-card px-4 py-3">
              <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Existing conditions
              </h2>
              <p className="mt-1 text-sm">
                {patientQuery.data.patient.existingConditions.join(' · ')}
              </p>
            </div>
          )}
        </>
      )}

      <section className="mt-8">
        <h2 className="mb-3 font-medium text-sm">Consultation history</h2>

        {historyQuery.isPending && (
          <LoadingState rows={2} label="Loading consultation history" />
        )}

        {historyQuery.error && (
          <ErrorState
            error={historyQuery.error}
            onRetry={() => void historyQuery.refetch()}
          />
        )}

        {historyQuery.data && historyQuery.data.consultations.length === 0 && (
          // E28, and C3's other done-when: Kavita Rao has no history, and
          // this is what she must see instead of a blank panel.
          <EmptyState
            icon={FileTextIcon}
            title="No previous consultations"
            description="This is the patient's first recorded visit."
          />
        )}

        {historyQuery.data && historyQuery.data.consultations.length > 0 && (
          <ConsultationHistory
            entries={historyQuery.data.consultations as HistoryEntry[]}
          />
        )}
      </section>
    </main>
  )
}
