'use client'

/**
 * F8 -- photograph handwritten notes (BUILD_ROADMAP C5).
 *
 * Dropzone plus camera capture, client-side preparation, then the server's
 * own precheck (B1) and transcription (B2).
 *
 * THE RULE THAT DEFINES THIS COMPONENT: it never auto-triggers Generate
 * (§4.4). The transcript lands in the editable textarea and stops. Stage
 * 2's human checkpoint is the entire product thesis -- a doctor reading and
 * correcting a misread drug name before it is structured is the difference
 * between an assistant and a liability. Chaining straight into structuring
 * would remove the one step that makes the rest defensible.
 *
 * F8 is also OUR ADDITION, not in the brief (§3.5). It earns its place
 * because Indian OPD notes are written on paper, but it must not become the
 * only way in: the textarea works on its own, and this is an accelerant
 * beside it.
 */
import { useMutation } from '@tanstack/react-query'
import { CameraIcon, ImageIcon, Loader2Icon, UploadIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { ErrorState } from '@/components/states/error-state'
import { Button } from '@/components/ui/button'
import { ApiError, api, unwrap } from '@/lib/api'
import { formatBytes, ImagePrepareError, prepareImage } from '@/lib/image-prepare'

export interface TranscriptionResult {
  text: string
  hasIllegible: boolean
}

export function ImageUpload({
  onTranscribed,
  disabled = false,
}: {
  onTranscribed: (result: TranscriptionResult) => void
  disabled?: boolean
}) {
  const fileInputId = useId()
  const cameraInputId = useId()
  const [isDragging, setIsDragging] = useState(false)
  const [prepareNote, setPrepareNote] = useState<string | null>(null)

  const transcribe = useMutation({
    mutationFn: async (file: File) => {
      setPrepareNote(null)

      // Client-side courtesy check and downscale (§4.2 -- never the
      // enforcement point; the server checks again regardless).
      const prepared = await prepareImage(file)

      if (prepared.downscaled) {
        setPrepareNote(
          `Resized from ${formatBytes(prepared.originalBytes)} to ${formatBytes(prepared.file.size)} before upload.`,
        )
      }

      return unwrap(await api.transcribe.post({ image: prepared.file }))
    },
    onSuccess: (result) => {
      // Hand the text back and STOP. No structuring call here, by design.
      onTranscribed({ text: result.text, hasIllegible: result.hasIllegible })
    },
  })

  const handleFile = (file: File | undefined) => {
    if (!file || disabled) return
    transcribe.mutate(file)
  }

  const busy = transcribe.isPending

  return (
    <div className="space-y-3">
      {/*
        Drag-and-drop is a POINTER-ONLY ENHANCEMENT layered on top of the
        real controls. The labelled file inputs below carry the keyboard and
        screen-reader path, so this div needs no role of its own -- giving it
        `role="button"` would add a tab stop that does nothing when
        activated, which is worse than having none.

        `aria-hidden` is deliberately NOT set: the instructional text inside
        must stay readable.
      */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only
          enhancement; the accessible path is the labelled inputs below. */}
      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled && !busy) setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          handleFile(event.dataTransfer.files[0])
        }}
        className={`rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
          isDragging ? 'border-primary bg-accent' : 'border-border'
        } ${disabled ? 'opacity-50' : ''}`}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2Icon
              className="size-5 animate-spin text-primary"
              aria-hidden="true"
            />
            <p className="font-medium text-sm">Reading the handwriting…</p>
            <p className="text-muted-foreground text-xs">
              This usually takes a few seconds.
            </p>
          </div>
        ) : (
          <>
            <ImageIcon
              className="mx-auto size-6 text-muted-foreground/60"
              aria-hidden="true"
            />
            <p className="mt-2 font-medium text-sm">Photograph the notes</p>
            <p className="mt-0.5 text-muted-foreground text-xs">
              Drop an image here, or choose one below. JPEG, PNG or WebP.
            </p>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" asChild disabled={disabled}>
                <label htmlFor={fileInputId} className="cursor-pointer">
                  <UploadIcon className="size-3.5" aria-hidden="true" />
                  Choose image
                </label>
              </Button>

              {/*
                A SECOND input with `capture`, not a toggle on the first.
                `capture="environment"` asks a phone to open the rear camera
                directly -- the common case, since the doctor is
                photographing a page on the desk in front of them. On a
                desktop the attribute is ignored and it behaves as a normal
                file picker, so keeping both means neither device gets the
                wrong affordance.
              */}
              <Button variant="outline" size="sm" asChild disabled={disabled}>
                <label htmlFor={cameraInputId} className="cursor-pointer">
                  <CameraIcon className="size-3.5" aria-hidden="true" />
                  Take photo
                </label>
              </Button>
            </div>
          </>
        )}

        <input
          id={fileInputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => {
            handleFile(event.target.files?.[0])
            // Reset, so choosing the SAME file twice still fires onChange --
            // which a doctor retrying after a failure will absolutely do.
            event.target.value = ''
          }}
        />
        <input
          id={cameraInputId}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => {
            handleFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>

      {prepareNote && !transcribe.error && (
        <p className="text-muted-foreground text-xs">{prepareNote}</p>
      )}

      {transcribe.error && (
        <ErrorState
          error={
            // A client-side rejection is not an ApiError, but it carries the
            // same Appendix 3 code, so it is translated into one rather than
            // falling through to the generic "something went wrong".
            transcribe.error instanceof ImagePrepareError
              ? new ApiError(transcribe.error.code, transcribe.error.message, 422)
              : transcribe.error
          }
        />
      )}
    </div>
  )
}
