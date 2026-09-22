/**
 * Stage 0 -- upload precheck (BUILD_ROADMAP B1, EMR_PLAN §4.2).
 *
 * Goal: reject bad input BEFORE it costs a model call.
 *
 * "A blurry photo that reaches stage 1 produces confident nonsense. A blurry
 * photo caught at stage 0 produces 'this image is too blurry to read, try
 * again in better light.' One is a bug report, the other is a good product."
 *
 * Every check here is a pure function over bytes: no network, no database, no
 * model. That makes the whole stage unit-testable in milliseconds.
 */
import { LIMITS } from '@emr/shared'
import { AppError, ErrorCode } from '../errors.ts'
import { log } from '../log.ts'
import { type ImageInfo, probeImage } from './image-probe.ts'

/**
 * Blur threshold, in JPEG bytes per pixel.
 *
 * WHAT THIS IS: with no pixel access we cannot compute a true
 * variance-of-Laplacian. JPEG compression density is a usable proxy, because
 * blurring destroys high-frequency detail and the encoder then has far less
 * to store. Measured on synthetic handwriting at 1200x900:
 *
 *   sharp text, dense      0.248
 *   sharp text, 14 lines   0.087
 *   blur sigma 4           0.041
 *   blur sigma 8           0.034
 *   blur sigma 20          0.018
 *
 * WHAT THIS IS NOT: a reliable blur detector. The ranges OVERLAP. A legible
 * two-line note measures 0.0175 -- lower than an eight-line blurred one at
 * 0.0224 -- because a sparse page genuinely contains little detail.
 *
 * So the threshold is set far below the blur band, catching only the
 * egregious case. §4.2's own reasoning applies: "a flag costs a glance, a
 * false rejection costs the feature." A doctor whose perfectly readable
 * short note is refused will stop using the feature; one whose truly
 * unreadable photo reaches stage 1 still has the [illegible] rule and the
 * stage 2 checkpoint behind them.
 *
 * Stated as a limitation in the README rather than dressed up as science.
 */
const MIN_BYTES_PER_PIXEL = 0.012

/** Below this, an image is too small to contain readable handwriting. */
const MIN_PIXELS = LIMITS.imageMinWidth * LIMITS.imageMinHeight

export interface PrecheckedImage {
  bytes: Uint8Array
  mimeType: string
  info: ImageInfo
}

/**
 * Validate an uploaded image, in cheapest-first order.
 *
 * The ordering is deliberate: size is a length check, format is a few bytes,
 * dimensions need a header walk, blur needs both. No check runs until the
 * cheaper ones have passed.
 *
 * Throws AppError with a SPECIFIC code -- never a generic failure (§4.2).
 */
export function precheckImage(input: {
  bytes: Uint8Array
  declaredType: string
}): PrecheckedImage {
  const { bytes, declaredType } = input

  // 1. Declared type. Cheapest possible rejection, and it catches the honest
  //    mistake of uploading a PDF.
  const allowed: readonly string[] = LIMITS.allowedImageTypes
  if (!allowed.includes(declaredType)) {
    throw new AppError(ErrorCode.INVALID_IMAGE_TYPE, {
      details: { received: declaredType, allowed: [...LIMITS.allowedImageTypes] },
    })
  }

  // 2. Size cap, enforced server-side independently of the client (E32).
  //    Never trust a browser to have checked.
  if (bytes.byteLength > LIMITS.imageMaxBytes) {
    throw new AppError(ErrorCode.IMAGE_TOO_LARGE, {
      details: { bytes: bytes.byteLength, limit: LIMITS.imageMaxBytes },
    })
  }

  // An empty or near-empty file cannot contain a header.
  if (bytes.byteLength < 32) {
    throw new AppError(ErrorCode.CORRUPT_IMAGE, {
      details: { bytes: bytes.byteLength },
    })
  }

  // 3. Does it actually decode? This is magic-byte verification, so a .txt
  //    renamed .jpg is caught here even though it declared image/jpeg (E32).
  const info = probeImage(bytes)
  if (!info) {
    throw new AppError(ErrorCode.CORRUPT_IMAGE, {
      details: { declaredType, bytes: bytes.byteLength },
    })
  }

  // The declared type may still disagree with reality -- a PNG renamed .jpg
  // is not corrupt, but we should believe the bytes, not the label.
  const actualType = `image/${info.format}`

  // 4. Resolution. Below this, handwriting is not recoverable and a model
  //    call would be spent producing a guess (E33).
  if (info.width * info.height < MIN_PIXELS) {
    throw new AppError(ErrorCode.IMAGE_TOO_SMALL, {
      details: {
        width: info.width,
        height: info.height,
        minimumPixels: MIN_PIXELS,
      },
    })
  }

  // 5. Blur, for JPEG only -- the proxy is compression density, and PNG is
  //    lossless so the measure means nothing there. See the note on
  //    MIN_BYTES_PER_PIXEL: conservative on purpose.
  if (info.format === 'jpeg') {
    const bytesPerPixel = bytes.byteLength / (info.width * info.height)
    if (bytesPerPixel < MIN_BYTES_PER_PIXEL) {
      log.warn('image rejected as too blurry', {
        bytesPerPixel: Number(bytesPerPixel.toFixed(4)),
        threshold: MIN_BYTES_PER_PIXEL,
        width: info.width,
        height: info.height,
      })
      throw new AppError(ErrorCode.IMAGE_TOO_BLURRY, {
        details: { width: info.width, height: info.height },
      })
    }
  }

  return { bytes, mimeType: actualType, info }
}

/** Exposed so B5 can assert the threshold without importing internals. */
export const PRECHECK_THRESHOLDS = {
  minBytesPerPixel: MIN_BYTES_PER_PIXEL,
  minPixels: MIN_PIXELS,
  maxBytes: LIMITS.imageMaxBytes,
} as const
