// Regenerates the PWA manifest screenshots (public/screenshot-{desktop,mobile}.png).
//
// These used to be hand-drawn SVGs rendered through `sharp` — a picture of an app that
// never existed. They drifted badly: the committed images still showed an "Asset Overview"
// page with a green theme, English copy and a "C" logo, none of which the product has had
// for months. A picture of the app has to *be* a picture of the app, so this drives a real
// browser against a real signed-in session and captures the real Overview screen.
//
// Usage — with the app running (npm run dev) and an account that has some data on it:
//
//   SCREENSHOT_EMAIL=... SCREENSHOT_PASSWORD=... node scripts/generate-screenshots.mjs
//
// Optional: SCREENSHOT_BASE_URL   (default http://localhost:3000)
//           PLAYWRIGHT_CHANNEL=msedge  (when the bundled Chromium is unavailable)
//
// Use a throwaway account: whatever is on screen ships publicly in the install prompt.

import { chromium } from 'playwright'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '../public')

const baseURL = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000'
const email = process.env.SCREENSHOT_EMAIL
const password = process.env.SCREENSHOT_PASSWORD
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined

if (!email || !password) {
  console.error('SCREENSHOT_EMAIL and SCREENSHOT_PASSWORD are required.')
  process.exit(1)
}

// Sizes must stay in step with the `screenshots` entries in app/manifest.ts.
const TARGETS = [
  { name: 'screenshot-desktop.png', width: 1280, height: 800 },
  { name: 'screenshot-mobile.png', width: 390, height: 844 },
]

const browser = await chromium.launch({ channel })

try {
  for (const { name, width, height } of TARGETS) {
    const isMobile = width < 768
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile,
      hasTouch: isMobile,
    })
    const page = await context.newPage()

    await page.goto(`${baseURL}/auth/login`)
    await page.locator('input[type=email]').fill(email)
    await page.locator('input[type=password]').fill(password)
    await page.locator('button[type=submit]').click()
    await page.waitForURL('**/dashboard', { timeout: 30_000 })

    // Overview renders its money only once the overview API resolves — screenshotting any
    // earlier captures the loading skeleton (the Recent activity card is the slowest, and
    // showed "0 giao dịch" + a skeleton row when we only waited on the net-worth figure).
    await page.locator('text=/₫/').first().waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 30_000 })
    await page.waitForTimeout(1500)

    // `next dev` paints a floating dev-tools button bottom-left. It is not part of the app
    // and must not be baked into an image we ship in the install prompt.
    await page.addStyleTag({ content: 'nextjs-portal, [data-nextjs-dev-tools-button] { display: none !important; }' })

    await page.screenshot({ path: resolve(publicDir, name), scale: 'css' })
    console.log(`Captured public/${name} (${width}×${height})`)

    await context.close()
  }
} finally {
  await browser.close()
}
