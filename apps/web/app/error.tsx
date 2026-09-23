'use client'

/**
 * The route-level error boundary (BUILD_ROADMAP C1).
 *
 * Catches what `<ErrorState/>` cannot: a crash during render, rather than a
 * failed request a query already holds. Without it, a thrown error in any
 * page shows Next's default overlay in development and a blank screen in
 * production -- which for a clinical tool is indistinguishable from the app
 * being gone.
 *
 * NEXT 16: the recovery prop is `retry`, NOT `reset`. It was renamed, and
 * the old name silently does nothing rather than failing to compile, so the
 * "Try again" button would simply not work. Verified against
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
 * rather than assumed.
 */
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    /**
     * In production this is where an error reporter would go. Logging it is
     * the minimum: a boundary that swallows the error entirely leaves
     * nothing to debug from, and `digest` is the only handle on a
     * server-side error whose message was stripped before it reached the
     * browser.
     */
    console.error('Unhandled error:', error)
  }, [error])

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <div className="flex flex-col items-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
        <AlertTriangleIcon className="size-8 text-destructive" aria-hidden="true" />

        <h1 className="mt-4 font-semibold text-lg">Something went wrong</h1>
        <p className="mt-2 max-w-md text-muted-foreground text-sm">
          An unexpected error stopped this page from loading. Your saved consultations are
          unaffected.
        </p>

        {/*
          The digest, and only the digest. The message may contain internals
          that A5's error contract deliberately keeps server-side (E20, E37),
          and a stack trace on screen is exactly what that rule forbids.
        */}
        {error.digest && (
          <p className="mt-3 font-mono text-muted-foreground text-xs">
            Reference: {error.digest}
          </p>
        )}

        <div className="mt-6 flex gap-2">
          <Button onClick={retry} size="sm">
            <RefreshCwIcon className="size-3.5" aria-hidden="true" />
            Try again
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/">Back to today</a>
          </Button>
        </div>
      </div>
    </main>
  )
}
