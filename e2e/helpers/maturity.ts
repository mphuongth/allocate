import { expect, type Page } from '@playwright/test'

/**
 * Wait for a renewal driven from the maturity sheet to have landed.
 *
 * Do NOT assert on the `maturity-renewed` flash instead: it renders for
 * SUCCESS_FLASH_MS (800 ms) and then the sheet closes itself, so an assertion
 * that starts polling *before* the response arrives can step straight over it.
 * Playwright's expect backs its poll interval off to a 1 s cap — wider than the
 * flash's own lifetime — and the 20 s budget then expires on an element that
 * came and went while nothing was looking. Measured on a failing run of #701:
 * the flash was in the DOM from 1074 ms to 1895 ms and was never sampled, even
 * though the renew had returned 200 and the money had moved.
 *
 * The durable outcome is the confirm button leaving the DOM. The sheet swaps
 * its whole form for the flash only after a 2xx, and a failed renewal keeps the
 * form — and its error — on screen, so this fails loudly on a real regression
 * rather than on a timer. The flash's own content is covered by the
 * MaturityResolveSheet component tests, which don't have to race it.
 *
 * Keyed off the test id, never the label: the button now says "Processing…"
 * while the request is in flight, so a name-matched locator goes hidden the
 * moment the click lands and this would return before the write had happened.
 */
export async function expectRenewalCommitted(page: Page) {
  await expect(page.getByTestId('maturity-confirm')).toBeHidden({ timeout: 20_000 })
}
