import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test('login page renders email and password fields', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: /sign in|log in|login/i })).toBeVisible()
})

test('valid login redirects to /dashboard', async ({ page }) => {
  await page.goto('/auth/login')
  await page.getByLabel('Email').fill(process.env.E2E_TEST_EMAIL!)
  await page.getByLabel('Password').fill(process.env.E2E_TEST_PASSWORD!)
  await page.getByRole('button', { name: /sign in|log in|login/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 15_000 })
  await expect(page).toHaveURL(/dashboard/)
})

test('wrong password shows error and stays on login page', async ({ page }) => {
  await page.goto('/auth/login')
  await page.getByLabel('Email').fill(process.env.E2E_TEST_EMAIL!)
  await page.getByLabel('Password').fill('wrongpassword999')
  await page.getByRole('button', { name: /sign in|log in|login/i }).click()
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
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel(/^Password/)).toBeVisible()
  await expect(page.getByLabel(/confirm/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /sign up|create/i })).toBeVisible()
})
