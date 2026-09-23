'use client'

/**
 * F1 -- the appointments dashboard (BUILD_ROADMAP C2).
 *
 * Today's list: time, patient, reason, status. Rows link to the patient.
 * Status filter tabs. All three states wired from the C1 components rather
 * than re-implemented here.
 *
 * THE DATE CONTROL is not decoration. C2's done-when requires that "an empty
 * date shows the empty state rather than a blank panel or an eternal
 * spinner" (E28), and the seed only creates appointments for today -- so
 * without a way to ask for a different day, the empty path is unreachable
 * and therefore untested. It is also genuinely useful: a doctor checking
 * tomorrow's list is an obvious thing to want.
 */
import { useQuery } from '@tanstack/react-query'
import { CalendarXIcon } from 'lucide-react'
import { useState } from 'react'
import {
  AppointmentRow,
  type AppointmentRowData,
} from '@/components/appointments/appointment-row'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, unwrap } from '@/lib/api'
import { clinicToday, formatDateLong } from '@/lib/format'

/** Tab values. `all` is not an AppointmentStatus, hence the widened type. */
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'in_consultation', label: 'In consultation' },
  { value: 'completed', label: 'Completed' },
] as const

type Filter = (typeof FILTERS)[number]['value']

export default function AppointmentsDashboard() {
  const [date, setDate] = useState(clinicToday)
  const [filter, setFilter] = useState<Filter>('all')

  const { data, isPending, error, refetch } = useQuery({
    // The date is part of the key, so switching days is a separate cache
    // entry rather than a refetch that discards the previous list.
    queryKey: ['appointments', date],
    queryFn: async () => unwrap(await api.appointments.get({ query: { date } })),
  })

  const appointments: AppointmentRowData[] = data?.appointments ?? []

  /**
   * Filtering happens client-side, deliberately.
   *
   * A day holds a few dozen appointments at most, they are already in
   * memory, and a round trip per tab would make the filter feel slower than
   * the list it filters. The server-side date filter earns its round trip;
   * this does not.
   */
  const visible =
    filter === 'all'
      ? appointments
      : appointments.filter((appointment) => appointment.status === filter)

  const isToday = date === clinicToday()

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            {isToday ? "Today's appointments" : 'Appointments'}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {formatDateLong(`${date}T00:00:00`)}
          </p>
        </div>

        <div>
          <label
            htmlFor="appointment-date"
            className="mb-1 block font-medium text-muted-foreground text-xs"
          >
            Date
          </label>
          <Input
            id="appointment-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-auto"
          />
        </div>
      </header>

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as Filter)}
        className="mb-4"
      >
        <TabsList>
          {FILTERS.map(({ value, label }) => (
            <TabsTrigger key={value} value={value}>
              {label}
              {/*
                The count per tab, so the doctor can see there are three
                people waiting without selecting the tab to find out.
                Suppressed while loading, when the number would be a lie.
              */}
              {!isPending && !error && (
                <span className="ml-1.5 text-muted-foreground text-xs tabular-nums">
                  {value === 'all'
                    ? appointments.length
                    : appointments.filter((a) => a.status === value).length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isPending && <LoadingState rows={4} label="Loading appointments" />}

      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {/*
        Two distinct empty cases, and conflating them would be a small lie.
        "No appointments scheduled" and "none match this filter" need
        different actions from the doctor.
      */}
      {data && appointments.length === 0 && (
        <EmptyState
          icon={CalendarXIcon}
          title={isToday ? 'No appointments today' : 'No appointments on this date'}
          description="Nothing is scheduled. Pick another date to see a different day."
        />
      )}

      {data && appointments.length > 0 && visible.length === 0 && (
        <EmptyState
          icon={CalendarXIcon}
          title="No appointments match this filter"
          description={`There are ${appointments.length} appointments today, but none are ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()}.`}
          action={{ label: 'Show all', onClick: () => setFilter('all') }}
        />
      )}

      {visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((appointment) => (
            <AppointmentRow key={appointment.id} appointment={appointment} />
          ))}
        </ul>
      )}
    </main>
  )
}
