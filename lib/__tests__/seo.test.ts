import { describe, it, expect } from 'vitest'
import { buildSiteMetadata, SITE_URL } from '../seo'
import { config as proxyConfig } from '../../proxy'
import viMessages from '../../messages/vi.json'
import enMessages from '../../messages/en.json'

// What a search engine and a Zalo/Facebook scraper actually see. Before this, the app's
// public HTML carried a bare `<title>Cairn</title>` and an English description — while the
// signed-in screens, which no crawler can even reach, localized their titles properly.
//
// These are pure-function tests on purpose: the metadata object is the thing that has to be
// right, and asserting it here is far cheaper (and catches more) than booting Next to scrape
// its own <head>.

// Stands in for next-intl's `t`, reading the real message catalogues so the assertions are
// pinned to shipped copy rather than to strings invented in the test.
function translator(locale: 'vi' | 'en') {
  const messages = (locale === 'vi' ? viMessages : enMessages) as Record<string, Record<string, string>>
  return (key: string) => messages.meta[key]
}

// `title` is the {template, default} pair the signed-in screens compose against, not a
// bare string — the default is what a crawler renders for the landing page itself.
const titleOf = (m: ReturnType<typeof buildSiteMetadata>) =>
  (m.title as { default: string }).default

describe('buildSiteMetadata — locale', () => {
  it('describes the app in Vietnamese on the Vietnamese page', () => {
    const m = buildSiteMetadata('vi', translator('vi'))
    expect(titleOf(m)).toBe('Cairn – Quản lý tài sản & lập kế hoạch tài chính cá nhân')
    expect(m.description).toContain('quỹ mở, tiền gửi và vàng')
  })

  it('keeps the template so signed-in screens still read "Overview | Cairn"', () => {
    expect((buildSiteMetadata('vi', translator('vi')).title as { template: string }).template)
      .toBe('%s | Cairn')
  })

  it('describes the app in English on the English page', () => {
    const m = buildSiteMetadata('en', translator('en'))
    expect(titleOf(m)).toMatch(/Cairn/)
    expect(m.description).toMatch(/mutual funds, deposits, and gold/i)
    // The default locale is Vietnamese (i18n/request.ts), so it is the easiest thing to
    // leak into the English page.
    expect(m.description).not.toContain('mục tiêu')
  })
})

describe('buildSiteMetadata — social sharing', () => {
  // Cairn spreads by word of mouth, and in Vietnam that means Zalo, Messenger and
  // Facebook. Without these tags a shared link renders as a bare URL.
  it('carries an Open Graph card with an absolute image', () => {
    const og = buildSiteMetadata('vi', translator('vi')).openGraph!
    expect(og.title).toBeTruthy()
    expect(og.description).toBeTruthy()
    const image = Array.isArray(og.images) ? og.images[0] : og.images
    const url = typeof image === 'string' ? image : (image as { url: string }).url
    // Relative OG URLs are silently dropped by several scrapers.
    expect(url).toMatch(/^https:\/\//)
  })

  it('declares the image dimensions scrapers use to lay the card out', () => {
    const og = buildSiteMetadata('vi', translator('vi')).openGraph!
    const image = (Array.isArray(og.images) ? og.images[0] : og.images) as { width: number; height: number }
    expect(image.width).toBe(1200)
    expect(image.height).toBe(630)
  })

  it('carries a Twitter summary card', () => {
    const tw = buildSiteMetadata('vi', translator('vi')).twitter!
    expect(tw.card).toBe('summary_large_image')
    expect(tw.title).toBeTruthy()
  })

  it('sets metadataBase so relative URLs resolve against production', () => {
    // Without this Next warns and emits relative OG URLs; on a preview deployment it
    // would otherwise resolve them against the preview host.
    expect(buildSiteMetadata('vi', translator('vi')).metadataBase?.toString()).toContain(SITE_URL.replace('https://', ''))
  })
})

describe('buildSiteMetadata — canonical and alternates', () => {
  it('points the canonical at production, not the current deployment', () => {
    expect(buildSiteMetadata('vi', translator('vi')).alternates?.canonical).toBe('/')
  })

  it('advertises both language variants', () => {
    const langs = buildSiteMetadata('vi', translator('vi')).alternates?.languages ?? {}
    expect(Object.keys(langs)).toEqual(expect.arrayContaining(['vi', 'en']))
  })
})

describe('proxy matcher — crawler files must not be swallowed', () => {
  // robots.txt and sitemap.xml were both answering 307 → /auth/login in production: the
  // matcher excluded sw.js and manifest.webmanifest but not these two, so the auth
  // middleware redirected the crawler instead of serving the file.
  const matcher = new RegExp(proxyConfig.matcher[0])

  it('lets robots.txt and sitemap.xml through', () => {
    expect(matcher.test('/robots.txt')).toBe(false)
    expect(matcher.test('/sitemap.xml')).toBe(false)
  })

  it('still guards the signed-in app', () => {
    expect(matcher.test('/dashboard')).toBe(true)
    expect(matcher.test('/planning')).toBe(true)
    expect(matcher.test('/settings')).toBe(true)
  })

  it('still leaves the landing page and static assets alone where it did before', () => {
    expect(matcher.test('/')).toBe(true)
    expect(matcher.test('/sw.js')).toBe(false)
    expect(matcher.test('/manifest.webmanifest')).toBe(false)
    expect(matcher.test('/icon-192.png')).toBe(false)
  })
})
