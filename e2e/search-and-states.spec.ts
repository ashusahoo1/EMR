/**
 * F17 search (MANUAL_TEST §8) and the error/empty states (§10 part A/B).
 */
import { expect, test } from './fixtures'

test.describe('search (F17)', () => {
  test('below the minimum, nothing is asked; partial names match anywhere', async ({
    page,
  }) => {
    await page.goto('/')
    const box = page.getByRole('searchbox', { name: 'Search patients or notes' })

    let searchCalls = 0
    await page.route('**/search?*', async (route) => {
      searchCalls += 1
      await route.continue()
    })

    // 8.1 -- one character: no request at all, so the doctor never sees the
    // API's 422 mid-word.
    await box.fill('R')
    await page.waitForTimeout(500)
    expect(searchCalls).toBe(0)

    // 8.2 -- "Ram" matches Ramesh AND VikRAM.
    await box.fill('Ram')
    const results = page.getByRole('listbox', { name: 'Search results' })
    await expect(results.getByRole('link', { name: /Ramesh Iyer/ }).first()).toBeVisible()
    await expect(results.getByRole('link', { name: /Vikram Patel/ })).toBeVisible()
  })

  test('note content is searchable and the excerpt LEADS the result (8.4)', async ({
    page,
  }) => {
    // The bug: results were titled with the patient's name, so a search for
    // "hypertension" looked like a list of people.
    await page.goto('/')
    await page.getByRole('searchbox').fill('hypertension')

    const results = page.getByRole('listbox', { name: 'Search results' })
    await expect(results.getByText('Consultation notes')).toBeVisible()
    await expect(results.getByText('Patients')).toHaveCount(0)

    const link = results.getByRole('link').first()
    // The matched text is the prominent line; the name is context.
    await expect(link.locator('span').nth(2)).toContainText(/follow up for hypertension/)
    await expect(link).toContainText('Ramesh Iyer')
  })

  test('a nonsense query shows the empty state (8.5)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('searchbox').fill('zzzqqq')
    await expect(page.getByText(/No patients or notes match/)).toBeVisible()
  })

  test('clicking a result navigates and closes; clicking outside closes (8.6, 8.7)', async ({
    page,
  }) => {
    await page.goto('/')
    const box = page.getByRole('searchbox')
    await box.fill('Sunita')
    const results = page.getByRole('listbox', { name: 'Search results' })
    await expect(results).toBeVisible()

    // 8.7
    await page.getByRole('heading', { name: /Today's appointments/ }).click()
    await expect(results).toBeHidden()

    // 8.6
    await box.fill('Sunita')
    await results
      .getByRole('link', { name: /Sunita Devi/ })
      .first()
      .click()
    await expect(page).toHaveURL(/\/patients\//)
    await expect(page.getByRole('heading', { name: 'Sunita Devi' })).toBeVisible()
    await expect(results).toBeHidden()
  })
})

test.describe('states and errors (F12)', () => {
  test('the states preview renders every error with the right retry policy (10.1-10.3)', async ({
    page,
  }) => {
    await page.goto('/dev/states')
    await expect(page.getByRole('heading', { name: 'UI states' })).toBeVisible()

    // 10.3 -- the retry button appears ONLY where retrying could help.
    //
    // The manual plan said "6 of 7"; the first E2E run counted 5, and the
    // code is the one that is right. TWO of the seven cases are
    // non-retryable, not one: the 404 (retrying yields another 404) and
    // NOT_CLINICAL_NOTES (a selfie is still a selfie on the second try).
    // The doc was corrected; the assertion states the actual policy.
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(5)
    // Seven ErrorState alerts, plus Sonner's always-mounted toast region.
    await expect(
      page.getByRole('alert').filter({ has: page.locator('svg') }),
    ).toHaveCount(7)

    // E23's wording -- the doctor is told they can carry on.
    await expect(
      page.getByText(/still write and save this consultation yourself/),
    ).toBeVisible()
  })

  test('an unknown route is a real 404 page with a way back (10.4)', async ({ page }) => {
    const response = await page.goto('/no-such-route')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to today' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('when the API is unreachable, the dashboard shows a retryable error (10.5)', async ({
    page,
  }) => {
    // Sever the network for the appointments call only.
    await page.route('**/appointments*', (route) => route.abort('connectionrefused'))
    await page.goto('/')

    await expect(page.getByText(/Could not reach the server/)).toBeVisible()
    const retry = page.getByRole('button', { name: 'Try again' })
    await expect(retry).toBeVisible()

    // 10.6 -- restore the network and retry; the list loads.
    await page.unroute('**/appointments*')
    await retry.click()
    await expect(page.getByRole('time')).toHaveCount(6)
  })

  test('every page has a distinct title (10.12)', async ({ page }) => {
    await page.goto('/')
    const dashboard = await page.title()
    await page.getByRole('link', { name: 'Amit Kumar' }).click()
    await expect(page).toHaveURL(/\/patients\//)
    const patient = await page.title()

    expect(dashboard).not.toBe(patient)
    expect(dashboard).toContain("Today's appointments")
    expect(patient).toContain('Patient')
  })
})
