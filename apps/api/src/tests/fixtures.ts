/**
 * Shared test fixtures.
 *
 * The image builders live here because B1's precheck made every test that
 * uploads a picture care about real headers and plausible dimensions. A
 * ten-byte "JPEG" is now correctly rejected, which is the point -- but it
 * means fixtures belong in one place rather than copied per file.
 */

/**
 * A JPEG with a genuine SOF0 header at the given dimensions.
 *
 * Padded to `totalBytes` so the blur heuristic (bytes per pixel) sees a
 * plausible density. The default comfortably clears the threshold.
 */
export function fakeJpeg(width = 1200, height = 900, totalBytes = 200_000): Uint8Array {
  const header = [
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10, // APP0
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
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
    0x08, // SOF0
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
  ]
  const bytes = new Uint8Array(Math.max(totalBytes, header.length))
  bytes.set(header, 0)
  for (let i = header.length; i < bytes.length; i += 1) bytes[i] = (i * 31) % 251
  return bytes
}

/** A PNG with a genuine IHDR at the given dimensions. */
export function fakePng(width = 1200, height = 900, totalBytes = 200_000): Uint8Array {
  const bytes = new Uint8Array(Math.max(totalBytes, 32))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
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

/** A multipart body carrying one image, as the transcribe route expects. */
export function imageForm(
  bytes: Uint8Array = fakeJpeg(),
  filename = 'note.jpg',
  type = 'image/jpeg',
): FormData {
  const form = new FormData()
  form.append('image', new File([bytes], filename, { type }))
  return form
}
