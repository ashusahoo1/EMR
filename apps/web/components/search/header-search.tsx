'use client'

/**
 * F17 -- header search (BUILD_ROADMAP C9).
 *
 * Debounced, across patients and consultations, with an empty-result state.
 *
 * WHY A POPOVER RATHER THAN A RESULTS PAGE. Search here is navigation, not
 * analysis: the doctor knows who they are looking for and wants to get to
 * them. A dedicated route would add a back-button step to every lookup for
 * no gain, and the two result counts are small enough (capped at 20
 * server-side) to show inline.
 */
import { LIMITS } from '@emr/shared'
import { useQuery } from '@tanstack/react-query'
import { FileTextIcon, Loader2Icon, SearchIcon, UserIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { ApiError, api, unwrap } from '@/lib/api'
import { formatDateShort, formatPatientMeta } from '@/lib/format'
import { useDebounced } from '@/lib/use-debounced'

export function HeaderSearch() {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const debounced = useDebounced(query.trim())

  /**
   * Below the server's minimum, do not ask.
   *
   * The API answers a one-character query with 422 QUERY_TOO_SHORT, which is
   * correct enforcement -- but showing that as an error while someone is
   * mid-word would be hostile. The gate here makes a partial query simply
   * not a query yet.
   */
  const isSearchable = debounced.length >= LIMITS.searchMinChars

  const { data, isFetching, error } = useQuery({
    queryKey: ['search', debounced],
    queryFn: async () => unwrap(await api.search.get({ query: { q: debounced } })),
    enabled: isSearchable,
    // Results for a given string do not change between keystrokes; this
    // makes backspacing through a query instant rather than re-fetching.
    staleTime: 30_000,
  })

  // Close on an outside click, the behaviour every dropdown is expected to
  // have and the one most often missing.
  useEffect(() => {
    if (!isOpen) return

    const handler = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  const patients = data?.patients ?? []
  const consultations = data?.consultations ?? []
  const hasResults = patients.length > 0 || consultations.length > 0

  // Only once the request has settled -- otherwise "no results" flashes on
  // every keystroke before the response arrives, which reads as a failure.
  const showEmpty = isSearchable && !isFetching && !error && !hasResults

  return (
    /*
      Narrower on a phone so the logo and search share the header without
      wrapping; full width from `sm` up. The results popover is anchored to
      this container, so it inherits the same behaviour.
    */
    <div ref={containerRef} className="relative w-40 sm:w-full sm:max-w-xs">
      <div className="relative">
        <SearchIcon
          className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsOpen(false)
          }}
          placeholder="Search patients or notes"
          aria-label="Search patients or notes"
          className="h-8 pl-8 text-sm"
        />
        {isFetching && (
          <Loader2Icon
            className="-translate-y-1/2 absolute top-1/2 right-2.5 size-3.5 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>

      {isOpen && isSearchable && (
        <div
          /*
            Anchored right and given its own width, because the input is
            only 160px on a phone and a result row needs more than that.
            `right-0` keeps it inside the viewport rather than overflowing
            off the edge as a left-anchored popover would.
          */
          className="absolute top-full right-0 z-50 mt-1 max-h-96 w-72 overflow-y-auto rounded-md border bg-popover shadow-md sm:left-0 sm:w-auto"
          // Announced as results arrive, without stealing focus from the
          // input the doctor is still typing in.
          role="listbox"
          aria-label="Search results"
        >
          {error && (
            <p className="px-3 py-3 text-destructive text-sm">
              {error instanceof ApiError ? error.message : 'Search failed.'}
            </p>
          )}

          {showEmpty && (
            <div className="px-3 py-4 text-center">
              <p className="text-muted-foreground text-sm">
                No patients or notes match “{debounced}”.
              </p>
            </div>
          )}

          {patients.length > 0 && (
            <Section label="Patients">
              {patients.map((patient) => (
                <ResultLink
                  key={patient.id}
                  href={`/patients/${patient.id}`}
                  onNavigate={() => setIsOpen(false)}
                  icon={<UserIcon className="size-3.5" aria-hidden="true" />}
                  title={patient.name}
                  subtitle={formatPatientMeta(patient.age, patient.sex)}
                />
              ))}
            </Section>
          )}

          {consultations.length > 0 && (
            <Section label="Consultation notes">
              {consultations.map((consultation) => (
                <ResultLink
                  key={consultation.id}
                  // To the PATIENT, not the consultation: history is where a
                  // past note is read in context, and a confirmed
                  // consultation page is a single immutable record with no
                  // surrounding information.
                  href={`/patients/${consultation.patientId}`}
                  onNavigate={() => setIsOpen(false)}
                  icon={<FileTextIcon className="size-3.5" aria-hidden="true" />}
                  title={consultation.patientName}
                  subtitle={`${formatDateShort(consultation.createdAt)} · ${consultation.excerpt}`}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b last:border-b-0">
      <p className="px-3 pt-2 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </p>
      <ul>{children}</ul>
    </div>
  )
}

function ResultLink({
  href,
  onNavigate,
  icon,
  title,
  subtitle,
}: {
  href: string
  onNavigate: () => void
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        className="flex items-start gap-2 px-3 py-2 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">{title}</span>
          <span className="block truncate text-muted-foreground text-xs">{subtitle}</span>
        </span>
      </Link>
    </li>
  )
}
