import { describe, it, expect } from 'vitest'
import vi from '@/messages/vi.json'
import en from '@/messages/en.json'

// The Funds price banner tells you which button fetches new prices. On mobile
// that button is only the ↻ icon — its name lives in aria-label — so copy that
// said "Nhấn “Làm mới giá”" pointed at a label nobody could see, and the English
// said "Click" on a touch screen (#764). The copy names the button the way it
// looks, in a verb that fits a tap and a click alike.
describe('funds.navInfoDesc (#764)', () => {
  for (const [locale, messages] of [['vi', vi], ['en', en]] as const) {
    const desc = messages.funds.navInfoDesc
    const label = messages.funds.refreshNav

    it(`${locale}: points at the ↻ icon the button shows`, () => {
      expect(desc).toContain('↻')
    })

    it(`${locale}: does not name the button by its hidden label`, () => {
      expect(desc).not.toContain(label)
      expect(desc).not.toContain('{refreshNav}')
    })
  }

  it('en: does not say "Click", which is wrong on a phone', () => {
    expect(en.funds.navInfoDesc).not.toMatch(/\bclick\b/i)
  })
})
