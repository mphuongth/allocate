import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

function getTestCredentials() {
  const file = path.join(__dirname, '.auth', 'user.json')
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as { email: string; password: string }
}

test.use({ storageState: { cookies: [], origins: [] } })

test.beforeEach(async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
})

// ─── Login page structure ───────────────────────────────────────────────────

test('login page renders email and password fields', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.locator('#email')).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

test('login page shows brand mark icon', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.locator('[data-testid="brand-mark"]')).toBeVisible()
})

test('login page shows Cairn wordmark', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.locator('text=Cairn').first()).toBeVisible()
})

test('login page h1 says Welcome back', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.locator('h1').first()).toContainText('Welcome back')
})

test('login page shows Forgot password button', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.getByRole('button', { name: /forgot password/i })).toBeVisible()
})

// ─── Login behaviour ────────────────────────────────────────────────────────

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

// ─── Signup page structure ──────────────────────────────────────────────────

test('signup page renders name, email and password fields', async ({ page }) => {
  await page.goto('/auth/signup')
  await expect(page.locator('#name')).toBeVisible()
  await expect(page.locator('#email')).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

test('signup page does not have a confirm password field', async ({ page }) => {
  await page.goto('/auth/signup')
  await expect(page.locator('#confirmPassword')).toHaveCount(0)
})

test('signup page shows brand mark icon', async ({ page }) => {
  await page.goto('/auth/signup')
  await expect(page.locator('[data-testid="brand-mark"]')).toBeVisible()
})

test('signup page h1 says Create account', async ({ page }) => {
  await page.goto('/auth/signup')
  await expect(page.locator('h1').first()).toContainText('Create account')
})

test('signup page has link to login', async ({ page }) => {
  await page.goto('/auth/signup')
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()
})

test('login page has link to signup', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.getByRole('link', { name: /sign up/i })).toBeVisible()
})

// ─── Mobile: prevent iOS auto-zoom on input focus ────────────────────────────
// iOS Safari zooms the viewport when a focused input has font-size < 16px, and
// never resets it — leaving subsequent pages (e.g. Overview after login) zoomed.
test.describe('mobile input font-size', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('login email input renders at >=16px to avoid iOS zoom', async ({ page }) => {
    await page.goto('/auth/login')
    const fontSize = await page.locator('#email').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize)
    )
    expect(fontSize).toBeGreaterThanOrEqual(16)
  })

  test('login password input renders at >=16px to avoid iOS zoom', async ({ page }) => {
    await page.goto('/auth/login')
    const fontSize = await page.locator('#password').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize)
    )
    expect(fontSize).toBeGreaterThanOrEqual(16)
  })
})

// ─── Mobile: full-screen redesign (issue #243) ───────────────────────────────
// On mobile the auth screen is a full-bleed layout: brand pinned top-left, a
// large hero heading, and the form flush to the top — not a vertically-centered
// card. These assert the user-visible result of that redesign.
test.describe('mobile auth redesign', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('login heading renders as a large hero (>=24px) on mobile', async ({ page }) => {
    await page.goto('/auth/login')
    const fontSize = await page.locator('h1').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize)
    )
    expect(fontSize).toBeGreaterThanOrEqual(24)
  })

  test('signup heading renders as a large hero (>=24px) on mobile', async ({ page }) => {
    await page.goto('/auth/signup')
    const fontSize = await page.locator('h1').first().evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize)
    )
    expect(fontSize).toBeGreaterThanOrEqual(24)
  })

  test('brand is pinned to the top-left, not vertically centered, on mobile', async ({ page }) => {
    await page.goto('/auth/login')
    const box = await page.locator('[data-testid="brand-mark"]').boundingBox()
    expect(box).not.toBeNull()
    // Top-left: near the left edge and in the upper portion of the screen.
    expect(box!.x).toBeLessThan(80)
    expect(box!.y).toBeLessThan(160)
  })
})

// ─── Desktop centered card layout ───────────────────────────────────────────

test('login form is inside a card', async ({ page }) => {
  await page.goto('/auth/login')
  await expect(page.locator('[data-testid="auth-card"]')).toBeVisible()
})

test('signup form is inside a card', async ({ page }) => {
  await page.goto('/auth/signup')
  await expect(page.locator('[data-testid="auth-card"]')).toBeVisible()
})
