/**
 * Stage 0 through the HTTP pipeline (B1).
 *
 * upload.test.ts covers the pure checks. This file proves the part of B1's
 * done-when that only an integration test can: a rejected image costs NO
 * MODEL CALL. The stub records every call it receives, so "the model was
 * never asked" is an assertion rather than a hope.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { app } from '../app.ts'
import { stubLlm } from '../llm/stub.ts'

/** A JPEG with a valid SOF0 header at the given size. */
function jpeg(width: number, height: number, totalBytes = 200_000): Uint8Array {
  const header = [
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
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
    0x08,
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

async function upload(
  content: Uint8Array,
  filename: string,
  type: string,
): Promise<{ status: number; code: string | null }> {
  const form = new FormData()
  form.append('image', new File([content], filename, { type }))
  const res = await app.handle(
    new Request('http://localhost/transcribe', { method: 'POST', body: form }),
  )
  const body = (await res.json()) as { error?: { code?: string } }
  return { status: res.status, code: body.error?.code ?? null }
}

beforeEach(() => {
  stubLlm.reset()
  process.env.LLM_ENABLED = 'true'
})

describe('B1 done-when: each bad input gets its own code, and no model call is made', () => {
  test('a text file renamed .jpg -> rejected, zero model calls', async () => {
    const { status, code } = await upload(
      new TextEncoder().encode('C/O fever x3d — not an image'),
      'notes.jpg',
      'image/jpeg',
    )

    expect(status).toBe(422)
    // Two layers reject this and both are correct. Elysia's t.File({type})
    // sniffs magic bytes at the route boundary and fires INVALID_IMAGE_TYPE
    // before the service runs; if it is ever removed, our own precheck
    // catches the same file as CORRUPT_IMAGE. Either way: 422, specific,
    // and no model call.
    expect(['INVALID_IMAGE_TYPE', 'CORRUPT_IMAGE'] as Array<string | null>).toContain(
      code,
    )
    expect(stubLlm.transcribeCalls).toHaveLength(0)
  })

  test('a 20MB image -> rejected, zero model calls', async () => {
    const huge = new Uint8Array(20 * 1024 * 1024)
    huge.set(jpeg(1200, 900, 64).slice(0, 30), 0)

    const { status, code } = await upload(huge, 'big.jpg', 'image/jpeg')

    // Elysia's own maxSize guard may fire first; either way it is a 422 and
    // no call was spent.
    expect(status).toBe(422)
    expect(['IMAGE_TOO_LARGE', 'VALIDATION_FAILED'] as Array<string | null>).toContain(
      code,
    )
    expect(stubLlm.transcribeCalls).toHaveLength(0)
  })

  test('a 100x100 image -> rejected, zero model calls', async () => {
    const { status, code } = await upload(jpeg(100, 100), 'tiny.jpg', 'image/jpeg')

    expect(status).toBe(422)
    expect(code).toBe('IMAGE_TOO_SMALL')
    expect(stubLlm.transcribeCalls).toHaveLength(0)
  })

  test('a blurry image -> rejected, zero model calls', async () => {
    const { status, code } = await upload(
      jpeg(1200, 900, 8_000),
      'blurry.jpg',
      'image/jpeg',
    )

    expect(status).toBe(422)
    expect(code).toBe('IMAGE_TOO_BLURRY')
    expect(stubLlm.transcribeCalls).toHaveLength(0)
  })

  test('a good photo DOES reach the model -- the control case', async () => {
    // Without this, every test above would pass with a broken pipeline that
    // never calls the model at all.
    const { status } = await upload(jpeg(1200, 900), 'note.jpg', 'image/jpeg')

    expect(status).toBe(200)
    expect(stubLlm.transcribeCalls).toHaveLength(1)
  })
})

describe('the precheck runs before the provider is consulted', () => {
  test('a bad image is rejected on its own merits even with AI disabled', async () => {
    // Order matters for the message the doctor sees: "that file is not an
    // image" is actionable, "AI unavailable" is misleading.
    process.env.LLM_ENABLED = 'false'

    const { status, code } = await upload(
      new TextEncoder().encode('not an image'),
      'notes.jpg',
      'image/jpeg',
    )

    expect(status).toBe(422)
    expect(['INVALID_IMAGE_TYPE', 'CORRUPT_IMAGE'] as Array<string | null>).toContain(
      code,
    )
  })

  test('a GOOD image with AI disabled reports AI_UNAVAILABLE (E23)', async () => {
    process.env.LLM_ENABLED = 'false'

    const { status, code } = await upload(jpeg(1200, 900), 'note.jpg', 'image/jpeg')

    expect(status).toBe(503)
    expect(code).toBe('AI_UNAVAILABLE')
    expect(stubLlm.transcribeCalls).toHaveLength(0)
  })
})

describe('our own precheck does not rely on the framework guard', () => {
  test('the service rejects a renamed text file on its own', async () => {
    // The integration tests above tolerate Elysia's t.File guard firing
    // first. This asserts the service would still catch it alone, so
    // removing that guard could not silently open a hole.
    const { precheckImage } = await import('../services/upload.ts')
    expect(() =>
      precheckImage({
        bytes: new TextEncoder().encode('C/O fever x3d — not an image'),
        declaredType: 'image/jpeg',
      }),
    ).toThrow()
  })
})

describe('the transcriber is told the real mime type', () => {
  test('a PNG uploaded as .jpg is passed along as image/png', async () => {
    const png = new Uint8Array(200_000)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    png.set([0x00, 0x00, 0x00, 0x0d], 8)
    png.set([0x49, 0x48, 0x44, 0x52], 12)
    png.set([0, 0, 0x04, 0xb0], 16) // 1200
    png.set([0, 0, 0x03, 0x84], 20) // 900

    const { status } = await upload(png, 'mislabelled.jpg', 'image/png')

    expect(status).toBe(200)
    expect(stubLlm.transcribeCalls[0]?.mimeType).toBe('image/png')
  })
})
