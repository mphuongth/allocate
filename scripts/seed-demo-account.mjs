// Seeds the throwaway demo account the landing-page product tour is screenshotted from.
//
// The tour images have to be pictures of the real app, so they need a real account with
// real rows behind them — an empty account renders four empty states and a hand-faked
// account drifts from the schema the moment a migration lands. This script builds that
// account directly against a LOCAL Supabase stack via the service-role admin API, then
// `scripts/generate-tour-screenshots.mjs` photographs it.
//
// Usage — with a local stack running (`supabase start`):
//
//   DEMO_SUPABASE_URL=http://127.0.0.1:54321 \
//   DEMO_SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase start`> \
//   DEMO_EMAIL=demo@example.com DEMO_PASSWORD='DemoPass123!' \
//   node scripts/seed-demo-account.mjs
//
// Optional: DEMO_TODAY=2026-07-18   (pin "today" so re-runs produce identical images)
//           DEMO_LOCALE=vi|en       (language of the *user-entered* strings; default vi)
//
// DEMO_LOCALE exists because the tour sits directly under the landing hero, and the hero's
// mockup renders goal names from i18n (`landing.mockGoal*`). Seeding Vietnamese goal names
// once and screenshotting both locales put "Retirement" in the hero and "Hưu trí" in the
// image below it — one page, two voices. So the demo account is re-seeded per locale:
// seed(vi) → capture vi → seed(en) → capture en. See the README.
//
// Only strings a *person* would have typed are translated. Fund names stay Vietnamese in
// both locales — DCDS and VCBF-TBF are real funds and renaming them would be a lie. Amounts,
// dates and every other number live outside the copy table on purpose, so the two locales
// are the same account in two languages rather than two different demo accounts.
//
// Idempotent by demolition: an existing demo user is deleted outright and rebuilt. Every
// table in the schema hangs off `auth.users(id) ON DELETE CASCADE` (directly, or via
// monthly_plans for the plan-scoped tables), so deleting the user really does leave zero
// rows behind — no partial-reset drift between runs.
//
// The numbers below are not decorative. Goal progress, the net-worth figure and the
// sparkline are all recomputed by the app from these rows, so the script models the
// app's own valuation math (lib/finance.ts, lib/depositValuation.ts) in order to (a) print
// the progress percentages it is actually about to produce and (b) write net_worth_snapshots
// that agree with the holdings rather than inventing a shape.

import { createClient } from '@supabase/supabase-js'

// ─── Safety guard ────────────────────────────────────────────────────────────────
// Mirrors e2e/helpers/guard.ts. That module is TypeScript and this is a plain .mjs
// script run by bare `node`, so it cannot be imported — but the rule it encodes is
// exactly the rule this script needs, and this script is *more* destructive than the
// E2E suite (it deletes a user by email, cascading every row they own). Keep the ref
// list in step with e2e/helpers/guard.ts.
const PRODUCTION_PROJECT_REFS = ['nradevujubvvjgcfqlby']

/** Extract the project ref (API subdomain) from a Supabase URL, or null. */
function extractProjectRef(url) {
  if (!url) return null
  const m = url.match(/^https?:\/\/([^.]+)\.supabase\./i)
  return m ? m[1] : null
}

function assertSafeDemoTarget(url) {
  const ref = extractProjectRef(url)
  if (ref != null && PRODUCTION_PROJECT_REFS.includes(ref)) {
    throw new Error(
      `Refusing to seed the demo account against production Supabase project "${ref}". ` +
        `This script DELETES the user at DEMO_EMAIL and every row they own. Point ` +
        `DEMO_SUPABASE_URL at a local stack (http://127.0.0.1:54321).`,
    )
  }
}

// ─── Env ─────────────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.DEMO_SUPABASE_URL
const serviceRoleKey = process.env.DEMO_SUPABASE_SERVICE_ROLE_KEY
const email = process.env.DEMO_EMAIL
const password = process.env.DEMO_PASSWORD
const locale = process.env.DEMO_LOCALE ?? 'vi'

