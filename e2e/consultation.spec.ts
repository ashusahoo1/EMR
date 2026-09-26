/**
 * F4-F7 -- the whole consultation flow (MANUAL_TEST §3, §4, §6, §7).
 *
 * This is the file that would have caught all three bugs manual testing
 * found, because it clicks the same sequence a doctor does and then reads
 * the result back the way the page does -- from the server, after a reload.
 */
import { expect, history, listAppointments, N01_NOTES, test } from './fixtures'

/** Click Start consultation on a named Waiting row and land in the composer. */
async function startConsultation(page: import('@playwright/test').Page, name: string) {
  await page.goto('/')
  const row = page.getByRole('listitem').filter({ hasText: name })
  await row.getByRole('button', { name: /Start consultation/ }).click()
  await expect(page).toHaveURL(/\/consultations\//)
  await expect(page.getByLabel('Consultation notes')).toBeVisible()
}

/** Type notes and wait for the autosave to land. */
async function writeNotes(page: import('@playwright/test').Page, text: string) {
  const box = page.getByLabel('Consultation notes')
  await box.fill(text)
  await expect(page.getByText('Draft saved')).toBeVisible()
}

test.describe('writing notes (F4)', () => {
  test('Generate is disabled until there are real notes (E1)', async ({ page }) => {
    await startConsultation(page, 'Amit Kumar')
    const generate = page.getByRole('button', { name: /Generate structured note/ })

    // 3.2 -- empty.
    await expect(generate).toBeDisabled()
    await expect(page.getByText('Write some notes first')).toBeVisible()

    // 3.3 -- whitespace is not content.
    await page.getByLabel('Consultation notes').fill('   \n  ')
    await expect(generate).toBeDisabled()

    // 3.4 -- real text enables it.
    await page.getByLabel('Consultation notes').fill('C/O fever x3d')
    await expect(generate).toBeEnabled()
  })

  test('the draft survives a reload -- it is autosaved to the server (3.5)', async ({
    page,
  }) => {
    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, 'C/O fever x3d')

    await page.reload()
    await expect(page.getByLabel('Consultation notes')).toHaveValue('C/O fever x3d')
  })

  test('starting a consultation moves the appointment to In consultation (F15)', async ({
    page,
  }) => {
    // The bug: nothing ever set in_consultation, so the later
    // waiting -> completed jump was illegal and the row stuck on Waiting.
    await startConsultation(page, 'Amit Kumar')
    const rows = await listAppointments()
    expect(rows.find((r) => r.patient.name === 'Amit Kumar')?.status).toBe(
      'in_consultation',
    )
  })
})

