'use client'

/**
 * The missingInformation nudge (BUILD_ROADMAP C6, §4.7).
 *
 * "A dismissible nudge above the save button -- NEVER A BLOCKER. Do not
 * prevent saving because temperature was not recorded; blocking a doctor
 * mid-clinic is how EMRs get abandoned."
 *
 * The roadmap cites the HealthPlix drug-interaction-nudge precedent, and the
 * lesson generalises: a warning a clinician cannot dismiss stops being a
 * warning and becomes an obstacle to route around. The ones that survive in
 * real practice are the ones that inform and then get out of the way.
 *
 * So this component has NO relationship with the save button. It cannot
 * disable anything, it takes no callback that could gate a submit, and
 * dismissing it changes nothing about what is saved. It is text with an X.
 *
 * Dismissal is per-mount, not persisted. A nudge the doctor dismissed on
 * Tuesday should still appear when they reopen the note on Friday -- the
 * absence it describes is still true, and quietly suppressing it forever
 * would be a decision the UI made on the doctor's behalf.
 */
import { InfoIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function MissingInfoNudge({ items }: { items: string[] }) {
  const [dismissed, setDismissed] = useState(false)

  if (items.length === 0 || dismissed) return null

  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2.5">
      <InfoIcon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">Not recorded in these notes</p>
        <ul className="mt-1 space-y-0.5 text-muted-foreground text-sm">
          {items.map((item) => (
            <li key={item}>· {item}</li>
          ))}
        </ul>
        {/*
          Said explicitly, because a doctor who has been trained by other
          software to expect a warning to block will otherwise hesitate.
        */}
        <p className="mt-1.5 text-muted-foreground text-xs">
          This does not stop you saving.
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss this note"
      >
        <XIcon className="size-4" aria-hidden="true" />
      </Button>
    </div>
  )
}