const missing = [
  ['DEMO_SUPABASE_URL', supabaseUrl],
  ['DEMO_SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey],
  ['DEMO_EMAIL', email],
  ['DEMO_PASSWORD', password],
].filter(([, v]) => !v).map(([k]) => k)

if (missing.length > 0) {
  console.error(
    `Missing required env: ${missing.join(', ')}.\n\n` +
      `Run against a local Supabase stack, e.g.\n` +
      `  DEMO_SUPABASE_URL=http://127.0.0.1:54321 \\\n` +
      `  DEMO_SUPABASE_SERVICE_ROLE_KEY=<service_role key from \`supabase start\`> \\\n` +
      `  DEMO_EMAIL=demo@example.com DEMO_PASSWORD='DemoPass123!' \\\n` +
      `  node scripts/seed-demo-account.mjs`,
  )
  process.exit(1)
}

if (!['vi', 'en'].includes(locale)) {
  console.error(`DEMO_LOCALE must be "vi" or "en", got "${locale}".`)
  process.exit(1)
}

assertSafeDemoTarget(supabaseUrl)

// ─── Dates ───────────────────────────────────────────────────────────────────────
// Everything is derived from a single pinned "today" so two runs a week apart still
// produce the same screenshots. UTC throughout, matching the app's valuation cut-off
// (`valuationAsOf` in the dashboard overview route pins to UTC midnight).
const DAY_MS = 86_400_000

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) throw new Error(`DEMO_TODAY must be YYYY-MM-DD, got "${s}"`)
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
}

const iso = (d) => d.toISOString().slice(0, 10)
const ym = (d) => d.toISOString().slice(0, 7)

const TODAY = process.env.DEMO_TODAY
  ? parseDay(process.env.DEMO_TODAY)
  : parseDay(new Date().toISOString().slice(0, 10))

/** UTC date `monthsAgo` months before TODAY, on `day` of that month. */
function monthsAgo(n, day = 1) {
  return new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - n, day))
}

// How far back the history goes. 18 months of monthly buys is enough for the
// net-worth sparkline to have a shape without the chart turning into noise.
const HISTORY_MONTHS = 18
// Monthly plans only cover the recent past — the /planning screen only ever shows one
// month, and every plan month that exists also *realizes* its recurring savings into
// goal progress (lib/finance.ts `realizedRecurringContributions`), so more plans is not
// free. Six is enough to make the recurring lines feel established.
const PLAN_MONTHS = 6

// ─── Reference data ──────────────────────────────────────────────────────────────
// `funds` is a per-user table (user_id NOT NULL, RLS on auth.uid()) and nothing seeds it
// on signup — a new account genuinely has zero funds. So the demo user gets its own
// copies of real Vietnamese funds.
//
// `growth` is a modelled monthly NAV drift used to back-date each fund's NAV. Purchases
// are priced at the back-dated NAV, so the profit/loss the dashboard computes is a real
// consequence of the buy dates rather than a number typed in by hand.
//
// Every seeded fund opts into automatic pricing (nav_auto_sync), which is matched
// on `code` against the upstream feed — so these codes are the real ones, not
// decorative. A code the feed doesn't list would seed a fund that shows a sync
// toggle and then never updates.
const FUNDS = [
  { key: 'DCDS',   code: 'DCDS',     name: 'DC Chứng khoán Năng động',     fund_type: 'equity',   nav: 92450, growth: 0.0090 },
  { key: 'DCBF',   code: 'DCBF',     name: 'DC Trái phiếu Việt Nam',        fund_type: 'debt',     nav: 26180, growth: 0.0050 },
  { key: 'VESAF',  code: 'VESAF',    name: 'VinaCapital VESAF',             fund_type: 'equity',   nav: 31240, growth: 0.0095 },
  { key: 'VEOF',   code: 'VEOF',     name: 'VinaCapital VEOF',              fund_type: 'equity',   nav: 28760, growth: 0.0085 },
  { key: 'SSISCA', code: 'SSISCA',   name: 'SSIAM SSI-SCA',                 fund_type: 'equity',   nav: 34900, growth: 0.0080 },
  { key: 'BCF',    code: 'VCBF-BCF', name: 'VCBF Blue Chip',                fund_type: 'equity',   nav: 36120, growth: 0.0078 },
  { key: 'TBF',    code: 'VCBF-TBF', name: 'VCBF Cân bằng Chiến lược',      fund_type: 'balanced', nav: 29540, growth: 0.0062 },
]

