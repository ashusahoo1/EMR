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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api, unwrap } from '@/lib/api'

export default function Home() {
  const { data, isPending, error } = useQuery({
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

      {isPending && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not reach the API</AlertTitle>
          <AlertDescription>
            {error.message} — is the API running on port 4000?
          </AlertDescription>
        </Alert>
      )}

      {data && data.appointments.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No appointments scheduled for today.
          </CardContent>
        </Card>
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
