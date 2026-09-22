/**
 * Stage 0 precheck (BUILD_ROADMAP B1).
 *
 * Pure functions over bytes -- no network, no database, no model. The
 * fixtures are built here rather than committed, so the suite stays
 * self-contained.
 */
import { describe, expect, test } from 'bun:test'
import { LIMITS } from '@emr/shared'
import { AppError, type ErrorCode } from '../errors.ts'
import { actualMimeType, probeImage } from './image-probe.ts'
import { PRECHECK_THRESHOLDS, precheckImage } from './upload.ts'

// --- Fixture builders ------------------------------------------------------
// Minimal but REAL headers: the parser reads them the same way it reads a
// photograph from a phone.

/** A JPEG whose SOF0 declares the given dimensions, padded to a byte length. */
function jpeg(width: number, height: number, totalBytes = 200_000): Uint8Array {
  const header = [
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10, // APP0, length 16
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // "JFIF\0"
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, length 17, precision 8
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03, // components
  ]
  const bytes = new Uint8Array(Math.max(totalBytes, header.length))
  bytes.set(header, 0)
  // Fill the rest with varied bytes so it is not trivially compressible --
  // irrelevant to the parser, but keeps the fixture honest.
  for (let i = header.length; i < bytes.length; i += 1) bytes[i] = (i * 31) % 251
  return bytes
}

/** A PNG whose IHDR declares the given dimensions. */
function png(width: number, height: number, totalBytes = 200_000): Uint8Array {
  const bytes = new Uint8Array(Math.max(totalBytes, 32))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8) // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // "IHDR"
  bytes.set(
    [(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff],
    16,
  )
  bytes.set(
    [
      (height >>> 24) & 0xff,
      (height >>> 16) & 0xff,
      (height >>> 8) & 0xff,
      height & 0xff,
    ],
    20,
  )
  return bytes
}

/** A lossy WebP (VP8) whose frame header declares the given dimensions. */
function webp(width: number, height: number, totalBytes = 200_000): Uint8Array {
  const bytes = new Uint8Array(Math.max(totalBytes, 64))
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x20], 12) // "VP8 "
  bytes.set([0x9d, 0x01, 0x2a], 23) // sync code
  bytes.set([width & 0xff, (width >> 8) & 0x3f], 26)
  bytes.set([height & 0xff, (height >> 8) & 0x3f], 28)
  return bytes
}

const A4_PHOTO = { width: 1200, height: 900 }

/** Assert the precheck rejects with one specific Appendix 3 code. */
function expectCode(run: () => unknown, code: ErrorCode): void {
  try {
    run()
    throw new Error(`expected ${code} but nothing was thrown`)
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
  }
}

describe('image-probe reads real container headers', () => {
  test('JPEG dimensions come from SOF0', () => {
    expect(probeImage(jpeg(1200, 900))).toEqual({
      format: 'jpeg',
      width: 1200,
      height: 900,
    })
  })

  test('PNG dimensions come from IHDR', () => {
    expect(probeImage(png(800, 600))).toEqual({ format: 'png', width: 800, height: 600 })
  })

  test('WebP (VP8) dimensions come from the frame header', () => {
    // Verified against sharp-encoded WebP during B1: the dimensions start at
    // byte 26, not 27. The off-by-one read 640x480 as 8194x15873, which would
    // have rejected every WebP upload as absurdly oversized.
    expect(probeImage(webp(640, 480))).toEqual({
      format: 'webp',
      width: 640,
      height: 480,
    })
  })

  test('a large phone photo parses correctly', () => {
    expect(probeImage(jpeg(4032, 3024))).toEqual({
      format: 'jpeg',
      width: 4032,
      height: 3024,
    })
  })

  test('non-image bytes return null rather than guessing', () => {
    expect(probeImage(new TextEncoder().encode('this is not an image'))).toBeNull()
    expect(probeImage(new Uint8Array(100))).toBeNull()
    expect(probeImage(new Uint8Array())).toBeNull()
  })

  test('actualMimeType believes the bytes, not the filename', () => {
    expect(actualMimeType(jpeg(800, 600))).toBe('image/jpeg')
    expect(actualMimeType(png(800, 600))).toBe('image/png')
    expect(actualMimeType(new TextEncoder().encode('nope'))).toBeNull()
  })
})

describe('precheck accepts good input', () => {
  test('a normal photo of a note passes', () => {
    const result = precheckImage({
      bytes: jpeg(A4_PHOTO.width, A4_PHOTO.height),
      declaredType: 'image/jpeg',
    })
    expect(result.info.width).toBe(A4_PHOTO.width)
    expect(result.mimeType).toBe('image/jpeg')
  })

  test('PNG is accepted and skips the blur check (lossless)', () => {
    // A PNG's byte count says nothing about focus, so applying the JPEG
    // density heuristic to it would reject valid screenshots and scans.
    const result = precheckImage({
      bytes: png(1200, 900, 40_000),
      declaredType: 'image/png',
    })
    expect(result.mimeType).toBe('image/png')
  })

  test('WebP is accepted', () => {
    const result = precheckImage({
      bytes: webp(1200, 900),
      declaredType: 'image/webp',
    })
    expect(result.mimeType).toBe('image/webp')
  })

  test('the returned mime type is the real one, not the declared one', () => {
    // A PNG uploaded as .jpg is not corrupt -- believe the bytes.
    const result = precheckImage({
      bytes: png(1200, 900),
      declaredType: 'image/jpeg',
    })
    expect(result.mimeType).toBe('image/png')
  })
})

