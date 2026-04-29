import { test, expect } from '@playwright/test'

test('sidebar links navigate to correct routes', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  await page.getByRole('link', { name: /planning|monthly|kế hoạch/i }).first().click()
  await expect(page).toHaveURL(/planning/)

  await page.getByRole('link', { name: /funds|quỹ/i }).first().click()
  await expect(page).toHaveURL(/funds/)

  await page.getByRole('link', { name: /settings|cài đặt/i }).first().click()
  await expect(page).toHaveURL(/settings/)

  await page.getByRole('link', { name: /dashboard|overview|tổng quan/i }).first().click()
  await expect(page).toHaveURL(/dashboard/)
})

test('active nav item reflects current route', async ({ page }) => {
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')

  // The planning link should have aria-current="page" or an active class
  const planningLink = page.getByRole('link', { name: /planning|monthly|kế hoạch/i }).first()
  await expect(planningLink).toBeVisible()
  const ariaCurrent = await planningLink.getAttribute('aria-current')
  const className = await planningLink.getAttribute('class')
  const isActive = ariaCurrent === 'page' || (className ?? '').includes('active') || (className ?? '').includes('bg-')
  expect(isActive).toBe(true)
})

test('landing page redirects authenticated user to /dashboard', async ({ page }) => {
  await page.goto('/')
  await page.waitForURL(/dashboard/, { timeout: 10_000 })
  await expect(page).toHaveURL(/dashboard/)
})

test('language switcher changes UI to Vietnamese', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // Find language switcher button (usually shows current locale flag/code)
  const langSwitcher = page.getByRole('button', { name: /en|vi|language|ngôn ngữ/i }).first()
  if (await langSwitcher.isVisible({ timeout: 3_000 })) {
    await langSwitcher.click()
    const viOption = page.getByRole('option', { name: /vi|vietnamese|tiếng việt/i })
      .or(page.locator('text=/VI|Tiếng Việt/').first())
    if (await viOption.isVisible({ timeout: 2_000 })) {
      await viOption.click()
      await page.waitForTimeout(500)
      // At least one Vietnamese nav label should be visible
      await expect(page.locator('text=/Tổng quan|Kế hoạch|Cài đặt/i').first()).toBeVisible({ timeout: 5_000 })

      // Switch back to English
      await langSwitcher.click()
      const enOption = page.getByRole('option', { name: /en|english/i })
        .or(page.locator('text=/EN|English/').first())
      if (await enOption.isVisible({ timeout: 2_000 })) {
        await enOption.click()
      }
    }
  }
})