const GOLD_PRICE_PER_CHI = 9_850_000

// ─── Copy ────────────────────────────────────────────────────────────────────────
// Everything a person would have typed into the app, in both locales. Keyed so the
// structural data below (amounts, dates, rates) can stay locale-independent — the two
// tours must show the same money, only in different words.
//
// The three overlapping goal names are copied verbatim from the landing hero's own i18n
// (`landing.mockGoalRetirement` / `mockGoalHouse` / `mockGoalEmergency` in messages/*.json)
// so the hero mockup and the screenshot directly beneath it agree exactly. `displayName`
// follows the hero's `mockUserName` the same way — note it keeps the Vietnamese name and
// merely drops the diacritics for `en` ("Minh Trần" → "Minh Tran"), which is what the hero
// does. The English tour depicts the same Vietnamese user, not a different American one.
const COPY = {
  vi: {
    displayName: 'Minh Trần',
    goals: {
      retire:    { name: 'Hưu trí',          description: 'Tự do tài chính ở tuổi 55' },
      house:     { name: 'Mua nhà',          description: 'Căn hộ 2 phòng ngủ, khu Đông TP.HCM' },
      emergency: { name: 'Quỹ dự phòng',     description: 'Sáu tháng chi phí sinh hoạt' },
      japan:     { name: 'Du lịch Nhật Bản', description: 'Mùa hoa anh đào, cả nhà bốn người' },
    },
    expenses: {
      rent:      'Tiền thuê nhà',
      utilities: 'Điện, nước',
      internet:  'Internet & điện thoại',
      food:      'Ăn uống',
      transport: 'Xăng xe & đi lại',
      school:    'Học phí cho con',
    },
    insurance: {
      self:   { name: 'Minh Trần',      coverage: 'Bảo hiểm nhân thọ' },
      spouse: { name: 'Nguyễn Thu Hà',  coverage: 'Bảo hiểm sức khoẻ' },
      child:  { name: 'Trần Bảo An',    coverage: 'Bảo hiểm giáo dục' },
    },
    recurring: {
      tcb:  'Gửi tiết kiệm Techcombank',
      safe: 'Nạp quỹ dự phòng',
    },
    other: {
      gift:   'Quà sinh nhật',
      repair: 'Sửa xe máy',
    },
    notes: {
      tetBonus:    'Thưởng Tết 2025',
      soldGold:    'Bán vàng tích luỹ',
      rolledOver:  'Chuyển từ sổ tiết kiệm đáo hạn',
      unassigned:  'Chưa gán mục tiêu',
      vcbDeposit:  'Sổ tiết kiệm VCB 24 tháng',
      tcbDeposit:  'Sổ tiết kiệm Techcombank 12 tháng',
      mbDeposit:   'Sổ dự phòng MB 6 tháng',
      acbDeposit:  'Sổ ACB 18 tháng',
      demandCash:  'Tiền mặt gửi không kỳ hạn',
      goldRings:   'Vàng nhẫn SJC 5 chỉ',
    },
  },
  en: {
    displayName: 'Minh Tran',
    goals: {
      retire:    { name: 'Retirement',          description: 'Financial independence at 55' },
      house:     { name: 'House down payment',  description: 'Two-bedroom flat, east Ho Chi Minh City' },
      emergency: { name: 'Emergency fund',      description: 'Six months of living costs' },
      japan:     { name: 'Trip to Japan',       description: 'Cherry blossom season, family of four' },
    },
    expenses: {
      rent:      'Rent',
      utilities: 'Electricity & water',
      internet:  'Internet & phone',
      food:      'Groceries',
      transport: 'Fuel & transport',
      school:    'School fees',
    },
    insurance: {
      self:   { name: 'Minh Tran',      coverage: 'Life insurance' },
      spouse: { name: 'Nguyen Thu Ha',  coverage: 'Health insurance' },
      child:  { name: 'Tran Bao An',    coverage: 'Education insurance' },
    },
    recurring: {
      tcb:  'Techcombank savings',
      safe: 'Emergency fund top-up',
    },
    other: {
      gift:   'Birthday gift',
      repair: 'Motorbike repair',
    },
    notes: {
      tetBonus:    'Tet bonus 2025',
      soldGold:    'Sold accumulated gold',
      rolledOver:  'Rolled over from a matured deposit',
      unassigned:  'Not assigned to a goal',
      vcbDeposit:  'VCB 24-month deposit',
      tcbDeposit:  'Techcombank 12-month deposit',
      mbDeposit:   'MB 6-month emergency deposit',
      acbDeposit:  'ACB 18-month deposit',
      demandCash:  'Cash on demand deposit',
      // No unit in the English note: the app renders the gold unit itself and translates it
      // ("5.0 chỉ" → "5.0 units"), so spelling "chỉ" here would contradict the UI beside it.
      goldRings:   'SJC gold rings',
    },
  },
}