describe('E32 — bad files are rejected with a specific code', () => {
  test('INVALID_IMAGE_TYPE: an unsupported declared type', () => {
    expectCode(
      () => precheckImage({ bytes: jpeg(1200, 900), declaredType: 'application/pdf' }),
      'INVALID_IMAGE_TYPE',
    )
  })

  test('CORRUPT_IMAGE: a text file renamed .jpg', () => {
    // Declares image/jpeg and is not one. Magic bytes catch it.
    expectCode(
      () =>
        precheckImage({
          bytes: new TextEncoder().encode('C/O fever x3d — this is a text file'),
          declaredType: 'image/jpeg',
        }),
      'CORRUPT_IMAGE',
    )
  })

  test('CORRUPT_IMAGE: a truncated header', () => {
    expectCode(
      () =>
        precheckImage({
          bytes: new Uint8Array([0xff, 0xd8, 0xff]),
          declaredType: 'image/jpeg',
        }),
      'CORRUPT_IMAGE',
    )
  })

  test('CORRUPT_IMAGE: an empty file', () => {
    expectCode(
      () => precheckImage({ bytes: new Uint8Array(), declaredType: 'image/jpeg' }),
      'CORRUPT_IMAGE',
    )
  })

  test('IMAGE_TOO_LARGE: a 20MB upload', () => {
    const huge = new Uint8Array(20 * 1024 * 1024)
    huge.set(jpeg(1200, 900, 64).slice(0, 64), 0)
    expectCode(
      () => precheckImage({ bytes: huge, declaredType: 'image/jpeg' }),
      'IMAGE_TOO_LARGE',
    )
  })

  test('the size cap is enforced server-side regardless of the client', () => {
    expect(PRECHECK_THRESHOLDS.maxBytes).toBe(LIMITS.imageMaxBytes)
  })
})

describe('E33 — unreadable photos are rejected before a model call', () => {
  test('IMAGE_TOO_SMALL: a 100x100 thumbnail', () => {
    expectCode(
      () => precheckImage({ bytes: jpeg(100, 100), declaredType: 'image/jpeg' }),
      'IMAGE_TOO_SMALL',
    )
  })

  test('IMAGE_TOO_SMALL is measured in total pixels, not either side alone', () => {
    // A wide but very short strip has enough width and still cannot hold a
    // page of handwriting.
    expectCode(
      () => precheckImage({ bytes: jpeg(2000, 80), declaredType: 'image/jpeg' }),
      'IMAGE_TOO_SMALL',
    )
  })

  test('IMAGE_TOO_BLURRY: a JPEG with almost no encoded detail', () => {
    // 1200x900 in 8KB is ~0.007 bytes/px, well under the threshold.
    expectCode(
      () => precheckImage({ bytes: jpeg(1200, 900, 8_000), declaredType: 'image/jpeg' }),
      'IMAGE_TOO_BLURRY',
    )
  })

  test('a sparse but legible note is NOT rejected as blurry', () => {
    // The threshold is deliberately conservative. §4.2: a flag costs a
    // glance, a false rejection costs the feature -- a doctor whose readable
    // two-line note is refused stops using the feature.
    const sparse = jpeg(1200, 900, Math.ceil(1200 * 900 * 0.02))
    expect(() =>
      precheckImage({ bytes: sparse, declaredType: 'image/jpeg' }),
    ).not.toThrow()
  })

  test('the blur threshold sits below the measured blur band', () => {
    // Measured during B1 on synthetic handwriting: blur sigma 8 lands around
    // 0.034 bytes/px, sigma 20 around 0.018. The threshold is below both on
    // purpose -- it catches only the egregious case.
    expect(PRECHECK_THRESHOLDS.minBytesPerPixel).toBeLessThan(0.018)
  })
})

describe('check ordering is cheapest-first', () => {
  test('an oversized file with a bad type fails on type, not size', () => {
    // Type is a string comparison; size is a length check; both beat parsing.
    const huge = new Uint8Array(20 * 1024 * 1024)
    expectCode(
      () => precheckImage({ bytes: huge, declaredType: 'text/plain' }),
      'INVALID_IMAGE_TYPE',
    )
  })

  test('a tiny corrupt file fails on decode, not on dimensions', () => {
    expectCode(
      () => precheckImage({ bytes: new Uint8Array(64), declaredType: 'image/jpeg' }),
      'CORRUPT_IMAGE',
    )
  })
})
