/**
 * Image header parsing -- dimensions and format, with no dependency (B1).
 *
 * Bun ships no image API (no createImageBitmap, no OffscreenCanvas), and a
 * native decoder like sharp means a binary that has to build on the deploy
 * host. For a PRECHECK we do not need pixels: we need to know the format is
 * real, how big the picture is, and whether it is obviously unusable.
 *
 * So this reads the container headers directly. Roughly 120 lines against a
 * native dependency, and it deploys anywhere Bun runs.
 *
 * It also gives us magic-byte verification for free, which is the honest
 * version of a MIME check: a .txt renamed .jpg declares image/jpeg and is
 * caught here by not starting with FFD8FF (E32).
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp'

export interface ImageInfo {
  format: ImageFormat
  width: number
  height: number
}

/** Big-endian uint16. */
function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

/** Big-endian uint32. */
function u32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  )
}

/** Little-endian uint32. */
function u32le(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset + 3] ?? 0) << 24) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 1] ?? 0) << 8) |
      (bytes[offset] ?? 0)) >>>
    0
  )
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}

/**
 * JPEG: walk the marker segments until a Start-Of-Frame carries the size.
 *
 * SOF0/1/2/3, 5-7, 9-11, 13-15 are all frame headers with height and width
 * at a fixed offset. SOF4 (0xC4) is a Huffman table and SOF8 (0xC8) is
 * reserved -- skipping those two is the classic bug here.
 */
function readJpeg(bytes: Uint8Array): ImageInfo | null {
  let offset = 2 // past FFD8

  while (offset + 3 < bytes.length) {
    // Markers are FF-prefixed; padding FFs between segments are legal.
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = bytes[offset + 1] ?? 0
    if (marker === 0xff) {
      offset += 1
      continue
    }

    // Standalone markers with no payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }

    // Start of scan -- compressed data begins, no header left to find.
    if (marker === 0xda) return null

    const length = u16be(bytes, offset + 2)
    if (length < 2) return null

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)

    if (isSof) {
      // segment: [length:2][precision:1][height:2][width:2]
      const height = u16be(bytes, offset + 5)
      const width = u16be(bytes, offset + 7)
      if (width === 0 || height === 0) return null
      return { format: 'jpeg', width, height }
    }

    offset += 2 + length
  }

  return null
}

/** PNG: IHDR is always the first chunk, at a fixed offset. */
function readPng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null
  // Bytes 12-15 must spell "IHDR", or this is not a well-formed PNG.
  const isIhdr =
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
  if (!isIhdr) return null

  const width = u32be(bytes, 16)
  const height = u32be(bytes, 20)
  if (width === 0 || height === 0) return null
  return { format: 'png', width, height }
}

/**
 * WebP: a RIFF container with three possible chunk layouts.
 *
 * VP8  -- lossy, dimensions are 14-bit after a 3-byte sync code
 * VP8L -- lossless, 14-bit width/height packed into a 32-bit little-endian
 * VP8X -- extended, 24-bit width/height minus one
 */
function readWebp(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 30) return null

  const chunk = String.fromCharCode(
    bytes[12] ?? 0,
    bytes[13] ?? 0,
    bytes[14] ?? 0,
    bytes[15] ?? 0,
  )

  if (chunk === 'VP8 ') {
    // Layout after the chunk header: [frame tag:3][sync 9d 01 2a][w:2][h:2],
    // so dimensions start at 26, not 27. Both are 14-bit little-endian with
    // the top two bits used as a scaling hint, and -- unlike VP8L and VP8X
    // -- they are NOT stored minus one.
    const syncOk = bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a
    if (!syncOk) return null

    const w = ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff
    const h = ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff
    if (w === 0 || h === 0) return null
    return { format: 'webp', width: w, height: h }
  }

  if (chunk === 'VP8L') {
    const bits = u32le(bytes, 21)
    const w = (bits & 0x3fff) + 1
    const h = ((bits >> 14) & 0x3fff) + 1
    return { format: 'webp', width: w, height: h }
  }

  if (chunk === 'VP8X') {
    const w =
      (((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16)) &
        0xffffff) +
      1
    const h =
      (((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16)) &
        0xffffff) +
      1
    return { format: 'webp', width: w, height: h }
  }

  return null
}

/**
 * Identify an image from its bytes.
 *
 * Returns null when the bytes are not a supported image OR the header is
 * truncated past recovery. The caller maps that to CORRUPT_IMAGE -- which is
 * the honest answer either way: we cannot read it, so we will not send it to
 * a model that would guess (§4.2).
 */
export function probeImage(bytes: Uint8Array): ImageInfo | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return readJpeg(bytes)

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return readPng(bytes)
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return readWebp(bytes)
  }

  return null
}

/** The MIME type the bytes actually are, regardless of what was declared. */
export function actualMimeType(bytes: Uint8Array): string | null {
  const info = probeImage(bytes)
  return info ? `image/${info.format}` : null
}
