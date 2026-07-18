// Regenerates the landing-page product tour images (public/tour/*.png).
//
// Same principle as scripts/generate-screenshots.mjs, which this is modelled on: a picture
// of the app has to *be* a picture of the app, so this drives a real browser against a real
// signed-in session rather than rendering a mockup. The account it photographs is built by
// scripts/seed-demo-account.mjs — run that first or the screens come back as empty states.
//
// Usage — with a running app pointed at the seeded stack:
//
//   DEMO_EMAIL=demo@example.com DEMO_PASSWORD='DemoPass123!' \
//   TOUR_LOCALES=vi node scripts/generate-tour-screenshots.mjs
//
// Optional: SCREENSHOT_BASE_URL   (default http://localhost:3000)
//           PLAYWRIGHT_CHANNEL=msedge  (when the bundled Chromium is unavailable)
//           TOUR_LOCALES=vi,en     (default; which locales to capture this run)
//
// TOUR_LOCALES exists because the demo account's *content* has a language too. The goal
// names, expense names and member names are seeded by scripts/seed-demo-account.mjs in one
// language per run (DEMO_LOCALE), and the landing hero directly above the tour renders its
// own goal names from i18n — so English chrome over Vietnamese goal names reads as two
// voices on one page. A full regeneration is therefore two passes:
//
//   seed DEMO_LOCALE=vi → capture TOUR_LOCALES=vi → seed DEMO_LOCALE=en → capture TOUR_LOCALES=en
//
// Capturing both locales in one run is only correct if you genuinely want the seeded
// language under both interfaces; the script warns when you ask for it.
//
// A full regeneration produces 16 images — 4 screens × 2 locales × 2 viewports:
//   public/tour/{screen}-{locale}.png          desktop, 1440×900
//   public/tour/{screen}-{locale}-mobile.png   mobile,  390×844
//
// Both viewports are captured because the tour art-directs rather than scaling: a 1440px
// desktop capture shrunk into a ~350px phone column on the landing page is illegible, and
// the app has genuinely separate mobile components (MobilePlanningView, MobileFundLibraryView,
// …) that are the honest thing to show in a phone frame anyway.

