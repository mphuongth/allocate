import { describe, it, expect } from 'vitest'
import { Sun, Moon, Settings, Globe, TrendingUp, Coins } from 'lucide-react'
import {
  themeOptions, themeLabel, localeOptions, localeLabel, priceSources,
} from '../settingsOptions'

// The views pass next-intl's `t`; echoing the key is enough to prove which
// message each option asks for, without pulling the catalogue in.
const t = (key: string) => key

describe('themeOptions', () => {
  it('offers light, dark and system, in that order', () => {
    expect(themeOptions(t).map(o => o.value)).toEqual(['light', 'dark', 'system'])
  })

  it('labels each choice from the settings catalogue', () => {
    expect(themeOptions(t).map(o => o.label))
      .toEqual(['appearanceLight', 'appearanceDark', 'appearanceSystem'])
  })

  // The icon travels as a component, not an element: desktop renders it at 13px
  // and the mobile sheet at 18px, and that is the only thing they differed on.
  it('carries the icon as a component the caller sizes', () => {
    expect(themeOptions(t).map(o => o.Icon)).toEqual([Sun, Moon, Settings])
  })
})

describe('themeLabel', () => {
  it('is the label of the matching option', () => {
    expect(themeLabel('dark', t)).toBe('appearanceDark')
    expect(themeLabel('light', t)).toBe('appearanceLight')
    expect(themeLabel('system', t)).toBe('appearanceSystem')
  })

  // Mobile's row summary was a hand-written if/else chain beside the sheet's own
  // option list — two places to update to add a choice. Reading it off the list
  // is what keeps them from disagreeing.
  it('agrees with the option list for every choice', () => {
    for (const option of themeOptions(t)) {
      expect(themeLabel(option.value, t)).toBe(option.label)
    }
  })
})

describe('localeOptions', () => {
  it('offers English and Vietnamese', () => {
    expect(localeOptions(t).map(o => o.value)).toEqual(['en', 'vi'])
    expect(localeOptions(t).map(o => o.label)).toEqual(['languageEnglish', 'languageVietnamese'])
  })

  it('carries the globe icon for each', () => {
    expect(localeOptions(t).map(o => o.Icon)).toEqual([Globe, Globe])
  })
})

describe('localeLabel', () => {
  it('is the label of the matching option', () => {
    expect(localeLabel('vi', t)).toBe('languageVietnamese')
    expect(localeLabel('en', t)).toBe('languageEnglish')
  })

  // The app only ever serves 'en' and 'vi'; anything else is a misconfiguration,
  // and English is what the rest of the app falls back to.
  it('falls back to English for an unknown locale', () => {
    expect(localeLabel('fr', t)).toBe('languageEnglish')
  })
})

describe('priceSources', () => {
  it('lists what a sync refreshes, with its label and note', () => {
    expect(priceSources(t)).toEqual([
      { key: 'nav',  label: 'fundNav',   note: 'fundNavNote', color: '#2563eb',            Icon: TrendingUp },
      { key: 'gold', label: 'goldPrice', note: 'goldNote',    color: 'var(--c-fund-gold)', Icon: Coins },
    ])
  })

  // #264: colours come from theme tokens, not hard-coded hex — except this one
  // blue, which predates the token set and is checked here so the exception is
  // visible rather than silently copied into a third place.
  it('uses the gold token for the gold row', () => {
    expect(priceSources(t).find(s => s.key === 'gold')?.color).toMatch(/^var\(--/)
  })
})