test.describe('generate and review (F5, F6)', () => {
  test('mismatched notes produce flags with plain-language reasons (E13/E14)', async ({
    page,
  }) => {
    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, 'C/O fever x3d')
    await page.getByRole('button', { name: /Generate structured note/ }).click()

    // 4.1 -- the draft panel, visually marked as unsaved (F14).
    await expect(page.getByRole('heading', { name: 'AI draft' })).toBeVisible()
    await expect(page.getByText('Not saved')).toBeVisible()

    // 4.2 -- the summary counts.
    await expect(page.getByText(/9 items need checking/)).toBeVisible()

    // 4.3 -- each flag says WHY, in words a doctor reads.
    await expect(
      page.getByText('"mild cough" does not appear in your notes.'),
    ).toBeVisible()
  })

  test('THE PERSISTENCE BUG: flags survive a reload', async ({ page }) => {
    // Verification was computed and returned but never stored, so a reload
    // showed a clean-looking draft when nine items were ungrounded.
    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, 'C/O fever x3d')
    await page.getByRole('button', { name: /Generate structured note/ }).click()
    await expect(page.getByText(/9 items need checking/)).toBeVisible()

    await page.reload()
    await expect(page.getByText(/9 items need checking/)).toBeVisible()
  })

  test('a dropped allergy is caught by the survival check (E17)', async ({ page }) => {
    // Grounding only validates what is PRESENT; it can never see an
    // omission. This is the separate check that does.
    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, 'C/O fever x3d\nallergic to sulfa drugs')
    await page.getByRole('button', { name: /Generate structured note/ }).click()

    // 4.6 -- a standalone banner: there is no item to attach it to.
    await expect(
      page.getByRole('alert').filter({ hasText: /allergic to sulfa drugs.*missing/ }),
    ).toBeVisible()
  })

  test('matching notes pass clean, and say so (4b)', async ({ page }) => {
    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, N01_NOTES)
    await page.getByRole('button', { name: /Generate structured note/ }).click()

    // 4.9 -- a clean result is REPORTED, so "verified clean" and "never
    // checked" are distinguishable.
    await expect(page.getByText('Every item traces back to your notes')).toBeVisible()
    await expect(page.getByText(/does not appear in your notes/)).toHaveCount(0)
  })

  test('every field is editable; add and remove work without losing focus (4c)', async ({
    page,
  }) => {
    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, N01_NOTES)
    await page.getByRole('button', { name: /Generate structured note/ }).click()
    await expect(page.getByRole('heading', { name: 'AI draft' })).toBeVisible()

    // 4.11 -- no read-only AI output.
    const chief = page.getByLabel('Chief complaint')
    await chief.fill('Feveru')
    await expect(chief).toHaveValue('Feveru')

    // 4.12 / 4.13 -- add an item and type into it without focus loss.
    await page.getByRole('button', { name: /Add symptoms/ }).click()
    // getByRole, not getByLabel: the remove BUTTON is also labelled
    // "…item 4", so a label query resolves to two elements.
    const added = page.getByRole('textbox', { name: 'Symptoms item 4' })
    await added.pressSequentially('ghdfhdybk')
    await expect(added).toHaveValue('ghdfhdybk')
    await expect(added).toBeFocused()

    // 4.14 -- removing the MIDDLE item keeps the others' text. An index key
    // would have carried "Mild cough"'s input onto the row below.
    await page.getByRole('button', { name: 'Remove symptoms item 2' }).click()
    const symptom = (n: number) =>
      page.getByRole('textbox', { name: `Symptoms item ${n}` })
    await expect(symptom(1)).toHaveValue('Fever for 3 days')
    await expect(symptom(2)).toHaveValue('No breathing difficulty')
    await expect(symptom(3)).toHaveValue('ghdfhdybk')
  })

  test('the missingInformation nudge is dismissible and never blocks Save (4.16)', async ({
    page,
  }) => {
    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, N01_NOTES)
    await page.getByRole('button', { name: /Generate structured note/ }).click()

    await expect(page.getByText('Not recorded in these notes')).toBeVisible()
    await expect(page.getByText('This does not stop you saving')).toBeVisible()

    await page.getByRole('button', { name: 'Dismiss this note' }).click()
    await expect(page.getByText('Not recorded in these notes')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /Save to patient record/ }),
    ).toBeEnabled()
  })

  test('regenerating after edits asks first, and Keep my edits keeps them (E30)', async ({
    page,
  }) => {
    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, N01_NOTES)
    await page.getByRole('button', { name: /Generate structured note/ }).click()
    await expect(page.getByRole('heading', { name: 'AI draft' })).toBeVisible()

    await page.getByLabel('Chief complaint').fill('My correction')
    await page.getByRole('button', { name: 'Regenerate' }).click()

    // 4.18
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Replace your edits?')

    // 4.19
    await dialog.getByRole('button', { name: 'Keep my edits' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByLabel('Chief complaint')).toHaveValue('My correction')
  })

  test('Generate cannot be double-fired (E24)', async ({ page }) => {
    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, 'C/O fever x3d')
    const generate = page.getByRole('button', { name: /Generate/ })

    // Count calls at the network layer -- the only honest measure.
    let structureCalls = 0
    await page.route('**/consultations/*/structure', async (route) => {
      structureCalls += 1
      await route.continue()
    })

    // 4.17 -- a REAL double-click, no `force`. This is what found the bug:
    // `disabled={isPending}` only takes effect after React re-renders, and
    // both click events arrive before that, so two requests went out. The
    // synchronous latch in useSingleFlight is what makes this pass.
    await generate.dblclick()
    await expect(page.getByRole('heading', { name: 'AI draft' })).toBeVisible()

    expect(structureCalls).toBe(1)
  })
})

