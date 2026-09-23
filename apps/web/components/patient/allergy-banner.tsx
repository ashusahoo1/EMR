/**
 * Allergy display (BUILD_ROADMAP C3, F2).
 *
 * C3's done-when: "an allergic patient's allergy is IMPOSSIBLE TO MISS."
 *
 * That phrasing sets the bar, and it is the same clinical priority driving
 * E17's survival check in stage 4 -- §4.6 calls dropping "allergic to
 * penicillin" arguably worse than inventing a blood pressure. The backend
 * spends a whole verification module making sure an allergy is not lost
 * between the notes and the structured output; losing it to quiet styling
 * on the way to the doctor's eye would waste that entirely.
 *
 * So this is not a subtle chip in a list of demographics. It is a bordered,
 * coloured, icon-led banner at the top of the profile, and it says
 * "Allergies" in words rather than relying on the colour alone.
 *
 * THE ABSENT CASE IS RENDERED TOO, and that is the less obvious half. "No
 * known allergies" and "nobody has checked" look identical if the component
 * simply returns null -- and a doctor who cannot tell which one they are
 * looking at has to go and ask. Stating the negative is what makes the
 * positive trustworthy.
 */
import { ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react'

export function AllergyBanner({ allergies }: { allergies: string[] }) {
  if (allergies.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2.5 text-muted-foreground text-sm">
        <ShieldCheckIcon className="size-4 shrink-0" aria-hidden="true" />
        <span>No known allergies</span>
      </div>
    )
  }

  return (
    <div
      className="flex items-start gap-3 rounded-lg border-2 border-destructive/40 bg-destructive/10 px-4 py-3"
      /*
        `alert` rather than a plain div: this is announced immediately when
        the profile loads, so a screen-reader user hears the allergy before
        they navigate to it rather than only if they happen to read the whole
        page top to bottom.
      */
      role="alert"
    >
      <ShieldAlertIcon
        className="mt-0.5 size-5 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <div>
        <p className="font-semibold text-destructive text-sm">
          {allergies.length === 1 ? 'Allergy' : 'Allergies'}
        </p>
        <p className="mt-0.5 font-medium text-base">
          {/*
            Joined rather than listed as chips: at a glance, "Penicillin,
            Sulfa drugs" reads as one fact about the patient. Chips invite
            the eye to treat each as a separate, smaller item.
          */}
          {allergies.join(' · ')}
        </p>
      </div>
    </div>
  )
}
