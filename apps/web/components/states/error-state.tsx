'use client'

/**
 * Error state (BUILD_ROADMAP C1, F12).
 *
 * WITH RETRY, which the roadmap specifies -- but the more important job is
 * telling the doctor WHICH failure this is. §4.11 and E21 both come down to
 * the same point: "too many requests, wait a moment", "the AI is
 * unavailable, write it yourself", and "something broke" are three different
 * situations with three different next actions, and collapsing them into one
 * red box throws away the whole failure taxonomy the API layer built.
 *
 * So this component switches on the Appendix 3 CODE, not the message string.
 * Codes are a closed set the server guarantees; messages are prose that can
 * be reworded without warning.
 */
import { AlertTriangleIcon, RefreshCwIcon, WifiOffIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface ErrorStateProps {
  error: unknown
  /** Omit to hide the retry button -- not every failure is retryable. */
  onRetry?: (() => void) | undefined
  className?: string
}

interface Presentation {
  title: string
  description: string
  /** False for failures that will fail identically on a second attempt. */
  retryable: boolean
  tone: 'destructive' | 'default'
}

/**
 * Map an Appendix 3 code to what the doctor should read and do.
 *
 * Exported so C2-C9 can reuse the wording, and so a test can assert that the
 * AI-unavailable case says "write it yourself" rather than "try again" --
 * E23 is the guardrail §4.11 calls the most important one, and it fails
 * silently if the UI tells the doctor to wait for something that is not
 * coming back.
 */
export function presentError(error: unknown): Presentation {
  const code = error instanceof ApiError ? error.code : null

  switch (code) {
    case 'AI_UNAVAILABLE':
      return {
        title: 'AI assistance is unavailable',
        // The crucial sentence in the whole component. The doctor is not
        // blocked; the accelerant is gone, not the product.
        description:
          'You can still write and save this consultation yourself — nothing is lost.',
        retryable: true,
        tone: 'default',
      }

    case 'RATE_LIMITED':
      return {
        title: 'Too many requests',
        description: 'Wait a moment and try again.',
        retryable: true,
        tone: 'default',
      }

    case 'AI_TIMEOUT':
      return {
        title: 'The AI took too long',
        description:
          'The request timed out. Try again, or write the note yourself if it keeps happening.',
        retryable: true,
        tone: 'default',
      }

    case 'AI_GENERATION_FAILED':
      return {
        title: 'The AI could not structure these notes',
        description:
          'It was tried twice. Write the note yourself — your notes are saved.',
        retryable: true,
        tone: 'default',
      }

    case 'NOT_CLINICAL_NOTES':
      return {
        title: 'That does not look like clinical notes',
        description: 'Upload a photo of handwritten notes, or type them instead.',
        retryable: false,
        tone: 'default',
      }

    case 'PATIENT_NOT_FOUND':
    case 'APPOINTMENT_NOT_FOUND':
    case 'CONSULTATION_NOT_FOUND':
    case 'NOT_FOUND':
      return {
        title: 'Not found',
        description: 'This record no longer exists, or the link is wrong.',
        // Retrying a 404 produces the same 404.
        retryable: false,
        tone: 'default',
      }

    case 'ALREADY_CONFIRMED':
      return {
        title: 'This consultation is already saved',
        description: 'Confirmed notes cannot be edited.',
        retryable: false,
        tone: 'default',
      }

    case 'VALIDATION_FAILED':
    case 'NOTES_EMPTY':
    case 'NOTES_TOO_LONG':
      return {
        title: 'That input was not accepted',
        description:
          error instanceof ApiError ? error.message : 'Check the form and try again.',
        retryable: false,
        tone: 'default',
      }

    default:
      return {
        title: 'Something went wrong',
        description:
          error instanceof ApiError
            ? error.message
            : 'Could not reach the server. Check that the API is running.',
        retryable: true,
        tone: 'destructive',
      }
  }
}

export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  const { title, description, retryable, tone } = presentError(error)

  // A network failure never reached the server, so there is no code to show.
  const isOffline = !(error instanceof ApiError)
  const Icon = isOffline ? WifiOffIcon : AlertTriangleIcon

  return (
    <Alert variant={tone} className={cn('flex flex-col gap-3', className)} role="alert">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </div>
      </div>

      {onRetry && retryable && (
        <div>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon className="size-3.5" aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}
    </Alert>
  )
}