test.describe('save (F7, F15)', () => {
  test("one save produces exactly one history entry with the DOCTOR'S edits", async ({
    page,
  }) => {
    const before = (await history('Amit Kumar')).length

    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, N01_NOTES)
    await page.getByRole('button', { name: /Generate structured note/ }).click()
    await expect(page.getByRole('heading', { name: 'AI draft' })).toBeVisible()

    // 6.1 -- an edit that is unmistakably ours.
    await page.getByLabel('Chief complaint').fill('MY EDIT TEST')

    // 6.2
    await page.getByRole('button', { name: /Save to patient record/ }).click()
    await expect(page).toHaveURL(/\/patients\//)
    await expect(page.getByRole('heading', { name: 'Amit Kumar' })).toBeVisible()

    // 6.3 -- exactly one more.
    expect((await history('Amit Kumar')).length).toBe(before + 1)

    // 6.4 -- the doctor's version was saved, not the AI's. aiNote and
    // confirmedNote are separate columns precisely so this can be checked.
    await expect(page.locator('details > summary').first()).toContainText('MY EDIT TEST')
  })

  test('THE STATUS BUG: the appointment reads Completed after saving (6.5)', async ({
    page,
  }) => {
    await startConsultation(page, 'Kavita Rao')
    await writeNotes(page, N01_NOTES)
    await page.getByRole('button', { name: /Generate structured note/ }).click()
    await page.getByRole('button', { name: /Save to patient record/ }).click()
    await expect(page).toHaveURL(/\/patients\//)

    await page.goto('/')
    const row = page.getByRole('listitem').filter({ hasText: 'Kavita Rao' })
    await expect(row).toContainText('Completed')
  })

  test('a saved consultation is read-only and styled unlike a draft (6.6, F14)', async ({
    page,
  }) => {
    await startConsultation(page, 'Deepak Menon')
    await writeNotes(page, N01_NOTES)
    await page.getByRole('button', { name: /Generate structured note/ }).click()
    await page.getByRole('button', { name: /Save to patient record/ }).click()
    await expect(page).toHaveURL(/\/patients\//)

    await page.goto('/')
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Deepak Menon' })
      .getByRole('button', { name: /Open consultation/ })
      .click()

    await expect(page.getByText('Saved note')).toBeVisible()
    await expect(page.getByText('Not saved')).toHaveCount(0)
    await expect(page.getByLabel('Consultation notes')).toBeDisabled()
    await expect(
      page.getByRole('button', { name: /Save to patient record/ }),
    ).toHaveCount(0)
  })

  test('a doctor can save with the AI switched off entirely (E23, E29)', async ({
    page,
  }) => {
    // The provider being down must not stop the clinic. Simulated by making
    // the structure endpoint answer 503 exactly as the real API does.
    await page.route('**/consultations/*/structure', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'AI_UNAVAILABLE',
            message: 'AI assistance is unavailable right now.',
          },
        }),
      }),
    )

    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, 'c/o acidity, advised antacid before meals')

    // 9.2 -- the refusal tells the doctor they can carry on, not that the
    // app is broken.
    await page.getByRole('button', { name: /Generate structured note/ }).click()
    await expect(
      page.getByText(/still write and save this consultation yourself/),
    ).toBeVisible()

    // 9.4 / 9.5 -- the free-text save path exists and works.
    await expect(page.getByText('Save without a structured note')).toBeVisible()
    await page.getByRole('button', { name: /Save to patient record/ }).click()
    await expect(page).toHaveURL(/\/patients\//)

    // 9.6 -- raw notes preserved. The summary row ALSO shows the first line
    // as its fallback title, so target the <pre> the "Original notes"
    // disclosure reveals rather than any text match.
    await page
      .getByRole('list')
      .last()
      .locator('> li > details > summary')
      .first()
      .click()
    await page.getByText('Original notes').first().click()
    await expect(page.locator('pre')).toContainText(
      'c/o acidity, advised antacid before meals',
    )
  })
})

test.describe('unsaved-work guard (F16)', () => {
  test('editing the draft then leaving prompts; cancelling keeps the edit', async ({
    page,
  }) => {
    await startConsultation(page, 'Amit Kumar')
    await writeNotes(page, N01_NOTES)
    await page.getByRole('button', { name: /Generate structured note/ }).click()
    await expect(page.getByRole('heading', { name: 'AI draft' })).toBeVisible()

    // 7.1
    await page.getByLabel('Chief complaint').fill('unsaved edit')
    await expect(page.getByText('You have unsaved changes')).toBeVisible()

    // 7.2 / 7.3 -- the in-app guard is our own code, so it cannot be
    // suppressed the way a browser's beforeunload can.
    page.once('dialog', (d) => d.dismiss())
    await page.getByRole('link', { name: /Back to patient/ }).click()
    await expect(page).toHaveURL(/\/consultations\//)
    await expect(page.getByLabel('Chief complaint')).toHaveValue('unsaved edit')
  })

  test('a clean form does not prompt (7.5)', async ({ page }) => {
    await startConsultation(page, 'Amit Kumar')

    let prompted = false
    page.on('dialog', (d) => {
      prompted = true
      void d.accept()
    })
    await page.getByRole('link', { name: /Back to patient/ }).click()
    await expect(page).toHaveURL(/\/patients\//)
    expect(prompted).toBe(false)
  })
})
