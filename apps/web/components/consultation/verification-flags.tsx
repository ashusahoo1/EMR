'use client'

/**
 * Verification flags, shown to the doctor (BUILD_ROADMAP C6, F14).
 *
 * THIS IS WHERE THE WHOLE HALLUCINATION STORY BECOMES VISIBLE. B4 spends
 * five pure modules deciding that "BP 130/80" is ungrounded; none of that
 * matters unless the doctor sees the reason in language they can act on.
 * C6: flagged items marked "unverified" WITH THE REASON SHOWN.
 *
 * The messages come from the server, already written as sentences a
 * clinician reads -- "'BP 130/80' does not appear in your notes" rather than
 * an error code. Nothing here rewrites them; the UI's job is placement and
 * emphasis, not translation.
 *
 * SEVERITY DRIVES TONE, NOT WHETHER IT IS SHOWN. Every flag is shown. A soft
 * flag is a suspicion from a word list (§4.6 is honest that negation
 * checking is not clinical NLP), so it is amber and phrased as something to
 * check. A repairable flag is a concrete mismatch, so it is red. Neither
 * blocks anything -- "flag, never silently drop" cuts both ways, and a flag
 * that prevented saving would be a blocker wearing a warning's clothes.
 */
import type { VerificationFlag, VerificationResult } from '@emr/shared'
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Flags for one item, looked up by field and array index. */
export function flagsForItem(
  verification: VerificationResult | null,
  field: string,
  index: number | null,
): VerificationFlag[] {
  if (!verification) return []
  return verification.flags.filter((flag) => flag.field === field && flag.index === index)
}

/**
 * The inline badge on a flagged item.
 *
 * Sits beside the field it concerns rather than in a list at the top,
 * because "which line is wrong" is the doctor's first question and a
 * summary makes them hunt for the answer.
 */
export function ItemFlags({ flags }: { flags: VerificationFlag[] }) {
  if (flags.length === 0) return null

  const worst = flags.some((flag) => flag.severity === 'repairable')
    ? 'repairable'
    : 'soft'

  return (
    <ul
      className={cn(
        'mt-1.5 space-y-1 rounded-md border px-2.5 py-1.5 text-xs',
        worst === 'repairable'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-amber-300 bg-amber-50 text-amber-900',
      )}
    >
      {flags.map((flag) => (
        <li key={`${flag.check}-${flag.message}`} className="flex items-start gap-1.5">
          <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{flag.message}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The header summary, above the note.
 *
 * Not a replacement for the inline badges -- it answers "is anything wrong
 * at all", which is a different question from "what is wrong here".
 *
 * A CLEAN RESULT IS ALSO REPORTED. "Every item traces back to your notes" is
 * a claim worth making explicitly: it is the visible evidence that checking
 * happened, and without it a doctor cannot distinguish "verified clean" from
 * "never checked".
 */
export function VerificationSummary({
  verification,
}: {
  verification: VerificationResult | null
}) {
  if (!verification) return null

  const itemFlags = verification.flags.filter((flag) => flag.check !== 'survival')
  const survivalFlags = verification.flags.filter((flag) => flag.check === 'survival')

  if (verification.flags.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900 text-xs">
        <CheckCircle2Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Every item traces back to your notes. Numbers, negatives and allergies all check
          out.
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div
        className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 text-xs"
        role="alert"
      >
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold">
            {itemFlags.length + survivalFlags.length}{' '}
            {itemFlags.length + survivalFlags.length === 1 ? 'item needs' : 'items need'}{' '}
            checking.
          </strong>{' '}
          They are marked below with the reason. Correct or remove anything wrong — you
          can still save either way.
        </span>
      </div>

      {/*
        SURVIVAL FLAGS ARE ABOUT SOMETHING ABSENT, so they have no item to
        attach to (E17: grounding validates what is present and can never
        catch an omission). They surface here or nowhere -- and a dropped
        allergy is the one §4.6 calls arguably worse than a fabricated BP.
      */}
      {survivalFlags.map((flag) => (
        <div
          key={flag.message}
          className="flex items-start gap-2 rounded-md border-2 border-destructive/40 bg-destructive/10 px-3 py-2 text-xs"
          role="alert"
        >
          <AlertTriangleIcon
            className="mt-0.5 size-3.5 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <span className="font-medium">{flag.message}</span>
        </div>
      ))}
    </div>
  )
}
