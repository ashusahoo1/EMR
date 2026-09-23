'use client'

/**
 * Debounced autosave (BUILD_ROADMAP C4).
 *
 * C4's done-when: "typing and refreshing preserves the draft". The draft
 * lives on the SERVER, not in localStorage -- a consultation the doctor
 * opens on a different machine, or after a browser crash, has to still be
 * there, and §4.8's audit chain starts from the stored rawNotes.
 *
 * THE FOUR THINGS A NAIVE DEBOUNCE GETS WRONG, each of which loses data:
 *
 *   1. Unmount. Navigating away inside the debounce window drops the last
 *      keystrokes silently. Flushed on cleanup.
 *   2. Tab close. Same problem, no React lifecycle at all. Flushed on
 *      `visibilitychange`, which fires on mobile backgrounding too --
 *      unlike `beforeunload`, which phones frequently skip.
 *   3. Overlapping saves. A slow request plus fast typing means two in
 *      flight, and the OLDER one can land last and overwrite newer text.
 *      Serialised, with the latest value always winning.
 *   4. Saving what was just loaded. Firing on mount writes the server's own
 *      value back to it, which marks a clean draft dirty and burns a
 *      request. Skipped until the value actually changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface UseAutosaveOptions<T> {
  value: T
  /** Must be stable, or the effect re-runs on every render. */
  onSave: (value: T) => Promise<void>
  delayMs?: number
  /** Suppresses saving entirely -- e.g. a confirmed, immutable note. */
  enabled?: boolean
}

export interface UseAutosaveResult {
  status: SaveStatus
  /** Save immediately, bypassing the debounce. For an explicit Save action. */
  flush: () => Promise<void>
}

export function useAutosave<T>({
  value,
  onSave,
  delayMs = 1_000,
  enabled = true,
}: UseAutosaveOptions<T>): UseAutosaveResult {
  const [status, setStatus] = useState<SaveStatus>('idle')

  /** Latest value, readable from callbacks without re-subscribing them. */
  const valueRef = useRef(value)
  valueRef.current = value

  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  /** The last value successfully written, so we never save it twice. */
  const savedRef = useRef<T>(value)

  /** Guards against overlapping requests (problem 3). */
  const inFlightRef = useRef(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback(async (): Promise<void> => {
    const pending = valueRef.current

    // Nothing changed since the last successful write.
    if (Object.is(pending, savedRef.current)) return

    // A save is already running. It will re-check on completion and pick up
    // whatever the value is by then, so dropping this call loses nothing.
    if (inFlightRef.current) return

    inFlightRef.current = true
    setStatus('saving')

    try {
      await onSaveRef.current(pending)
      savedRef.current = pending
      // Only report "saved" if nothing was typed while the request was in
      // flight; otherwise the next pass will say so.
      setStatus(Object.is(valueRef.current, pending) ? 'saved' : 'pending')
    } catch {
      // Deliberately does NOT advance savedRef, so the next attempt retries
      // the same content rather than treating it as written.
      setStatus('error')
    } finally {
      inFlightRef.current = false

      // Typing continued during the request -- go again with the newer text.
      if (!Object.is(valueRef.current, savedRef.current)) {
        void save()
      }
    }
  }, [])

  // The debounce itself.
  useEffect(() => {
    if (!enabled) return
    if (Object.is(value, savedRef.current)) return // problem 4

    setStatus('pending')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void save(), delayMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, delayMs, enabled, save])

  // Problem 1 -- flush on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      void save()
    }
  }, [save])

  // Problem 2 -- flush when the tab is hidden or closed.
  useEffect(() => {
    if (!enabled) return

    const flushIfHidden = () => {
      if (document.visibilityState === 'hidden') void save()
    }

    document.addEventListener('visibilitychange', flushIfHidden)
    return () => document.removeEventListener('visibilitychange', flushIfHidden)
  }, [enabled, save])

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    await save()
  }, [save])

  return { status, flush }
}
