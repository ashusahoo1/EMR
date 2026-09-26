/**
 * Phone width (MANUAL_TEST §10 part C). Runs under the `mobile` project,
 * which is a real iPhone SE device profile -- viewport, touch and UA -- not a
 * resized desktop window.
 */
import { expect, test } from './fixtures'

// These assert the STACKED phone layout, so they are only meaningful under
// the `mobile` project. The default project also matches this file, and
// there the row correctly renders as one line -- which the stacking
// assertion would then report as a failure of the app rather than of the
// test's own premise.
test.skip(({ isMobile }) => !isMobile, 'phone-width layout only')

test('no horizontal overflow on the dashboard (10.6)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('time')).toHaveCount(6)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflow).toBe(false)
})

test('an appointment row stacks, with a full-width action (10.7)', async ({ page }) => {
  await page.goto('/')
  const row = page.getByRole('listitem').filter({ hasText: 'Amit Kumar' })
  const button = row.getByRole('button', { name: /Start consultation/ })

  const rowBox = await row.boundingBox()
  const buttonBox = await button.boundingBox()
  if (!rowBox || !buttonBox) throw new Error('row or button not rendered')

  // Stacked: the button sits BELOW the name line, not beside it...
  const name = await row.getByRole('link', { name: 'Amit Kumar' }).boundingBox()
  if (!name) throw new Error('name not rendered')
  expect(buttonBox.y).toBeGreaterThan(name.y + name.height - 1)

  // ...and spans the row, which is the target a thumb reliably hits.
  expect(buttonBox.width).toBeGreaterThan(rowBox.width * 0.8)
})

test('the search dropdown stays inside the viewport (10.8)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('searchbox').fill('Ram')
  const results = page.getByRole('listbox', { name: 'Search results' })
  await expect(results).toBeVisible()

  const box = await results.boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) throw new Error('dropdown or viewport missing')
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
})

test('a patient page and a consultation page do not overflow (10.9)', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Amit Kumar' }).click()
  await expect(page.getByRole('heading', { name: 'Amit Kumar' })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false)

  await page.goto('/')
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Amit Kumar' })
    .getByRole('button', { name: /Start consultation/ })
    .click()
  await expect(page.getByLabel('Consultation notes')).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false)
})
