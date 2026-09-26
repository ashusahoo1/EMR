'use client'

/**
 * A click handler that cannot fire twice concurrently (E24, E25).
 *
 * THE BUG THIS FIXES was found by Playwright, not by hand. Every action
 * button gated itself on `mutation.isPending`, and a human clicking twice
 * always "passed" -- but `isPending` only becomes true after React RE-RENDERS
 * the disabled attribute, and a real double-click delivers both events in
 * the same tick, before that render. A `dblclick` in a real browser sent
 * TWO requests to /structure: two model calls, two audit rows, two answers
 * racing to overwrite each other's aiNote. Exactly the failure E24 describes.
 *
 * `disabled` is still worth keeping for the visual state and for assistive
 * technology; it just cannot be the guard. This is the guard. The ref latches
 * SYNCHRONOUSLY in the first handler, so the second event -- even in the same
 * event loop turn -- is dropped before any state or network is touched.
 *
 * Shared, because Generate, Save and Start consultation all had the same
 * hole, and three copies of a guard drift apart the first time one is edited.
 */
import { useCallback, useRef } from 'react'

export function useSingleFlight<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown> | unknown,
): (...args: Args) => void {
  const inFlight = useRef(false)

  return useCallback(
    (...args: Args) => {
      if (inFlight.current) return
      inFlight.current = true

      // Release on settle, success or failure alike. An unreleased latch
      // after an error would leave the button permanently dead.
      Promise.resolve()
        .then(() => action(...args))
        .finally(() => {
          inFlight.current = false
        })
    },
    [action],
  )
}
