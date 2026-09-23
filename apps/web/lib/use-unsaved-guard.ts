'use client'

/**
 * Unsaved-work protection (BUILD_ROADMAP C8, F16, E26).
 *
 * "Prevents accidental loss of notes or an unsaved draft on navigate-away."
 *
 * TWO MECHANISMS, because one exit route each:
 *
 *   beforeunload  -- closing the tab, reloading, or typing a new URL. The
 *                    browser owns this dialog; we can only ask for it.
 *   onNavigate    -- clicking a <Link> inside the app. Next 16 gives Link an
 *                    `onNavigate` handler with preventDefault(), so a
 *                    client-side transition can be cancelled.
 *
 * Neither covers the other. `beforeunload` never fires on an App Router
 * transition (no document unload happens), and `onNavigate` cannot see a tab
 * close. Shipping only one leaves half the ways out unguarded -- and the
 * half people usually forget is the in-app one, which is also the commoner
 * accident.
 *
 * WHAT THIS DELIBERATELY DOES NOT GUARD. The browser back button: the App
 * Router gives no supported interception point, and the popular workaround
 * (pushing a decoy history entry) corrupts the back stack in ways that are
 * worse than the problem. Stated as a known limitation rather than
 * half-solved -- the same posture as E38 in the README.
 *
 * Ctrl/Cmd-click is also unguarded, and that is CORRECT: it opens a new tab
 * and leaves the current page, with its unsaved work, exactly where it was.
 */
import { useCallback, useEffect } from 'react'

export interface UnsavedGuard {
  /**
   * Attach to a `<Link onNavigate={...}>` to intercept in-app navigation.
   *
   * Returns nothing; calls `preventDefault()` on the event when the doctor
   * declines to discard.
   */
  onNavigate: (event: { preventDefault: () => void }) => void
  /** Ask directly, for a programmatic router.push. */
  confirmDiscard: () => boolean
}

export function useUnsavedGuard(
  isDirty: boolean,
  message = 'You have unsaved changes. Leave without saving?',
): UnsavedGuard {
  /**
   * The tab-close path.
   *
   * The browser ignores our message and shows its own generic wording --
   * has done for a decade, to stop pages holding users hostage with
   * scare text. `preventDefault()` plus a truthy `returnValue` is the
   * incantation that still works across engines.
   */
  useEffect(() => {
    if (!isDirty) return

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy, but Chrome still wants it set to trigger the prompt.
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
    // Re-registered whenever dirtiness changes, so a saved form stops
    // prompting immediately rather than at the next mount.
  }, [isDirty])

  const confirmDiscard = useCallback(() => {
    if (!isDirty) return true
    // `confirm` rather than a custom dialog: this must work synchronously
    // inside the click handler to cancel the navigation, and an async modal
    // cannot -- the transition would have already started.
    return window.confirm(message)
  }, [isDirty, message])

  const onNavigate = useCallback(
    (event: { preventDefault: () => void }) => {
      if (!confirmDiscard()) event.preventDefault()
    },
    [confirmDiscard],
  )

  return { onNavigate, confirmDiscard }
}
