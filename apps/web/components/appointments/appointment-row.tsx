/**
 * One appointment in the day's list (BUILD_ROADMAP C2, F1).
 *
 * Time, patient, reason, status -- exactly what F1 asks for, in the order a
 * doctor scans them: when, who, why, where-are-we.
 *
 * CLICKABLE ROWS, BUILT AS A LINK. The whole card is a `next/link`, not a
 * div with an onClick. That distinction is not pedantry: an anchor is
 * focusable, reachable by keyboard, announced as a link, and opens in a new
 * tab on middle-click or ctrl-click. A clickable div has none of those and
 * has to have every one of them re-implemented badly.
 */
import type { AppointmentStatus } from '@emr/shared'
import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
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

  return (
    <li>
      <Link
        // Rows go to the PATIENT, per C2. The patient page (C3) is where
        // history lives and where a consultation is started from -- landing
        // straight in a composer would skip the context the doctor needs.
        href={`/patients/${patient.id}`}
        className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        {/*
          Tabular numerals so the times form a clean column. Without it,
          "09:00" and "11:30" are different widths and the names beside them
          do not line up.
        */}
        <time
          dateTime={appointment.scheduledAt}
          className="w-20 shrink-0 font-medium text-sm tabular-nums"
        >
          {formatTime(appointment.scheduledAt)}
        </time>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">
            {patient.name}
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

        <StatusBadge status={appointment.status as AppointmentStatus} />

        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}
