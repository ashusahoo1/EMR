'use client'

/**
 * C1's done-when, made checkable (BUILD_ROADMAP C1).
 *
 * "All three render in isolation. F12 is graded across EVERY view, so build
 * them before the views, not after."
 *
 * Rendering in isolation is hard to assert in a test runner without a
 * browser, and §5.10 rules out component tests deliberately. So this is the
 * check: one route showing every state in every variant, with no data
 * dependency. If a state is broken, it is broken here first.
 *
 * It also has a life beyond C1 -- the error presentations below are the
 * exact wording a doctor sees for each failure code, which is far easier to
 * review side by side than by provoking each failure in turn.
 *
 * Not linked from anywhere in the app. Reachable at /dev/states, and worth
 * keeping: it costs one static route and documents the vocabulary every
 * other view draws from.
 */
import { CalendarXIcon, FileTextIcon, SearchXIcon } from 'lucide-react'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { ApiError } from '@/lib/api'

/** Every failure the UI is expected to distinguish (Appendix 3). */
const ERROR_CASES: Array<{ label: string; error: unknown }> = [
  {
    label: 'E23 — provider down (the guardrail §4.11 calls most important)',
    error: new ApiError('AI_UNAVAILABLE', 'AI assistance is unavailable.', 503),
  },
  {
    label: 'E21 — rate limited',
    error: new ApiError('RATE_LIMITED', 'Too many AI requests.', 429),
  },
  {
    label: 'E22 — provider timeout',
    error: new ApiError('AI_TIMEOUT', 'The AI request timed out.', 504),
  },
  {
    label: 'E19 — failed after the one retry',
    error: new ApiError('AI_GENERATION_FAILED', 'Could not structure the notes.', 502),
  },
  {
    label: 'E34 — the image is not clinical notes',
    error: new ApiError('NOT_CLINICAL_NOTES', 'Not handwritten clinical notes.', 422),
  },
  {
    label: '404 — not retryable, so no retry button',
    error: new ApiError('PATIENT_NOT_FOUND', 'No such patient.', 404),
  },
  {
    label: 'Network failure — never reached the server, so no code',
    error: new TypeError('Failed to fetch'),
  },
]

export default function StatesPreview() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-12 px-6 py-12">
      <header>
        <h1 className="font-semibold text-2xl tracking-tight">UI states</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Every state F12 is graded on, rendered in isolation. Not linked from the app.
        </p>
      </header>

      <Section title="Loading — skeleton, never a spinner">
        <Label>card (lists)</Label>
        <LoadingState rows={2} />
        <Label>text (prose)</Label>
        <LoadingState rows={1} variant="text" />
        <Label>form (editable fields)</Label>
        <LoadingState rows={2} variant="form" />
      </Section>

      <Section title="Empty — a successful answer, not a failure (E28)">
        <EmptyState
          icon={CalendarXIcon}
          title="No appointments today"
          description="Nothing is scheduled. Search for a patient to start a consultation."
          action={{ label: 'Search patients', href: '/' }}
        />
        <EmptyState
          icon={FileTextIcon}
          title="No previous consultations"
          description="This is the patient's first visit."
        />
        <EmptyState icon={SearchXIcon} title="No results" />
      </Section>

      <Section title="Error — switched on the code, not the message">
        {ERROR_CASES.map(({ label, error }) => (
          <div key={label} className="space-y-2">
            <Label>{label}</Label>
            <ErrorState error={error} onRetry={() => {}} />
          </div>
        ))}
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="border-b pb-2 font-medium text-sm">{title}</h2>
      {children}
    </section>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-muted-foreground text-xs">{children}</p>
}
