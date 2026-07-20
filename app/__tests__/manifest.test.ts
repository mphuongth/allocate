import { describe, it, expect, vi } from 'vitest'
import viMessages from '../../messages/vi.json'
import enMessages from '../../messages/en.json'

// The PWA install prompt is the one place the manifest's copy is user-facing, and it was
// English-only on a Vietnamese-by-default app — so a Vietnamese user tapping "Add to home
// screen" got an English pitch. The icons, sizes and start_url stay static; only the human
// copy follows the locale.

const mocks = vi.hoisted(() => ({ locale: 'vi' }))

vi.mock('next-intl/server', () => ({
  getLocale: async () => mocks.locale,
  getTranslations: async () => {
    const messages = (mocks.locale === 'vi' ? viMessages : enMessages) as Record<string, Record<string, string>>
    return (key: string) => messages.meta[key]
  },
}))

const { default: manifest } = await import('../manifest')

describe('manifest', () => {
  it('describes the app in Vietnamese by default', async () => {
    mocks.locale = 'vi'
    expect((await manifest()).description).toContain('quỹ mở')
  })

  it('describes the app in English for an English session', async () => {
    mocks.locale = 'en'
    expect((await manifest()).description).toMatch(/mutual funds/i)
  })

  it('keeps the install-prompt shape the PWA depends on', async () => {
    mocks.locale = 'vi'
    const m = await manifest()
    // These are what make the install prompt appear at all — a locale change must not
    // disturb them.
    expect(m.name).toBe('Cairn')
    expect(m.short_name).toBe('Cairn')
    expect(m.start_url).toBe('/dashboard')
    expect(m.display).toBe('standalone')
    expect(m.icons).toHaveLength(3)
    expect(m.screenshots).toHaveLength(2)
  })
})
