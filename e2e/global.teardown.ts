import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'
import { assertSafeTestTarget } from './helpers/guard'

const USER_FILE = path.join(__dirname, '.auth', 'user.json')

export default async function teardown() {
  if (!fs.existsSync(USER_FILE)) return

  // Never let the destructive teardown deletes run against production.
  assertSafeTestTarget(process.env.E2E_SUPABASE_URL, { allow: process.env.E2E_ALLOW_PROD === '1' })

  const { userId } = JSON.parse(fs.readFileSync(USER_FILE, 'utf-8'))
  const sb = createClient(
    process.env.E2E_SUPABASE_URL!,
    process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!
  )

  // Delete user data in FK-safe order before removing the auth user
  await sb.from('investment_transactions').delete().eq('user_id', userId)
  await sb.from('savings_goals').delete().eq('user_id', userId)
  await sb.from('insurance_members').delete().eq('user_id', userId)
  await sb.from('fixed_expenses').delete().eq('user_id', userId)
  await sb.from('monthly_plans').delete().eq('user_id', userId)
  await sb.from('funds').delete().eq('user_id', userId)

  await sb.auth.admin.deleteUser(userId)

  fs.unlinkSync(USER_FILE)
}
