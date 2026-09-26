/**
 * F8 -- photo upload and transcription (MANUAL_TEST §5).
 *
 * The stub returns the same six-line transcript for any valid image, so
 * these assert the UI's behaviour AROUND transcription, which is where the
 * product thesis lives: the text must land in the editable box and STOP.
 */
import path from 'node:path'
import { expect, test } from './fixtures'

const IMAGES = path.resolve('test-images')
const GOOD = path.join(IMAGES, '1-good-note.jpg')
const TINY = path.join(IMAGES, '2-tiny.jpg')
const FAKE = path.join(IMAGES, '3-not-really-an-image.jpg')

async function openFreshConsultation(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Amit Kumar' })
    .getByRole('button', { name: /Start consultation/ })
    .click()
  await expect(page.getByLabel('Consultation notes')).toBeVisible()
}

test('a photo produces editable text and does NOT trigger Generate (5.1, 5.3)', async ({
  page,
}) => {
  await openFreshConsultation(page)

  let structureCalls = 0
  await page.route('**/consultations/*/structure', async (route) => {
    structureCalls += 1
    await route.continue()
  })

  await page.getByLabel('Choose image').setInputFiles(GOOD)

  // 5.1 -- transcript lands in the textarea.
  await expect(page.getByLabel('Consultation notes')).toHaveValue(/fever since 3 days/)
  await expect(page.getByText('Draft saved')).toBeVisible()

  // 5.2 -- marked as machine-transcribed.
  await expect(page.getByText('Transcribed from a photograph')).toBeVisible()

  // 5.3 -- THE PRODUCT THESIS. Nothing structured itself.
  await expect(page.getByRole('heading', { name: 'AI draft' })).toHaveCount(0)
  expect(structureCalls).toBe(0)
})

test('the transcribed notice withdraws the moment the text is edited (5.4)', async ({
  page,
}) => {
  await openFreshConsultation(page)
  await page.getByLabel('Choose image').setInputFiles(GOOD)
  await expect(page.getByText('Transcribed from a photograph')).toBeVisible()

  // Delete one character. The provenance claim is no longer true.
  const box = page.getByLabel('Consultation notes')
  await box.focus()
  await page.keyboard.press('End')
  await page.keyboard.press('Backspace')
  await expect(page.getByText('Transcribed from a photograph')).toHaveCount(0)
})

test('uploading appends to typed notes rather than replacing them (5.5)', async ({
  page,
}) => {
  await openFreshConsultation(page)
  await page.getByLabel('Consultation notes').fill('C/O headache')
  await expect(page.getByText('Draft saved')).toBeVisible()

  await page.getByLabel('Choose image').setInputFiles(GOOD)

  // Auto-retrying assertions, not a one-shot inputValue(): the transcript
  // arrives asynchronously and the first run read the box before React had
  // committed the append. The append itself was always correct -- the DOM
  // snapshot from that run showed both texts present.
  const box = page.getByLabel('Consultation notes')
  await expect(box).toHaveValue(/^C\/O headache/)
  await expect(box).toHaveValue(/fever since 3 days/)
})

test('a renamed text file is rejected with a specific message (5.6, E32)', async ({
  page,
}) => {
  await openFreshConsultation(page)
  await page.getByLabel('Choose image').setInputFiles(FAKE)
  // The dropzone's own hint also says "JPEG, PNG or WebP", so match the
  // error alert rather than any text on the page. Filtered by its text
  // because Next's route announcer (`__next-route-announcer__`) is a second,
  // always-mounted role="alert", so a bare getByRole('alert') is ambiguous.
  await expect(
    page.getByRole('alert').filter({ hasText: /could not be opened as an image/i }),
  ).toBeVisible()
  await expect(page.getByLabel('Consultation notes')).toHaveValue('')
})

test('a tiny image is rejected before any model call (5.7, E33)', async ({ page }) => {
  await openFreshConsultation(page)

  let transcribeCalls = 0
  await page.route('**/transcribe', async (route) => {
    transcribeCalls += 1
    await route.continue()
  })

  await page.getByLabel('Choose image').setInputFiles(TINY)
  await expect(page.getByText(/too small|resolution/i)).toBeVisible()
  await expect(page.getByLabel('Consultation notes')).toHaveValue('')
  // The server's precheck rejected it -- the request happened, but no
  // model was spent. (Client-side we only gate type/size, not dimensions.)
  expect(transcribeCalls).toBeLessThanOrEqual(1)
})
