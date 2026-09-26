/**
 * F1 -- the appointments dashboard (MANUAL_TEST §1) and patient profile (§2).
 */
import { expect, patientId, test } from './fixtures'

test.describe('dashboard', () => {
  test('shows six seeded appointments in clinic time, earliest first', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Today's appointments/)

    // 1.1 -- six rows.
    const rows = page.getByRole('listitem').filter({ has: page.getByRole('time') })
    await expect(rows).toHaveCount(6)

    // 1.2 -- times are CLINIC time, not the UTC the API returns. 03:30Z is
    // 09:00 IST; seeing 03:30 here would mean the timezone conversion broke.
    const times = await page.getByRole('time').allTextContents()
    expect(times[0]).toBe('09:00 am')
    expect(times[5]).toBe('12:30 pm')
    // And ascending.
    expect(times).toEqual([...times])
  })

  test('filter tabs carry live counts and narrow the list', async ({ page }) => {
    await page.goto('/')

    // 1.3 -- the counts beside each tab match the seed exactly.
    const tabs = page.getByRole('tablist')
    await expect(tabs.getByRole('tab', { name: /All/ })).toContainText('6')
    await expect(tabs.getByRole('tab', { name: /Waiting/ })).toContainText('3')
    await expect(tabs.getByRole('tab', { name: /In consultation/ })).toContainText('1')
    await expect(tabs.getByRole('tab', { name: /Completed/ })).toContainText('2')

    // 1.5 -- filtering narrows the list.
    await tabs.getByRole('tab', { name: /Completed/ }).click()
    await expect(page.getByRole('time')).toHaveCount(2)

    // 1.4 -- counts do not change with the filter.
    await expect(tabs.getByRole('tab', { name: /Waiting/ })).toContainText('3')
  })

  test('an empty date shows the empty state, not a blank panel (E28)', async ({
    page,
  }) => {
    await page.goto('/')

    // 1.6 -- a date with nothing scheduled.
    await page.getByLabel('Date').fill('2030-01-15')
    await expect(page.getByText('No appointments on this date')).toBeVisible()
    await expect(page.getByRole('time')).toHaveCount(0)
  })

  test('the row name links to the patient; the button starts the consultation', async ({
    page,
  }) => {
    await page.goto('/')

    // Two distinct targets per row -- a button nested in an anchor is
    // invalid HTML, so these must be separate elements.
    const amit = page.getByRole('listitem').filter({ hasText: 'Amit Kumar' })
    await expect(amit.getByRole('link', { name: 'Amit Kumar' })).toBeVisible()
    await expect(amit.getByRole('button', { name: 'Start consultation' })).toBeVisible()

    await amit.getByRole('link', { name: 'Amit Kumar' }).click()
    await expect(page).toHaveURL(/\/patients\//)
    await expect(page.getByRole('heading', { name: 'Amit Kumar' })).toBeVisible()
  })
})

test.describe('patient profile', () => {
  test('an allergic patient shows a red banner; history is newest first', async ({
    page,
  }) => {
    await page.goto(`/patients/${await patientId('Sunita Devi')}`)

    // 2.2 -- the allergy banner is a role="alert", announced immediately.
    const banner = page.getByRole('alert').filter({ hasText: 'Sulfa drugs' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(/Allerg/)

    // 2.3
    await expect(page.getByText('Type 2 Diabetes Mellitus')).toBeVisible()

    // 2.4 -- two entries, newest first (Sept before July per the seed).
    //
    // Only the TOP-LEVEL history entries. Each one nests a second <details>
    // for "Original notes", so a plain `details > summary` also counts those
    // and the second summary read "Original notes" instead of the second
    // visit. Scoping to the list's direct children fixes the premise.
    const entries = page.getByRole('list').last().locator('> li > details > summary')
    await expect(entries).toHaveCount(2)
    await expect(entries.nth(0)).toContainText('Burning urination')
    await expect(entries.nth(1)).toContainText('Diabetes review')
  })

  test('an opened entry shows the structured note and hides sourceSpan', async ({
    page,
  }) => {
    await page.goto(`/patients/${await patientId('Sunita Devi')}`)

    // 2.5
    await page
      .getByRole('list')
      .last()
      .locator('> li > details > summary')
      .first()
      .click()
    // `exact` so the structured item is matched, not the raw-notes <pre>
    // that also contains the word once "Original notes" is opened.
    await expect(page.getByText('Sulfa drug allergy', { exact: true })).toBeVisible()
    await expect(page.getByText('Nitrofurantoin', { exact: true })).toBeVisible()

    // The provenance machinery must never reach the screen (§4.5).
    //
    // `toBeHidden`, not `toHaveCount(0)`. The raw notes DO exist in the DOM
    // here -- inside the collapsed "Original notes" <details> -- and
    // getByText matches hidden elements. The assertion is that a doctor
    // cannot SEE the raw span text without opening that disclosure, which
    // is exactly what hidden-vs-visible tests.
    await expect(page.getByText('sourceSpan')).toHaveCount(0)
    await expect(page.getByText('ALLERGIC TO SULFA DRUGS')).toBeHidden()

    // 2.6 -- the raw notes are reachable under the entry.
    await page.getByText('Original notes').first().click()
    await expect(page.getByText('ALLERGIC TO SULFA DRUGS')).toBeVisible()
  })

  test('a patient with nothing shows both empty states, stated not blank', async ({
    page,
  }) => {
    await page.goto(`/patients/${await patientId('Kavita Rao')}`)

    // 2.7 -- "no known allergies" is a claim, not silence.
    await expect(page.getByText('No known allergies')).toBeVisible()
    // No ALLERGY alert. Sonner's toast region also carries role="alert" and
    // is always mounted, so a bare `getByRole('alert')` count of zero was
    // never achievable -- it was matching the notification tray, not a
    // banner. Scope the assertion to what the check is actually about.
    await expect(page.getByRole('alert').filter({ hasText: /allerg/i })).toHaveCount(0)
    await expect(page.getByText('No previous consultations')).toBeVisible()
  })
})
