import { describe, it, expect } from 'vitest'
import { buildStructuredData, SITE_URL } from '../seo'
import viMessages from '../../messages/vi.json'
import enMessages from '../../messages/en.json'

// The JSON-LD block that tells search engines what this site *is*, rather than leaving them
// to infer it from prose. Without it Cairn is just another page; with it a finance app with
// a price, a platform and a language.
//
// Pure-function tests, like buildSiteMetadata: the object is the thing that has to be right.

function translator(locale: 'vi' | 'en') {
  const messages = (locale === 'vi' ? viMessages : enMessages) as Record<string, Record<string, string>>
  return (key: string) => messages.meta[key]
}

describe('buildStructuredData', () => {
  it('declares itself as a finance application', () => {
    const d = buildStructuredData('vi', translator('vi'))
    expect(d['@context']).toBe('https://schema.org')
    expect(d['@type']).toBe('WebApplication')
    expect(d.applicationCategory).toBe('FinanceApplication')
  })

  it('names and describes the app in the page locale', () => {
    expect(buildStructuredData('vi', translator('vi')).description).toContain('quỹ mở')
    expect(buildStructuredData('en', translator('en')).description).toMatch(/mutual funds/i)
  })

  it('advertises the price, because "free" is the question a visitor has', () => {
    const offer = buildStructuredData('vi', translator('vi')).offers
    expect(offer.price).toBe('0')
    expect(offer.priceCurrency).toBe('VND')
  })

  it('points at the production origin, not the current deployment', () => {
    expect(buildStructuredData('vi', translator('vi')).url).toBe(`${SITE_URL}/`)
  })

  it('reports the locale it was built for', () => {
    expect(buildStructuredData('vi', translator('vi')).inLanguage).toBe('vi-VN')
    expect(buildStructuredData('en', translator('en')).inLanguage).toBe('en-US')
  })

  it('serialises to JSON that cannot break out of the script tag', () => {
    // A raw `<` in a JSON-LD payload can terminate the <script> element early. The values
    // are ours today, but they come from a translation catalogue anyone can edit.
    const json = JSON.stringify(buildStructuredData('vi', translator('vi')))
    expect(json).not.toContain('</')
  })
})