const copy = COPY[locale]

const GOALS = [
  { key: 'retire',    icon: 'mountains', priority: 'med',  target_amount: 3_000_000_000, target_date: ym(monthsAgo(-228)) },
  { key: 'house',     icon: 'home',      priority: 'high', target_amount: 2_000_000_000, target_date: ym(monthsAgo(-60)) },
  { key: 'emergency', icon: 'shield',    priority: 'high', target_amount:   200_000_000, target_date: ym(monthsAgo(-9)) },
  { key: 'japan',     icon: 'cart',      priority: 'low',  target_amount:   150_000_000, target_date: ym(monthsAgo(-5)) },
]

// ─── NAV back-dating ─────────────────────────────────────────────────────────────
// A small deterministic wobble keeps the sparkline from being a ruler-straight line.
// wobble(0) === 0 by construction, so the present-day NAV is exactly `fund.nav`.
const wobble = (m) => Math.sin(m * 1.7) * 0.015

function navAt(fund, m) {
  const drifted = fund.nav / Math.pow(1 + fund.growth, m)
  return Math.round(drifted * (1 + wobble(m)) * 10_000) / 10_000 // numeric(12,4)
}

// ─── Holdings ────────────────────────────────────────────────────────────────────
// Declarative descriptors; expanded into investment_transactions rows below.
//
// A note on the current month: two of the three DCA funds get a *recorded* buy for this
// month (units set) and the third does not. The plan API auto-seeds a pending row for any
// DCA fund with no entry for the plan, so the third one shows up on /planning as an
// un-recorded allocation — which is what a real half-way-through-the-month plan looks
// like. Pending rows carry units = null and are deliberately excluded from net worth.
const CURRENT_MONTH_RECORDED = ['DCDS', 'TBF']

const MONTHLY_BUYS = [
  { fund: 'DCDS',  goal: 'retire', amount:  5_000_000 },
  { fund: 'TBF',   goal: 'retire', amount:  2_000_000 },
  { fund: 'VESAF', goal: 'house',  amount:  3_000_000 },
]

const LUMP_BUYS = [
  { fund: 'SSISCA', goal: 'retire', amount:  80_000_000, m: 17, note: 'tetBonus' },
  { fund: 'VEOF',   goal: 'house',  amount: 150_000_000, m: 15, note: 'soldGold' },
  { fund: 'DCBF',   goal: 'retire', amount:  30_000_000, m: 8,  note: 'rolledOver' },
  { fund: 'BCF',    goal: null,     amount:  50_000_000, m: 6,  note: 'unassigned' },
]

// Bank deposits. `interest_rate` is a percent per year and accrues simple ACT/365 from
// investment_date, capped at expiry_date (lib/finance.ts `calcProjectedInterest`) — so the
// dates below are what makes the accrued-interest figures on screen non-zero.
const DEPOSITS = [
  { goal: 'retire',    amount:  40_000_000, rate: 5.6, m: 12, termMonths: 24, bank: 'VCB',  note: 'vcbDeposit' },
  { goal: 'house',     amount: 300_000_000, rate: 6.2, m: 8,  termMonths: 12, bank: 'TCB',  note: 'tcbDeposit' },
  { goal: 'emergency', amount: 100_000_000, rate: 5.2, m: 5,  termMonths: 6,  bank: 'MB',   note: 'mbDeposit' },
  { goal: 'japan',     amount: 140_000_000, rate: 5.5, m: 14, termMonths: 18, bank: 'ACB',  note: 'acbDeposit' },
  { goal: null,        amount:  80_000_000, rate: 4.8, m: 3,  termMonths: null, note: 'demandCash' },
]

