/**
 * One appointment in the day's list (BUILD_ROADMAP C2, F1).
 *
 * Time, patient, reason, status -- exactly what F1 asks for, in the order a
 * doctor scans them: when, who, why, where-are-we.
 *
 * CLICKABLE ROWS, BUILT AS A LINK. The patient name is a `next/link`, not a
 * div with an onClick. That distinction is not pedantry: an anchor is
 * focusable, reachable by keyboard, announced as a link, and opens in a new
 * tab on middle-click or ctrl-click. A clickable div has none of those and
 * has to have every one of them re-implemented badly.
 *
 * TWO ACTIONS PER ROW, so the link cannot wrap the whole card: going to the
 * patient, and starting the consultation. A button nested inside an anchor
 * is invalid HTML and behaves unpredictably -- the click target is
 * ambiguous and keyboard users get one tab stop where they need two. The
 * link is stretched over the row's empty space with a pseudo-element
 * instead, which keeps the large click target without the nesting.
 */
import type { AppointmentStatus } from '@emr/shared'
import Link from 'next/link'
import { StartConsultationButton } from '@/components/appointments/start-consultation-button'
import { StatusBadge } from '@/components/appointments/status-badge'
import { formatPatientMeta, formatTime } from '@/lib/format'

export interface AppointmentRowData {
  id: string
  scheduledAt: string
  reason: string | null
  status: string
  patient: { id: string; name: string; age: number; sex: string }
  consultationId: string | null
}

export function AppointmentRow({ appointment }: { appointment: AppointmentRowData }) {
  const { patient } = appointment

  /*
    RESPONSIVE (C10). Four items on one line -- time, name, status, action
    -- need about 500px to breathe, and a 375px phone has 327px after the
    page gutter. Below `sm` the row becomes a two-line stack with the action
    full width; from `sm` up it is the single scannable line a desktop list
    wants.
  */
  return (
    <li className="relative flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
        {/*
          Tabular numerals so the times form a clean column. Without it,
          "09:00" and "11:30" are different widths and the names beside them
          do not line up.
        */}
        <time
          dateTime={appointment.scheduledAt}
          className="w-16 shrink-0 font-medium text-sm tabular-nums sm:w-20"
        >
          {formatTime(appointment.scheduledAt)}
        </time>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">
            {/*
              `after:absolute after:inset-0` stretches this link across the
              row, so the whole card is clickable while the markup stays a
              single anchor around the name. The consultation button sits
              above it via `relative`, keeping its own click target.
            */}
            <Link
              href={`/patients/${patient.id}`}
              className="rounded-sm after:absolute after:inset-0 focus-visible:outline-none"
            >
              {patient.name}
            </Link>
            <span className="ml-2 font-normal text-muted-foreground">
              {formatPatientMeta(patient.age, patient.sex)}
            </span>
          </p>
          {/*
            `reason` is nullable in the contract. Rendering the raw null
            would print nothing and leave the row looking broken, so the
            absence is stated.
          */}
          <p className="truncate text-muted-foreground text-sm">
            {appointment.reason ?? 'No reason recorded'}
          </p>
        </div>

        <StatusBadge
          status={appointment.status as AppointmentStatus}
          className="shrink-0"
        />
      </div>

      {/*
        Full width on a phone, auto beside the row on a desktop. A 44px-tall
        full-width target is the one most reliably hit with a thumb.
      */}
      <div className="relative shrink-0">
        <StartConsultationButton
          appointmentId={appointment.id}
          consultationId={appointment.consultationId}
          className="w-full sm:w-auto"
        />
      </div>
    </li>
  )
}
