'use client'

/**
 * Tracks unsaved work across the consultation screen (C8, F16).
 *
 * TWO INDEPENDENT RISKS, and they are not equally serious:
 *
 *   1. The notes textarea. Autosaved on a debounce (C4) and flushed on
 *      unmount and tab-hide, so it is at risk only in the window between a
 *      keystroke and the save landing -- about a second.
 *   2. The structured draft. Lives purely in React state until the doctor
 *      presses Save (§4.7: AI output is never stored as final by default),
 *      so closing the tab loses EVERY correction they made. This is the
 *      real reason F16 exists.
 *
 * A context rather than prop-drilling, because the thing that needs to know
 * -- the "Back to patient" link in the page header -- is a sibling of the
 * components that generate the dirtiness, not their parent.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'

type Source = 'notes' | 'draft'

interface UnsavedWorkValue {
  isDirty: boolean
  /** Report whether a given source currently holds unsaved work. */
  setDirty: (source: Source, dirty: boolean) => void
}

const UnsavedWorkContext = createContext<UnsavedWorkValue | null>(null)

export function UnsavedWorkProvider({ children }: { children: React.ReactNode }) {
  const [dirtySources, setDirtySources] = useState<Record<Source, boolean>>({
    notes: false,
    draft: false,
  })

  const setDirty = useCallback((source: Source, dirty: boolean) => {
    setDirtySources((current) =>
      // Bail out when nothing changed. Without this, a component calling
      // setDirty on every render (which an effect-driven caller will)
      // schedules an endless re-render loop.
      current[source] === dirty ? current : { ...current, [source]: dirty },
    )
  }, [])

  const value = useMemo<UnsavedWorkValue>(
    () => ({
      isDirty: dirtySources.notes || dirtySources.draft,
      setDirty,
    }),
    [dirtySources, setDirty],
  )

  return (
    <UnsavedWorkContext.Provider value={value}>{children}</UnsavedWorkContext.Provider>
  )
}

/**
 * Read the combined dirty state.
 *
 * Returns a no-op outside the provider rather than throwing: the components
 * that report dirtiness are also rendered by C3's history view, where there
 * is nothing to guard, and a hook that crashes off its home screen is a
 * worse bargain than one that quietly does nothing.
 */
export function useUnsavedWork(): UnsavedWorkValue {
  return (
    useContext(UnsavedWorkContext) ?? {
      isDirty: false,
      setDirty: () => {},
    }
  )
}

/**
 * The combined guard: dirty state plus the handlers that act on it.
 *
 * One hook so a screen cannot accidentally wire `beforeunload` while
 * forgetting `onNavigate`, which would leave the commoner exit route -- an
 * in-app link -- unguarded.
 */
export function useConsultationGuard() {
  const { isDirty } = useUnsavedWork()
  const { onNavigate, confirmDiscard } = useUnsavedGuard(
    isDirty,
    'This consultation has unsaved changes. Leave without saving?',
  )

  return { isDirty, onNavigate, confirmDiscard }
}
