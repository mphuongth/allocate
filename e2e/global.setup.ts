import { test as setup } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'

const AUTH_FILE = path.join(__dirname, '.auth', 'session.json')
const USER_FILE = path.join(__dirname, '.auth', 'user.json')

setup('authenticate', async ({ page }) => {
  const supabaseUrl = process.env.E2E_SUPABASE_URL!
  const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY must be set.')
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Create a throwaway test user — admin API bypasses email verification
  const email = `e2e-${Date.now()}@test.invalid`
  const password = 'TestPass123!'

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('Failed to create test user')

  const userId = data.user.id

  // Persist user info for helpers and teardown
  fs.mkdirSync(path.dirname(USER_FILE), { recursive: true })
  fs.writeFileSync(USER_FILE, JSON.stringify({ userId, email, password }))

  // Sign in via the browser
  await page.goto('/auth/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/dashboard', { timeout: 15_000 })

  await page.context().storageState({ path: AUTH_FILE })

  // Seed one bank transaction so the dashboard isn't empty
  await admin.from('investment_transactions').insert({
    user_id: userId,
    asset_type: 'bank',
    amount_vnd: 10_000_000,
    investment_date: '2026-01-01',
    interest_rate: 6,
    transaction_type: 'investment',
  })
})
