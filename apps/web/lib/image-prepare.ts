'use client'

/**
 * Client-side image checks and downscaling (BUILD_ROADMAP C5).
 *
 * "Client-side type/size check and downscale before upload -- then the
 * server checks again independently."
 *
 * THE SECOND HALF OF THAT SENTENCE IS THE POINT. Everything here is a
 * COURTESY, never enforcement. §4.2 is explicit: never trust the client. A
 * doctor whose 12MB photo is rejected after a 30-second upload on clinic
 * wifi has wasted 30 seconds to learn something we knew instantly -- that is
 * what this prevents. B1's precheck still runs server-side on every byte,
 * and it is the only check that actually decides anything.
 *
 * WHY DOWNSCALE AT ALL. A modern phone photo is 4000x3000 and 4-8MB. The
 * vision model does not read it at that resolution -- it is tiled and
 * downsampled anyway -- so the extra pixels buy nothing and cost upload time
 * on exactly the connection least able to afford it. 2000px on the long edge
 * keeps handwriting legible (B1's floor is 600px) while cutting a typical
 * photo to well under a megabyte.
 */
import { LIMITS } from '@emr/shared'

/** Long-edge target. Comfortably above B1's 600px minimum. */
const MAX_EDGE = 2_000

/** JPEG quality for the re-encode. 0.85 is visually lossless for text. */
const QUALITY = 0.85

export interface PreparedImage {
  file: File
  /** True when the image was re-encoded, for the size hint in the UI. */
  downscaled: boolean
  originalBytes: number
}

export class ImagePrepareError extends Error {
  /** Mirrors the API's Appendix 3 codes so the UI has one vocabulary. */
  readonly code: 'INVALID_IMAGE_TYPE' | 'IMAGE_TOO_LARGE' | 'CORRUPT_IMAGE'

  constructor(code: ImagePrepareError['code'], message: string) {
    super(message)
    this.name = 'ImagePrepareError'
    this.code = code
  }
}

/**
 * Validate and, where useful, shrink an image before upload.
 *
 * Throws `ImagePrepareError` for problems worth catching early. Anything
 * subtler -- a renamed text file, a blurry page, a photo of a cat -- is left
 * to the server, which is better equipped and is the authority regardless.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  // Cheapest check first, same ordering as B1's precheck.
  if (!LIMITS.allowedImageTypes.includes(file.type as never)) {
    throw new ImagePrepareError('INVALID_IMAGE_TYPE', 'Choose a JPEG, PNG or WebP image.')
  }

  /**
   * A generous pre-decode ceiling, deliberately looser than the API's.
   *
   * The server cap is on what it RECEIVES, and downscaling below usually
   * brings an oversized photo under it. Rejecting at the API's limit here
   * would refuse pictures we could have fixed. This bound only stops us
   * trying to decode something absurd.
   */
  if (file.size > LIMITS.imageMaxBytes * 4) {
    throw new ImagePrepareError(
      'IMAGE_TOO_LARGE',
      'That image is very large. Try a photo taken at a lower resolution.',
    )
  }

  const bitmap = await decode(file)

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height)

    // Already small enough, and within the server's byte cap: send as-is
    // rather than re-encoding, which would only lose quality.
    if (longEdge <= MAX_EDGE && file.size <= LIMITS.imageMaxBytes) {
      return { file, downscaled: false, originalBytes: file.size }
    }

    const scale = Math.min(1, MAX_EDGE / longEdge)
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const blob = await toJpeg(bitmap, width, height)

    return {
      file: new File([blob], renameToJpeg(file.name), { type: 'image/jpeg' }),
      downscaled: true,
      originalBytes: file.size,
    }
  } finally {
    // Frees the decoded pixels immediately rather than waiting for GC --
    // a 4000x3000 bitmap is ~48MB, and a doctor may try several photos.
    bitmap.close()
  }
}

/** Decode to a bitmap, translating a failure into our own vocabulary. */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    throw new ImagePrepareError(
      'CORRUPT_IMAGE',
      'That file could not be opened as an image.',
    )
  }
}

/** Re-encode a bitmap at the given size. */
async function toJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new ImagePrepareError('CORRUPT_IMAGE', 'Could not process that image.')
  }

  // Bilinear smoothing on the way down; without it, downscaled handwriting
  // aliases into exactly the broken strokes B1's blur check exists to catch.
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new ImagePrepareError('CORRUPT_IMAGE', 'Could not process that image.'),
            ),
      'image/jpeg',
      QUALITY,
    )
  })
}

/** A re-encoded PNG is no longer a .png; say so in the filename. */
function renameToJpeg(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.jpg`
}

/** "2.4 MB" -- for the size hint after downscaling. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
