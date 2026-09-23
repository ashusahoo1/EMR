/**
 * The application header (BUILD_ROADMAP C1).
 *
 * ON THE DOCTOR NAME. There is no authentication (F21 is a stretch goal), so
 * this is the seeded doctor's name, not a signed-in identity. That is worth
 * being honest about rather than dressing up: the API has no /me endpoint
 * and no session, so fetching it would be inventing a capability the system
 * does not have. E38 is recorded as a known limitation in the README for the
 * same reason -- "state it, do not pretend it is handled".
 */
import { StethoscopeIcon } from 'lucide-react'
import Link from 'next/link'
import { HeaderSearch } from '@/components/search/header-search'

/** Matches the single seeded doctor (apps/api/src/db/seed.ts). */
const DOCTOR_NAME = 'Dr. Anjali Verma'
const DOCTOR_SPECIALTY = 'General Medicine'

export function AppHeader() {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-sm font-semibold text-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        >
          <StethoscopeIcon className="size-4 text-primary" aria-hidden="true" />
          Consultation Workspace
        </Link>

        {/*
          F17 -- search lives in the header so it is reachable from every
          screen. A doctor looking up a patient mid-consultation should not
          have to navigate away from the consultation to do it.
        */}
        <div className="ml-auto flex items-center gap-4">
          <HeaderSearch />

          <div className="hidden text-right sm:block">
            <p className="font-medium text-sm leading-tight">{DOCTOR_NAME}</p>
            <p className="text-muted-foreground text-xs leading-tight">
              {DOCTOR_SPECIALTY}
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}
