/**
 * Highlight `[illegible]` markers in a transcript (BUILD_ROADMAP C5).
 *
 * C5's done-when: "`[illegible]` is visually obvious."
 *
 * THIS IS THE PAYOFF FOR B2's HARDEST PROMPT RULE. §4.3 calls the illegible
 * marker the single most important instruction in the transcription prompt,
 * because a fabricated drug name is invisible to every downstream check --
 * by the time stage 4 runs, the fabrication IS the source text. The model
 * writing `[illegible]` instead of guessing "amoxicillin" only helps if the
 * doctor's eye actually lands on it.
 *
 * So the marker is rendered as a warning-coloured chip rather than as plain
 * text. A doctor skimming a transcript to check it reads the shape of the
 * page, not every word, and `[illegible]` in body text is easy to skim past
 * at exactly the moment it matters most.
 */
import { ILLEGIBLE_MARKER } from '@emr/shared'

export function IllegibleHighlight({ text }: { text: string }) {
  const parts = text.split(ILLEGIBLE_MARKER)

  // No markers: render unchanged rather than wrapping every transcript in
  // machinery it does not need.
  if (parts.length === 1) {
    return <>{text}</>
  }

  return (
    <>
      {parts.map((part, index) => (
        // The key is positional because these are slices of one string --
        // the pieces cannot reorder, and duplicate text is expected.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional by nature
        <span key={`part-${index}`}>
          {part}
          {index < parts.length - 1 && (
            <mark
              className="rounded bg-amber-200 px-1 py-0.5 font-medium text-amber-950 text-xs"
              /*
                `<mark>` is the correct element and carries the meaning to a
                screen reader, which would otherwise read "[illegible]" as
                ordinary words with no indication of emphasis.
              */
              title="The model could not read this word"
            >
              {ILLEGIBLE_MARKER}
            </mark>
          )}
        </span>
      ))}
    </>
  )
}

/** How many markers a transcript contains. Drives the warning banner. */
export function countIllegible(text: string): number {
  return text.split(ILLEGIBLE_MARKER).length - 1
}
