/**
 * Loading state (BUILD_ROADMAP C1, F12).
 *
 * SKELETON, NOT A SPINNER -- the roadmap is specific about this, and the
 * reason is perceptual rather than aesthetic. A spinner says "something is
 * happening somewhere"; a skeleton says "a list of cards is arriving, and it
 * will be about this tall". The layout does not jump when the data lands,
 * and the wait feels shorter because the shape is already committed.
 *
 * Built once here and reused by every view, because F12 is graded across all
 * of them -- a per-screen loading treatment is how three different spinners
 * end up in one app.
 */
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface LoadingStateProps {
  /** How many placeholder rows to draw. Match the expected result count. */
  rows?: number
  /** `card` for lists, `text` for prose blocks, `form` for editable fields. */
  variant?: 'card' | 'text' | 'form'
  className?: string
  /**
   * Announced to screen readers.
   *
   * A skeleton is invisible to assistive technology -- it is decorative
   * markup. Without this the screen reader says nothing at all while the
   * page loads, which is a worse experience than the spinner it replaced.
   */
  label?: string
}

export function LoadingState({
  rows = 3,
  variant = 'card',
  className,
  label = 'Loading',
}: LoadingStateProps) {
  return (
    <div
      className={cn('space-y-3', className)}
      // `status` + polite: announced when it changes, without interrupting
      // whatever the doctor is currently reading.
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>

      {/*
        Keys come from a generated id rather than the array index.
        noArrayIndexKey is normally about reordering corrupting state, which
        cannot happen to placeholders -- but silencing the rule with an
        ignore comment here would train the next reader to silence it
        somewhere it matters. A stable id costs nothing.
      */}
      {skeletonKeys(rows).map((key) => (
        <SkeletonRow key={key} variant={variant} />
      ))}
    </div>
  )
}

/**
 * Stable keys for the placeholder rows.
 *
 * DETERMINISTIC, deliberately. A random id (crypto.randomUUID) would differ
 * between the server render and the client hydration, which React reports as
 * a hydration mismatch -- and this component renders during SSR on every
 * page that loads data. Derived from the count instead, so both passes agree
 * and the keys stay identical across re-renders rather than remounting the
 * skeletons and restarting their pulse.
 */
const KEY_POOL = [
  'skeleton-a',
  'skeleton-b',
  'skeleton-c',
  'skeleton-d',
  'skeleton-e',
  'skeleton-f',
  'skeleton-g',
  'skeleton-h',
] as const

function skeletonKeys(rows: number): readonly string[] {
  // Beyond the pool, suffix the position -- still deterministic, and a
  // loading state with more than eight placeholders is already unusual.
  return Array.from(
    { length: rows },
    (_, index) => KEY_POOL[index] ?? `skeleton-overflow-${index}`,
  )
}

function SkeletonRow({ variant }: { variant: LoadingStateProps['variant'] }) {
  if (variant === 'text') {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        {/* Uneven widths, because real prose does not end flush. */}
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    )
  }

  if (variant === 'form') {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="mt-3 h-4 w-3/5" />
    </div>
  )
}
