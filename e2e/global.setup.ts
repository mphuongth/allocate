import { chromium, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const AUTH_FILE = path.join(__dirname, '.auth', 'session.json')

async function globalSetup() {
  const email = process.env.E2E_TEST_EMAIL
  const password = process.env.E2E_TEST_PASSWORD

  if (!email || !password) {
    throw new Error(
      'E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set.\n' +
      'Create a .env.e2e file or set them as environment variables.\n' +
      'See the E2E test plan for setup instructions.'
    )
  }

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('/auth/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()

  await page.waitForURL('**/dashboard', { timeout: 15_000 })
  await expect(page).toHaveURL(/dashboard/)

  await context.storageState({ path: AUTH_FILE })
  await browser.close()
}

export default globalSetup