// Gold is valued at units × gold_price_settings.price_per_chi — `units` is chỉ, and
// unit_price is cost basis only (the app never values gold from it).
const GOLD = [
  { goal: 'emergency', chi: 5, pricePerChi: 8_400_000, m: 10, note: 'goldRings' },
]

// `category` is a fixed app-level vocabulary, not prose — it stays the same in both locales.
const FIXED_EXPENSES = [
  { key: 'rent',      amount_vnd: 12_000_000, category: 'housing' },
  { key: 'utilities', amount_vnd:  1_800_000, category: 'utilities' },
  { key: 'internet',  amount_vnd:    600_000, category: 'utilities' },
  { key: 'food',      amount_vnd:  8_000_000, category: 'food' },
  { key: 'transport', amount_vnd:  1_500_000, category: 'transport' },
  { key: 'school',    amount_vnd:  4_500_000, category: 'education' },
]

// annual_payment_vnd drives monthly_premium_vnd (a generated column: annual / 12).
// `relationship` is a fixed vocabulary the forms offer (Self / Spouse / Child / Parent /
// Other) and the app renders it verbatim — so it is data, not copy, and stays untranslated.
const INSURANCE = [
  { key: 'self',   relationship: 'Self',   annual_payment_vnd: 24_000_000, amount_saved_vnd: 14_000_000, paymentInMonths: 4 },
  { key: 'spouse', relationship: 'Spouse', annual_payment_vnd: 18_000_000, amount_saved_vnd:  9_000_000, paymentInMonths: 7 },
  { key: 'child',  relationship: 'Child',  annual_payment_vnd: 12_000_000, amount_saved_vnd:  3_000_000, paymentInMonths: 2 },
]

const RECURRING_SAVINGS = [
  { key: 'tcb',  goal: 'house',     amount_vnd: 5_000_000 },
  { key: 'safe', goal: 'emergency', amount_vnd: 3_000_000 },
]

const OTHER_EXPENSES = [
  { key: 'gift',   amount_vnd: 1_500_000 },
  { key: 'repair', amount_vnd:   800_000 },
]

const SALARY_VND = 58_000_000

// ─── Expand the descriptors into rows ────────────────────────────────────────────
// Built in memory first (with no ids) so the projected valuation can be printed before
// anything is written, and so a mistake in the numbers surfaces as a bad percentage in
// the log rather than as a bad screenshot two steps later.

/** Every fund purchase: { fundKey, goalKey, m, amount, units, unitPrice, note } */
const fundBuys = []
for (const b of MONTHLY_BUYS) {
  const fund = FUNDS.find((f) => f.key === b.fund)
  const skipCurrent = !CURRENT_MONTH_RECORDED.includes(b.fund)
  for (let m = HISTORY_MONTHS - 1; m >= 0; m--) {
    if (m === 0 && skipCurrent) continue
    const unitPrice = navAt(fund, m)
    fundBuys.push({
      fundKey: b.fund,
      goalKey: b.goal,
      m,
      day: 5,
      amount: b.amount,
      units: Math.round((b.amount / unitPrice) * 10_000) / 10_000,
      unitPrice,
      note: null, // recurring buys read better unlabelled — the fund name is the label
    })
  }
}
for (const b of LUMP_BUYS) {
  const fund = FUNDS.find((f) => f.key === b.fund)
  const unitPrice = navAt(fund, b.m)
  fundBuys.push({
    fundKey: b.fund,
    goalKey: b.goal,
    m: b.m,
    day: 12,
    amount: b.amount,
    units: Math.round((b.amount / unitPrice) * 10_000) / 10_000,
    unitPrice,
    note: b.note,
  })
}

// ─── Valuation model (mirrors the app) ───────────────────────────────────────────
// Kept deliberately small: only the paths this seed actually exercises. No withdrawals
// are seeded, so progressValue === currentValue and `affects_progress` never comes up.

/** Simple ACT/365 interest, capped at expiry — lib/finance.ts `calcProjectedInterest`. */
function accruedInterest(amount, rate, startDate, expiryDate, asOf) {
  if (!rate || amount <= 0) return 0
  const end = expiryDate ? Math.min(asOf.getTime(), expiryDate.getTime()) : asOf.getTime()
  const days = Math.max(0, (end - startDate.getTime()) / DAY_MS)
  return amount * (rate / 100) * (days / 365)
}

