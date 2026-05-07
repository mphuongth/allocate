import { defineConfig, devices } from '@playwright/test'
import { config as dotenvConfig } from 'dotenv'
import { existsSync } from 'fs'

// Load .env.e2e for local runs (ignored in CI where env vars come from secrets)
if (!process.env.CI && existsSync('.env.e2e')) {
  dotenvConfig({ path: '.env.e2e', override: false })
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'on-failure' }]],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/session.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: process.env.CI ? 'npm start' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
