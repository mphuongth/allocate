import { test as setup, expect } from '@playwright/test'
import path from 'path'
import * as api from './helpers/api'

const AUTH_FILE = path.join(__dirname, '.auth', 'session.json')

setup('authenticate', async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL
  const password = process.env.E2E_TEST_PASSWORD

  if (!email || !password) {
    throw new Error(
      'E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set. ' +
      'See the E2E test plan for setup instructions.'
    )
  }

  await page.goto('/auth/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('button[type="submit"]').click()

  await page.waitForURL('**/dashboard', { timeout: 15_000 })
  await expect(page).toHaveURL(/dashboard/)

  await page.context().storageState({ path: AUTH_FILE })

  // Seed one bank transaction so the dashboard shows real data (not empty state)
  // Only seed if none exist already (idempotent across retries)
  try {
    const userId = await api.getTestUserId()
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
    const { count } = await sb.from('investment_transactions').select('*', { count: 'exact', head: true }).eq('user_id', userId)
    if (!count || count === 0) {
      await api.createTransaction({
        asset_type: 'bank',
        amount_vnd: 10_000_000,
        investment_date: '2026-01-01',
        interest_rate: 6,
      })
    }
  } catch { /* non-fatal — dashboard will show empty state for affected tests */ }
})