const depositStart = (d) => monthsAgo(d.m, 8)
const depositExpiry = (d) => (d.termMonths == null ? null : monthsAgo(d.m - d.termMonths, 8))

/** Portfolio value per goal (plus unallocated) as of `asOf`, counting only rows dated by then. */
function valueAsOf(asOf, monthsAgoIndex) {
  const byGoal = new Map(GOALS.map((g) => [g.key, 0]))
  let unallocated = 0
  const add = (goalKey, v) => {
    if (goalKey && byGoal.has(goalKey)) byGoal.set(goalKey, byGoal.get(goalKey) + v)
    else unallocated += v
  }

  for (const b of fundBuys) {
    if (b.m < monthsAgoIndex) continue // not bought yet at this point in history
    const fund = FUNDS.find((f) => f.key === b.fundKey)
    add(b.goalKey, b.units * navAt(fund, monthsAgoIndex))
  }
  for (const d of DEPOSITS) {
    if (d.m < monthsAgoIndex) continue
    const start = depositStart(d)
    add(d.goal, d.amount + accruedInterest(d.amount, d.rate, start, depositExpiry(d), asOf))
  }
  for (const g of GOLD) {
    if (g.m < monthsAgoIndex) continue
    // Historical gold price follows the same back-dating idea as fund NAVs: the seeded
    // purchase price is the honest cost basis, today's price is the settings row.
    const ratio = monthsAgoIndex / Math.max(g.m, 1)
    add(g.goal, g.chi * (GOLD_PRICE_PER_CHI + (g.pricePerChi - GOLD_PRICE_PER_CHI) * Math.min(ratio, 1)))
  }
  // Recurring savings are synthesized straight into goal progress, once per realized
  // plan month they are active in (they have no investment_transactions row at all).
  for (const r of RECURRING_SAVINGS) {
    const realizedMonths = Math.max(0, PLAN_MONTHS - monthsAgoIndex)
    add(r.goal, r.amount_vnd * realizedMonths)
  }
  return { byGoal, unallocated }
}

const today = valueAsOf(TODAY, 0)

// ─── Write ───────────────────────────────────────────────────────────────────────
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Insert and throw on error — a half-seeded account is worse than a loud failure. */
async function insert(table, rows) {
  if (Array.isArray(rows) && rows.length === 0) return []
  const { data, error } = await admin.from(table).insert(rows).select()
  if (error) throw new Error(`insert into ${table} failed: ${error.message}`)
  return data
}

/** Find the demo user by email, paging through the admin list (there is no getByEmail). */
async function findUserByEmail(addr) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const hit = data.users.find((u) => u.email?.toLowerCase() === addr.toLowerCase())
    if (hit) return hit
    if (data.users.length < 200) return null
  }
  return null
}

console.log(`Seeding demo account ${email} at ${supabaseUrl} (today = ${iso(TODAY)}, locale = ${locale})`)

const existing = await findUserByEmail(email)
if (existing) {
  const { error } = await admin.auth.admin.deleteUser(existing.id)
  if (error) throw new Error(`deleteUser failed: ${error.message}`)
  console.log('  Removed the previous demo user (all rows cascaded)')
}

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  // Both keys on purpose: signup writes `full_name`, the profile editor writes
  // `display_name`, and the two surfaces read them differently — app/(app)/layout.tsx
  // takes `display_name || full_name` for the sidebar, while settings/page.tsx reads only
  // `display_name` and otherwise falls back to the email local-part. Setting just one left
  // the sidebar saying "Minh Tran" and the settings page saying "Demo".
  user_metadata: { full_name: copy.displayName, display_name: copy.displayName },
})
if (createErr || !created?.user) throw createErr ?? new Error('Failed to create demo user')
const userId = created.user.id
console.log(`  Created user ${userId}`)

// Goals first — funds.dca_goal_id, recurring_savings.goal_id and every holding point at them.
const goalRows = await insert(
  'savings_goals',
  GOALS.map((g) => ({
    user_id: userId,
    goal_name: copy.goals[g.key].name,
    description: copy.goals[g.key].description,
    target_amount: g.target_amount,
    target_date: g.target_date,
    icon: g.icon,
    priority: g.priority,
  })),
)
const goalId = new Map(
  GOALS.map((g) => [g.key, goalRows.find((r) => r.goal_name === copy.goals[g.key].name).goal_id]),
)