import { chromium } from 'playwright'
import { resolve, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const tourDir = resolve(__dirname, '../public/tour')

const baseURL = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000'
const email = process.env.DEMO_EMAIL
const password = process.env.DEMO_PASSWORD
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined

if (!email || !password) {
  console.error('DEMO_EMAIL and DEMO_PASSWORD are required (the account seeded by scripts/seed-demo-account.mjs).')
  process.exit(1)
}

const LOCALES = (process.env.TOUR_LOCALES ?? 'vi,en').split(',').map((s) => s.trim()).filter(Boolean)

const unknown = LOCALES.filter((l) => !['vi', 'en'].includes(l))
if (unknown.length > 0) {
  console.error(`TOUR_LOCALES may only contain "vi" and "en", got: ${unknown.join(', ')}`)
  process.exit(1)
}
if (LOCALES.length > 1) {
  console.warn(
    `Capturing ${LOCALES.join(' + ')} from a single seed — the demo account's goal and ` +
      `expense names will be in whichever language it was seeded with, under both interfaces. ` +
      `Re-seed per locale (see the README) unless that is what you want.\n`,
  )
}

const VIEWPORTS = [
  { key: 'desktop', width: 1440, height: 900, suffix: '' },
  { key: 'mobile', width: 390, height: 844, suffix: '-mobile' },
]

// Readiness selectors, per screen and per viewport.
//
// Every one of these is locale-independent (a data-testid, or the demo user's own email) —
// the UI text is translated and this script runs in both locales, so keying off words would
// half-work at best. Each selector exists ONLY in its screen's loaded branch, never in the
// skeleton and never in the empty state: /planning and /funds both have an empty state that
// clears the skeleton without rendering these, so an unseeded account times out here rather
// than quietly producing a screenshot of nothing.
//
// These are resolved through `ready()` below, which filters to the *visible* match. That
// matters because the app keeps both layouts in the DOM at once and toggles them with CSS
// (the whole desktop sidebar and the desktop settings view are still mounted at 390px), so
// a bare `.first()` reliably picks the hidden twin and waits forever.
const SCREENS = [
  {
    name: 'dashboard',
    path: '/dashboard',
    ready: {
      desktop: '[data-testid="desktop-net-worth-panel"]',
      mobile: '[data-testid="net-worth-card"]',
    },
    // The net-worth history is a second request after the overview resolves, and the
    // sparkline is the point of this screenshot — wait for the drawn line, not just the card.
    extra: {
      desktop: '[data-testid="desktop-net-worth-panel"] svg polyline',
      mobile: '[data-testid="net-worth-card"] svg polyline',
    },
  },
  {
    name: 'planning',
    path: '/planning',
    ready: {
      desktop: '[data-testid="desktop-planning"] [data-testid="planning-summary-strip"]',
      mobile: '[data-testid="planning-alloc-card"]',
    },
  },
  {
    name: 'funds',
    path: '/funds',
    ready: {
      desktop: '[data-testid="desktop-funds-table"]',
      mobile: '[data-testid="mobile-funds"] [data-testid^="fund-card-"]',
    },
  },
  {
    name: 'settings',
    path: '/settings',
    ready: {
      desktop: '[data-testid="desktop-profile-card"]',
      // MobileSettingsView carries no testid. /settings has no client data fetch — the
      // profile is a server prop — so the email being on screen is proof the real view
      // rendered and not the route-level skeleton.
      mobile: `text=${email}`,
    },
  },
]

// `next dev` paints a floating dev-tools button bottom-left. It is not part of the app and
// must not be baked into an image we ship on the landing page. Re-applied after every
// navigation, since a style tag belongs to the document it was added to.
const HIDE_DEV_TOOLS = 'nextjs-portal, [data-nextjs-dev-tools-button] { display: none !important; }'

/** The one visible match for a readiness selector — see the note on SCREENS. */
const ready = (page, selector) => page.locator(selector).filter({ visible: true }).first()

mkdirSync(tourDir, { recursive: true })

const hostname = new URL(baseURL).hostname
const browser = await chromium.launch({ channel })

try {
  for (const { key: viewportKey, width, height, suffix } of VIEWPORTS) {
    const isMobile = viewportKey === 'mobile'

    for (const locale of LOCALES) {
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile,
        hasTouch: isMobile,
      })

      // i18n/request.ts reads the locale from a `locale` cookie on every request, so this
      // has to be in place before the first navigation — otherwise the login page and the
      // first screen render in the default locale (vi).
      await context.addCookies([{ name: 'locale', value: locale, domain: hostname, path: '/' }])

      const page = await context.newPage()

      await page.goto(`${baseURL}/auth/login`)
      await page.locator('#email').fill(email)
      await page.locator('#password').fill(password)
      await page.locator('button[type="submit"]').click()
      await page.waitForURL('**/dashboard', { timeout: 30_000 })

      for (const screen of SCREENS) {
        await page.goto(`${baseURL}${screen.path}`)

        await ready(page, screen.ready[viewportKey]).waitFor({ state: 'visible', timeout: 30_000 })
        if (screen.extra) {
          await ready(page, screen.extra[viewportKey]).waitFor({ state: 'visible', timeout: 30_000 })
        }

        // Money keeps arriving after the first element does (the dashboard's Recent activity
        // card is the slowest), and the charts animate in. Settle before capturing.
        await page.waitForLoadState('networkidle', { timeout: 30_000 })
        await page.waitForTimeout(1500)

        await page.addStyleTag({ content: HIDE_DEV_TOOLS })

        const name = `${screen.name}-${locale}${suffix}.png`
        await page.screenshot({ path: resolve(tourDir, name), scale: 'css' })
        console.log(`Captured public/tour/${name} (${width}×${height})`)
      }

      await context.close()
    }
  }
} finally {
  await browser.close()
}
