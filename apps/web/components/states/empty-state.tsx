/**
 * Empty state (BUILD_ROADMAP C1, F12, E28).
 *
 * "Proper empty states, not blank panels or a spinner forever" (E28). The
 * distinction that matters: an empty result is a SUCCESSFUL answer, not a
 * failure. A patient with no previous consultations and a day with no
 * appointments are both normal, and rendering them as nothing at all leaves
 * the doctor unsure whether the app is broken or the list is genuinely
 * empty.
 *
 * Icon + message + optional action, per the roadmap. The action matters:
 * "no appointments today" is a dead end, while "no appointments today —
 * search for a patient" is a next step.
 */
import type { LucideIcon } from 'lucide-react'
import { InboxIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  /** One short sentence. The primary thing the doctor reads. */
  title: string
  /** Optional second line: why it is empty, or what to do about it. */
  description?: string
  icon?: LucideIcon
  action?: {
    label: string
    onClick?: (() => void) | undefined
    href?: string | undefined
  }
  className?: string
}

export function EmptyState({
  title,
  description,
  icon: Icon = InboxIcon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      {/*
        Decorative: the title already says everything the icon does, so
        announcing it would just repeat the message to a screen reader.
      */}
      <Icon className="size-8 text-muted-foreground/60" aria-hidden="true" />

      <p className="mt-4 font-medium text-sm">{title}</p>

      {description && (
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">{description}</p>
      )}

      {action && (
        <div className="mt-4">
          {action.href ? (
            <Button variant="outline" size="sm" asChild>
              <a href={action.href}>{action.label}</a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