// DCA config lives on the fund row: is_dca + dca_monthly_amount_vnd + dca_goal_id is what
// makes /planning render allocation cards, and what /funds renders in its DCA column.
const dcaByFund = new Map(MONTHLY_BUYS.map((b) => [b.fund, b]))
const fundRows = await insert(
  'funds',
  FUNDS.map((f) => {
    const dca = dcaByFund.get(f.key)
    return {
      user_id: userId,
      name: f.name,
      code: f.code,
      fund_type: f.fund_type,
      nav: f.nav,
      nav_auto_sync: true,
      is_dca: !!dca,
      dca_monthly_amount_vnd: dca ? dca.amount : null,
      dca_goal_id: dca ? goalId.get(dca.goal) : null,
    }
  }),
)
const fundId = new Map(FUNDS.map((f) => [f.key, fundRows.find((r) => r.code === f.code).id]))

await insert('gold_price_settings', { user_id: userId, price_per_chi: GOLD_PRICE_PER_CHI })

await insert(
  'fixed_expenses',
  // effective_from / effective_to stay NULL so the expense applies to every month — the
  // plan API's `.or(...is.null...)` filters treat NULL as "always active".
  FIXED_EXPENSES.map((e) => ({
    user_id: userId,
    expense_name: copy.expenses[e.key],
    amount_vnd: e.amount_vnd,
    category: e.category,
    effective_from: null,
    effective_to: null,
  })),
)

await insert(
  'insurance_members',
  INSURANCE.map((m) => ({
    user_id: userId,
    member_name: copy.insurance[m.key].name,
    relationship: m.relationship,
    coverage_type: copy.insurance[m.key].coverage,
    annual_payment_vnd: m.annual_payment_vnd,
    amount_saved_vnd: m.amount_saved_vnd,
    payment_date: iso(monthsAgo(-m.paymentInMonths, 15)),
  })),
)

const recurringRows = await insert(
  'recurring_savings',
  RECURRING_SAVINGS.map((r) => ({
    user_id: userId,
    name: copy.recurring[r.key],
    goal_id: goalId.get(r.goal),
    amount_vnd: r.amount_vnd,
    effective_from: null,
    effective_to: null,
  })),
)

// Monthly plans, oldest first. Every plan month realizes its recurring savings, which is
// why PLAN_MONTHS is modelled in valueAsOf above.
const planRows = await insert(
  'monthly_plans',
  Array.from({ length: PLAN_MONTHS }, (_, i) => {
    const d = monthsAgo(PLAN_MONTHS - 1 - i)
    return { user_id: userId, month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), salary_vnd: SALARY_VND }
  }),
)
const planIdByYm = new Map(
  planRows.map((p) => [`${p.year}-${String(p.month).padStart(2, '0')}`, p.id]),
)
const currentPlanId = planIdByYm.get(ym(TODAY))

await insert(
  'plan_other_expenses',
  OTHER_EXPENSES.map((e) => ({
    plan_id: currentPlanId,
    description: copy.other[e.key],
    amount_vnd: e.amount_vnd,
  })),
)

// Holdings.
//
// Every row is built through `tx()` so the batch has ONE identical key set. This is not
// tidiness — PostgREST turns a bulk insert into a single multi-row INSERT over the *union*
// of the keys it sees, and any row missing one of those keys is sent an explicit NULL,
// which overrides the column DEFAULT. investment_transactions has six NOT NULL columns that
// exist only by default (transaction_type, is_dca_seeded, affects_progress, currency,
// is_pledged, held_for_merge), so a batch where only the fund rows carry `is_dca_seeded`
// fails with a not-null violation on the deposit rows. Spell every column out instead of
// leaning on defaults that a heterogeneous batch silently discards.
const txDefaults = {
  goal_id: null,
  fund_id: null,
  plan_id: null,
  asset_type: null,
  transaction_type: 'investment',
  investment_date: null,
  expiry_date: null,
  amount_vnd: null,
  units: null,
  unit_price: null,
  interest_rate: null,
  bank_code: null,
  notes: null,
  is_dca_seeded: false,
  affects_progress: true,
  currency: 'VND',
  is_pledged: false,
  held_for_merge: false,
}
const tx = (row) => ({ ...txDefaults, user_id: userId, ...row })

