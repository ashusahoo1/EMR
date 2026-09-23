'use client'

/**
 * Debounce a rapidly-changing value (BUILD_ROADMAP C9).
 *
 * Search fires a query per keystroke without this. "Ramesh" is six
 * requests, five of which are already obsolete when they land -- and the
 * results flicker as each one resolves out of order.
 *
 * Debouncing the VALUE rather than the request is what makes this cheap:
 * React Query keys on the debounced string, so an unchanged query is served
 * from cache and no request happens at all.
 */
import { useEffect, useState } from 'react'

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    // Cleared on every change, so only the last value in a burst survives.
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
