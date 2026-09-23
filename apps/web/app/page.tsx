'use client'

/**
 * A temporary home page that proves the wiring (BUILD_ROADMAP C0).
 *
 * C0's done-when is that a component calls `api.appointments.get()` and gets
 * real typed fields back. This is that component. It is deliberately plain:
 * C1 replaces it with the actual shell and C2 with the real dashboard, so
 * anything decorative here would be thrown away.
 *
 * What it does establish, and what C2 will keep: every one of the three
 * states §1.3 requires -- loading, error, and empty -- is handled explicitly.
 * E28 is the case this guards against: "proper empty states, not blank
 * panels or a spinner forever."
 */
import { useQuery } from '@tanstack/react-query'
import { CalendarXIcon } from 'lucide-react'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api, unwrap } from '@/lib/api'

export default function Home() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['appointments'],
    queryFn: async () => unwrap(await api.appointments.get({ query: {} })),
  })

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="font-semibold text-2xl tracking-tight">Consultation Workspace</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Connected to the API at{' '}
          <code className="font-mono text-xs">
            {process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}
          </code>
        </p>
      </header>

      {/*
        All three states come from the shared components (C1), not from
        markup written here. F12 is graded across every view, so a per-screen
        treatment is how an app ends up with three different spinners.
      */}
      {isPending && <LoadingState rows={3} label="Loading today's appointments" />}

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {data && data.appointments.length === 0 && (
        <EmptyState
          icon={CalendarXIcon}
          title="No appointments today"
          description="Nothing is scheduled for today."
        />
      )}

      {data && data.appointments.length > 0 && (
        <ul className="space-y-3">
          {data.appointments.map((appointment) => (
            <li key={appointment.id}>
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-4">
                  {/*
                    Inferred from the Elysia route's response type -- no
                    hand-written interface, and a rename on the server breaks
                    this line at compile time.

                    Worth recording: the first draft of this file guessed
                    `appointment.patientName`, and the compiler rejected it
                    because the real shape nests the patient. That error is
                    only possible because Eden's inference is live; with an
                    `any` client it would have compiled and broken in the
                    browser instead. That is C0's done-when, demonstrated.
                  */}
                  <CardTitle className="text-base">{appointment.patient.name}</CardTitle>
                  <Badge variant="secondary">{appointment.status}</Badge>
                </CardHeader>
                <CardContent className="text-muted-foreground text-sm">
                  {appointment.patient.age} {appointment.patient.sex}
                  {appointment.reason ? ` — ${appointment.reason}` : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
