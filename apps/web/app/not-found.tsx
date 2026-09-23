/**
 * The 404 page (BUILD_ROADMAP C1).
 *
 * Reached by an unknown URL, and by any page calling `notFound()` -- which
 * C3 and C4 do when a patient or consultation id does not exist. That second
 * path is the common one in practice: a stale link to a deleted record, or a
 * mistyped id.
 *
 * A server component. There is nothing interactive here, so shipping it as a
 * client component would send JavaScript for a static page.
 */
import { FileQuestionIcon } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
        <FileQuestionIcon
          className="size-8 text-muted-foreground/60"
          aria-hidden="true"
        />

        <h1 className="mt-4 font-semibold text-lg">Page not found</h1>
        <p className="mt-2 max-w-md text-muted-foreground text-sm">
          This record does not exist, or the link is out of date.
        </p>

        <div className="mt-6">
          {/*
            next/link, not an anchor: a client-side transition keeps the
            React Query cache warm, so returning to the dashboard does not
            re-fetch a list the browser already has.
          */}
          <Button size="sm" asChild>
            <Link href="/">Back to today</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
