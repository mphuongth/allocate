// Renders the Open Graph card — public/og-image.png, 1200×630.
//
// This is the picture that shows up when someone drops a Cairn link into Zalo, Messenger
// or Facebook, which is how the app actually spreads. Before it existed a shared link
// rendered as a bare URL with no title and no image.
//
// Rendered through a real browser rather than `next/og` for one concrete reason: the copy
// is Vietnamese, and getting "Đầu tư theo mục tiêu" to draw correctly means real font
// shaping with the real webfont. Satori needs the font handed to it as a buffer, and the
// only faces vendored in this repo are Roboto .woff files used by the PDF exporter — so a
// browser that already knows how to fetch and shape Be Vietnam Pro is both simpler and
// safer than trusting a fallback face to carry Vietnamese diacritics.
//
// The card composes the real dashboard capture from the product tour, so it stays honest
// the same way the tour does: regenerate it whenever those screenshots change.
//
// Usage (no dev server needed — this renders a standalone HTML string):
//
//   node scripts/generate-og-image.mjs
//
// Optional: PLAYWRIGHT_CHANNEL=msedge   (when the bundled Chromium is unavailable)

import { chromium } from 'playwright'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '../public')

const WIDTH = 1200
const HEIGHT = 630

// Vietnamese, because the site defaults to Vietnamese (i18n/request.ts) and a scraper
// sends no locale cookie — so this is the card the overwhelming majority of shares get.
// Kept in step with `meta.title` / `meta.description` in messages/vi.json by hand: this
// runs outside Next, so it can't read the catalogue through next-intl.
// The brand name is drawn separately as the wordmark, so the headline drops the "Cairn – "
// prefix that `meta.title` carries.
const TITLE = 'Quản lý tài sản & lập kế hoạch tài chính cá nhân'
const TAGLINE = 'Theo dõi tài sản, quỹ mở, tiền gửi và vàng. Lập kế hoạch đầu tư, nghỉ hưu và đạt mục tiêu tài chính.'

// The app screenshot the card is built around — the same capture the landing tour shows.
const SHOT = resolve(publicDir, 'tour/dashboard-vi.png')
if (!existsSync(SHOT)) {
  console.error(`Missing ${SHOT}. Generate the tour screenshots first — see README, "Regenerating the product tour screenshots".`)
  process.exit(1)
}
const shotDataUri = `data:image/png;base64,${readFileSync(SHOT).toString('base64')}`

// Brand palette, matching app/page.tsx.
const NAVY = '#0F2A4A'
const EMERALD = '#10B981'

const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    font-family: 'Be Vietnam Pro', sans-serif;
    background: ${NAVY};
    background-image: radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px);
    background-size: 28px 28px;
    display: flex; align-items: center;
    position: relative;
  }
  /* Warm light from the upper left so the flat navy doesn't read as a dead rectangle. */
  body::before {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(120% 90% at 8% 0%, rgba(16,185,129,0.18), transparent 60%);
  }
  .copy {
    position: relative; z-index: 2;
    width: 690px; padding: 0 0 0 68px; flex-shrink: 0;
  }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 40px; }
  .wordmark { font-size: 40px; font-weight: 700; color: #fff; letter-spacing: -0.03em; }
  h1 {
    font-size: 47px; font-weight: 700; color: #fff;
    letter-spacing: -0.04em; line-height: 1.06; margin-bottom: 26px;
  }
  p { font-size: 23px; line-height: 1.5; color: rgba(255,255,255,0.62); }
  .rule { width: 76px; height: 5px; border-radius: 99px; background: ${EMERALD}; margin-bottom: 34px; }
  /* The real app, bleeding off the right edge — cropped rather than shrunk, so the UI
     stays legible at the size a timeline thumbnail renders. */
  .shot {
    position: absolute; z-index: 1;
    top: 62px; left: 730px;
    width: 730px; height: 476px;
    border-radius: 14px 0 0 14px;
    overflow: hidden;
    box-shadow: 0 30px 90px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.09);
  }
  .shot img { width: 1140px; height: auto; display: block; }
</style>
</head>
<body>
  <div class="copy">
    <div class="brand">
      <svg width="52" height="44" viewBox="110 180 283 240" xmlns="http://www.w3.org/2000/svg">
        <rect x="111.872" y="359.936" width="280.064" height="57.856" rx="24.3" fill="#3B5A82"/>
        <rect x="152.064" y="293.888" width="220.16" height="50.176" rx="21.07" fill="#163A61"/>
        <rect x="163.84" y="233.984" width="167.936" height="44.032" rx="18.49" fill="${EMERALD}"/>
        <rect x="208.128" y="181.76" width="103.936" height="35.84" rx="15.05" fill="#F8FAFC"/>
      </svg>
      <span class="wordmark">Cairn</span>
    </div>
    <div class="rule"></div>
    <h1>${TITLE}</h1>
    <p>${TAGLINE}</p>
  </div>
  <div class="shot"><img src="${shotDataUri}" alt=""></div>
</body>
</html>`

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'networkidle' })
  // Webfonts resolve after networkidle in some runs; without this the card can be captured
  // in the fallback face, which is exactly where the Vietnamese diacritics go wrong.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)

  const out = resolve(publicDir, 'og-image.png')
  await page.screenshot({ path: out, scale: 'css' })
  console.log(`Wrote public/og-image.png (${WIDTH}×${HEIGHT})`)
} finally {
  await browser.close()
}