/** Resolve a note key against the active locale's copy table (monthly buys carry none). */
const note = (key) => (key ? copy.notes[key] : null)

const txRows = []
// plan_id is set only where a plan for that month exists — it is nullable, and a buy older
// than the oldest plan simply isn't part of any plan.
for (const b of fundBuys) {
  const date = monthsAgo(b.m, b.day)
  txRows.push(tx({
    goal_id: b.goalKey ? goalId.get(b.goalKey) : null,
    fund_id: fundId.get(b.fundKey),
    plan_id: planIdByYm.get(ym(date)) ?? null,
    asset_type: 'fund',
    investment_date: iso(date),
    amount_vnd: b.amount,
    units: b.units,
    unit_price: b.unitPrice,
    is_dca_seeded: dcaByFund.has(b.fundKey),
    notes: note(b.note),
  }))
}
for (const d of DEPOSITS) {
  const expiry = depositExpiry(d)
  txRows.push(tx({
    goal_id: d.goal ? goalId.get(d.goal) : null,
    // A plan-scoped bank row counts as a *contribution* on /planning; these are standing
    // deposits, so they stay off the plan.
    asset_type: 'bank',
    investment_date: iso(depositStart(d)),
    expiry_date: expiry ? iso(expiry) : null,
    amount_vnd: d.amount,
    interest_rate: d.rate,
    bank_code: d.bank ?? null,
    notes: note(d.note),
  }))
}
for (const g of GOLD) {
  txRows.push(tx({
    goal_id: goalId.get(g.goal),
    asset_type: 'gold',
    investment_date: iso(monthsAgo(g.m, 20)),
    amount_vnd: g.chi * g.pricePerChi,
    units: g.chi,
    unit_price: g.pricePerChi,
    notes: note(g.note),
  }))
}
await insert('investment_transactions', txRows)

// Net-worth snapshots. /api/v1/dashboard/history prefers snapshots and only falls back to
// synthesizing a line from transactions when there are fewer than two — so the sparkline
// is really driven by this table. Each point is the modelled portfolio value at that
// month's end, which keeps the curve consistent with the holdings above instead of being
// a separate invented series. Today's row is written too; the overview route will upsert
// its own value over it on first load, which is fine — by construction they agree.
const snapshots = []
for (let m = HISTORY_MONTHS; m >= 0; m--) {
  const at = m === 0 ? TODAY : monthsAgo(m, 28)
  const v = valueAsOf(at, m)
  const total = [...v.byGoal.values()].reduce((a, b) => a + b, 0) + v.unallocated
  if (total <= 0) continue // the history route drops non-positive points anyway
  snapshots.push({ user_id: userId, snapshot_date: iso(at), total_assets: Math.round(total) })
}
await insert('net_worth_snapshots', snapshots)

// ─── Report ──────────────────────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n))
const netWorth = [...today.byGoal.values()].reduce((a, b) => a + b, 0) + today.unallocated

console.log(`
  Goals           ${goalRows.length}
  Funds           ${fundRows.length} (${MONTHLY_BUYS.length} with DCA on)
  Transactions    ${txRows.length}
  Monthly plans   ${planRows.length} (current: ${ym(TODAY)})
  Recurring       ${recurringRows.length}
  Snapshots       ${snapshots.length}

  Projected net worth  ${fmt(netWorth)} ₫`)

for (const g of GOALS) {
  const v = today.byGoal.get(g.key)
  const pct = Math.min((v / g.target_amount) * 100, 100)
  const name = copy.goals[g.key].name
  console.log(`  ${name.padEnd(20)} ${pct.toFixed(1).padStart(5)}%  (${fmt(v)} / ${fmt(g.target_amount)} ₫)`)
}

// The capture step only photographs the locale that was just seeded — capturing both here
// would put this locale's goal names under the other locale's interface.
console.log(`
Done (${locale}). Start the app against this stack, then capture THIS locale only:
  DEMO_EMAIL=${email} DEMO_PASSWORD=… TOUR_LOCALES=${locale} node scripts/generate-tour-screenshots.mjs`)
