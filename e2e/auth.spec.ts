import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

function getTestCredentials() {
  const file = path.join(__dirname, '.auth', 'user.json')
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as { email: string; password: string }
}

test.use({ storageState: { cookies: [], origins: [] } })

test('login page renders email and password fields', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.locator('#email')).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

test('valid login redirects to /dashboard', async ({ page }) => {
  const { email, password } = getTestCredentials()
  await page.goto('/auth/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/dashboard', { timeout: 15_000 })
  await expect(page).toHaveURL(/dashboard/)
})

test('wrong password shows error and stays on login page', async ({ page }) => {
  const { email } = getTestCredentials()
  await page.goto('/auth/login')
  await page.locator('#email').fill(email)
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
