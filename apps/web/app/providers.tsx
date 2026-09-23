'use client'

/**
 * Client-side providers (BUILD_ROADMAP C0).
 *
 * React Query owns server state: caching, refetching, and the loading and
 * error states C1 renders. The alternative -- useEffect plus useState per
 * screen -- reimplements all of that badly and is where "spinner forever"
 * empty states (E28) come from.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  /**
   * Created in state, not at module scope.
   *
   * A module-level client is shared across every request on the server,
   * which leaks one user's cached data into another's render. `useState`
   * gives each browser session its own. This is the documented Next.js
   * pattern and the bug it prevents is genuinely hard to spot in review.
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * Clinical data changes on human timescales, not machine ones.
             * Thirty seconds stops a tab-switch from re-fetching the whole
             * appointment list while keeping "today's list" genuinely
             * today's.
             */
            staleTime: 30_000,
            /**
             * Retrying a failed request is right for a flaky network and
             * wrong for a 4xx: a 422 will fail identically three times and
             * just delays the error the doctor needs to see.
             */
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status ?? 0
              if (status >= 400 && status < 500) return false
              return failureCount < 2
            },
            refetchOnWindowFocus: false,
          },
          mutations: {
            // Never retried automatically. A retried POST is a duplicate
            // consultation (E25), and idempotency is the server's guarantee
            // to make deliberately, not something to lean on by accident.
            retry: false,
          },
        },
      }),
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
