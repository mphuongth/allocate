import { defineConfig, devices, type Project, type ReporterDescription } from '@playwright/test'
import { config as dotenvConfig } from 'dotenv'
import { existsSync } from 'fs'
import { SMOKE_TAG } from './e2e/helpers/lanes'

// Load .env.e2e for local runs (ignored in CI where env vars come from secrets)
if (!process.env.CI && existsSync('.env.e2e')) {
  dotenvConfig({ path: '.env.e2e', override: false })
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

// Optional browser channel (e.g. 'msedge') for machines where Playwright's
// bundled Chromium download stalls. Set PLAYWRIGHT_CHANNEL in .env.e2e to use
// a system-installed browser instead. Unset => Playwright's bundled Chromium.
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined

// Which lane to run (#595):
//   E2E_LANE=smoke → only the `@smoke`-tagged tests (the PR gate, ~3 min budget)
//   anything else  → the full suite (nightly / manual, ~7.6 min serial)
// The lanes are mutually exclusive projects, so a bare `npx playwright test`
// never runs the smoke tests twice.
const lane = process.env.E2E_LANE === 'smoke' ? 'smoke' : 'full'

const reporter: ReporterDescription[] = process.env.CI
  ? [['github'], ['html', { open: 'never' }]]
  : [['list'], ['html', { open: 'on-failure' }]]
// Splits failures into infra (database throttling, network, a dead browser) vs.
// product regressions, and checks the smoke lane against its documented budget.
reporter.push(['./e2e/reporters/laneReporter.ts'])

const setupProject: Project = {
  name: 'setup',
  testMatch: /global\.setup\.ts/,
  use: { channel },
}

const desktopUse = {
  ...devices['Desktop Chrome'],
  channel,
  storageState: 'e2e/.auth/session.json',
}

const smokeProject: Project = {
  name: 'smoke',
  use: desktopUse,
  // Every `@smoke` test is a desktop-viewport test; funds.spec.ts is the
  // mobile-only spec and carries no smoke tags.
  testIgnore: ['**/funds.spec.ts'],
  grep: new RegExp(SMOKE_TAG),
  dependencies: ['setup'],
}

const fullProjects: Project[] = [
  {
    name: 'chromium',
    use: desktopUse,
    testIgnore: ['**/funds.spec.ts'],
    dependencies: ['setup'],
  },
  {
    name: 'mobile',
    use: {
      channel,
      viewport: { width: 390, height: 844 },
      storageState: 'e2e/.auth/session.json',
    },
    testMatch: ['**/funds.spec.ts'],
    dependencies: ['setup'],
  },
]

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global.teardown.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Always run serially: the whole suite shares a single authenticated test user
  // (one storageState), so parallel workers race on per-user rows — e.g. two
  // specs inserting the same (user_id, month, year) monthly_plan collide on its
  // unique constraint. CI already used 1 worker; E2E now runs locally too, so
  // keep it serial everywhere rather than relying on the CI default.
  workers: 1,
  reporter,

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Video capture is unreliable with the msedge channel — disable it there.
    video: channel ? 'off' : 'retain-on-failure',
  },

  projects: [setupProject, ...(lane === 'smoke' ? [smokeProject] : fullProjects)],

  webServer: {
    command: process.env.CI ? 'npm start' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
