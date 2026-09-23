/**
 * Appointment status badge (BUILD_ROADMAP C2, F1/F14).
 *
 * Shared rather than inlined because C7 changes status from the
 * consultation view, and a doctor who sees "In consultation" in one place
 * and "in_consultation" in another loses confidence in both.
 *
 * The raw values are snake_case enum members from the API; everything here
 * is about turning them into something a clinician reads.
 */
import type { AppointmentStatus } from '@emr/shared'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Display label and colour per status.
 *
 * Colour carries meaning here, but never ALONE -- each badge also shows its
 * own text. A status distinguished only by hue is invisible to a colour-
 * blind reader, and roughly one in twelve men is.
 */
const PRESENTATION: Record<AppointmentStatus, { label: string; className: string }> = {
  waiting: {
    label: 'Waiting',
    className: 'border-amber-300 bg-amber-50 text-amber-900',
  },
  in_consultation: {
    label: 'In consultation',
    className: 'border-blue-300 bg-blue-50 text-blue-900',
  },
  completed: {
    label: 'Completed',
    // Deliberately the quietest of the three: a finished appointment is
    // the one needing least attention, so it should recede.
    className: 'border-border bg-muted text-muted-foreground',
  },
}

export function StatusBadge({
  status,
  className,
}: {
  status: AppointmentStatus
  className?: string
}) {
  const presentation = PRESENTATION[status]

  return (
    <Badge variant="outline" className={cn(presentation.className, className)}>
      {presentation.label}
    </Badge>
  )
}

/** The label alone, for filter tabs and aria text. */
export function statusLabel(status: AppointmentStatus): string {
  return PRESENTATION[status].label
}
