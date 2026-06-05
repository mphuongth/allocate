import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { render } from '@testing-library/react'
import { TypeIcon } from '../goalDetailShared'

// ── Issue #268 — "Check Gold icon to update consistence across apps" ──────────
// The gold asset type was drawn two different ways: lucide `Coins` in some
// surfaces and `CircleDollarSign` in others, and its colour was a hardcoded
// amber (#d97706 / #b45309) that stays dark in dark mode. The canonical look is
// the `Coins` glyph tinted with the dark-mode-aware `--c-fund-gold` token.

const APP = path.resolve(process.cwd(), 'app')
const read = (rel: string) => readFileSync(path.join(APP, rel.replace(/\//g, path.sep)), 'utf8')

describe('issue #268 — gold icon is the Coins glyph everywhere', () => {
  it('TypeIcon renders Coins for gold (the user-visible glyph), not CircleDollarSign', () => {
    const { container } = render(<TypeIcon type="gold" />)
    const cls = container.querySelector('svg')?.getAttribute('class') ?? ''
    expect(cls).toContain('lucide-coins')
    expect(cls).not.toContain('circle-dollar-sign')
  })

  // Every surface that draws a gold glyph must map gold → Coins, never
  // CircleDollarSign — in either object-map or inline-JSX form.
  const ICON_FILES = [
    'assets/components/goalDetailShared.tsx',
    'assets/components/SellWithdrawSheet.tsx',
    'assets/components/UnallocatedSection.tsx',
    '(app)/settings/components/DesktopSettingsView.tsx',
    '(app)/settings/components/MobileSettingsView.tsx',
  ]
  for (const rel of ICON_FILES) {
    it(`${rel} never maps gold to CircleDollarSign`, () => {
      const src = read(rel)
      expect(src, 'gold object-map still uses CircleDollarSign').not.toMatch(/gold:\s*CircleDollarSign/)
      expect(src, 'gold JSX still uses CircleDollarSign').not.toMatch(/type === 'gold'\s*\)\s*return\s*<CircleDollarSign/)
      // Settings gold-price rows render the glyph inline next to the DOJI label.
      if (rel.includes('Settings')) {
        expect(src, 'Gold price row still uses CircleDollarSign').not.toMatch(/<CircleDollarSign[^>]*\/>,\s*\n?\s*color/)
      }
    })
  }
})

describe('issue #268 — gold colour is the --c-fund-gold token everywhere', () => {
  // Hardcoded amber stays dark on the dark canvas; the token flips (light:
  // #b45309, dark: #fbbf24). One canonical, theme-aware gold across the app.
  const GOLD_COLOR_LINES: Array<[string, RegExp]> = [
    ['assets/components/goalDetailShared.tsx', /gold:\s*'#d97706'/],
    ['assets/components/NetWorthCard.tsx', /gold:\s*'#d97706'/],
    ['assets/components/DesktopNetWorthPanel.tsx', /gold:\s*\{\s*color:\s*'#d97706'/],
    ['assets/components/AssignGoalSheet.tsx', /gold:\s*'#d97706'/],
    ['assets/components/SellWithdrawSheet.tsx', /gold:\s*'#d97706'/],
    ['assets/components/RecentActivityCard.tsx', /gold:\s*'#b45309'/],
    ['assets/components/UnallocatedSection.tsx', /gold:\s*'#d97706'/],
  ]
  for (const [rel, re] of GOLD_COLOR_LINES) {
    it(`${rel} uses the token for the gold colour`, () => {
      const src = read(rel)
      expect(src, `${rel} still hardcodes the gold colour`).not.toMatch(re)
      expect(src, `${rel} missing --c-fund-gold token`).toContain('var(--c-fund-gold)')
    })
  }

  it('AddTransactionSheet gold chip uses the token, not hardcoded amber', () => {
    const line = read('assets/components/AddTransactionSheet.tsx')
      .split('\n')
      .find((l) => l.includes("v: 'gold'"))
    expect(line, "gold chip definition not found").toBeDefined()
    expect(line!).not.toContain('#b45309')
    expect(line!).toContain('var(--c-fund-gold)')
  })

  it('settings gold-price rows use the token for the gold colour', () => {
    for (const rel of [
      '(app)/settings/components/DesktopSettingsView.tsx',
      '(app)/settings/components/MobileSettingsView.tsx',
    ]) {
      expect(read(rel), `${rel} still hardcodes the gold-price colour`).not.toMatch(/color:\s*'#d97706'/)
    }
  })
})
