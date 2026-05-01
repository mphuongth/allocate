import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test('login page renders email and password fields', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.locator('#email')).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

test('valid login redirects to /dashboard', async ({ page }) => {
  await page.goto('/auth/login')
  await page.locator('#email').fill(process.env.E2E_TEST_EMAIL!)
  await page.locator('#password').fill(process.env.E2E_TEST_PASSWORD!)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/dashboard', { timeout: 15_000 })
  await expect(page).toHaveURL(/dashboard/)
})

test('wrong password shows error and stays on login page', async ({ page }) => {
  await page.goto('/auth/login')
  await page.locator('#email').fill(process.env.E2E_TEST_EMAIL!)
  await page.locator('#password').fill('wrongpassword999')
  await page.locator('button[type="submit"]').click()
  await expect(page.getByRole('alert').or(page.locator('[class*="error"]').first())).toBeVisible({ timeout: 5_000 })
  await expect(page).toHaveURL(/auth\/login/)
})

test('unauthenticated access to /dashboard redirects to /auth/login', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForURL('**/auth/login', { timeout: 10_000 })
  await expect(page).toHaveURL(/auth\/login/)
})

test('signup page renders all required fields', async ({ page }) => {
  await page.goto('/auth/signup')
  await expect(page.locator('#email')).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
  await expect(page.locator('#confirmPassword')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})
