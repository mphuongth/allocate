import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

// #560. This is one of the few things that genuinely cannot be pinned below E2E:
// a hydration mismatch needs a real server render and a real browser hydrating
// against it. The unit tests for useFundsData and useHydrated cover the cause
// (state seeded from localStorage during the hydration render); this covers the
// symptom, so a future mismatch anywhere on these pages is a real signal rather
// than more of the noise that made #560 invisible for so long.
//
// The mismatch only shows on a *second* visit. The first load populates the
// localStorage cache; the reload is what hydrates against it. A single goto
// would pass even with the bug present.

const today = new Date()
const MONTH = today.getMonth() + 1
const YEAR = today.getFullYear()

const HYDRATION_RE = /hydrat|didn't match|did not match|server rendered/i

test('cached pages hydrate without a mismatch', async ({ page }) => {
  // Both pages only write their cache once there is something to cache, so seed
  // real rows first — an empty account never warms the cache and the test would
  // pass without exercising anything.
  // Reuse this month's plan if an earlier spec left one — (user, month, year) is
  // unique, so inserting unconditionally would throw. Only clean up a plan this
  // test created, or it would delete another spec's fixture.
  const existing = await api.findMonthlyPlan(MONTH, YEAR)
  if (!existing) {
    const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 50_000_000 })
    if (plan?.id) cleanup.add(() => api.deleteMonthlyPlan(plan.id))
  }

  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && HYDRATION_RE.test(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (HYDRATION_RE.test(err.message)) errors.push(err.message)
  })

  for (const path of ['/funds', '/planning']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')

    // Nothing to hydrate against unless the first load actually cached something.
    const cached = await page.evaluate(() => Object.keys(localStorage))
    expect(
      cached.some((k) => k.startsWith('fundLibraryCache') || k.startsWith('planningCache_')),
      `${path} did not warm a cache, so the reload would prove nothing`,
    ).toBe(true)

    errors.length = 0
    await page.reload()
    await page.waitForLoadState('networkidle')

    expect(errors, `hydration mismatch on ${path}: ${errors.join(' | ')}`).toEqual([])
  }
})
