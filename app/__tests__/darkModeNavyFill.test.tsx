import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { render, screen } from '@testing-library/react'
import { CreateGoalSheet } from '../assets/components/CreateGoalSheet'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

// ── Background ───────────────────────────────────────────────────────────────
// `--c-navy` flips to a light cream (#f8fafc) in dark mode (see globals.css
// `.dark`). A *fill* painted with `var(--c-navy)` that carries white text or a
// white icon therefore becomes white-on-white and disappears in dark mode.
// The design system provides `--c-btn-primary`, which stays dark navy in both
// themes precisely so white foreground stays legible. This is GitHub issue #264.

const APP_DIR = path.resolve(process.cwd(), 'app')

function collectTsx(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      out.push(...collectTsx(full))
    } else if (entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

// Matches `background: 'var(--c-navy)'` including a leading ternary condition,
// e.g. `background: cond ? 'var(--c-navy)' : '...'`. Does NOT match
// `var(--c-navy-tint)` (different token) or `color: 'var(--c-navy)'` (text,
// which flips correctly on tinted surfaces).
const NAVY_FILL = /background:\s*(?:[^,{}\n]*\?\s*)?'var\(--c-navy\)'/

describe('issue #264 — no navy-fill + white-foreground (invisible in dark mode)', () => {
  it('no component fills a surface with var(--c-navy) except the sidebar accent bar', () => {
    const offenders: string[] = []
    for (const file of collectTsx(APP_DIR)) {
      // The sidebar's 3px active-indicator bar is the one allowed use: it
      // carries no foreground content and must stay --c-navy so it reads as a
      // light accent on the dark sidebar (navy would vanish there).
      if (file.replace(/\\/g, '/').endsWith('navigation/Sidebar.tsx')) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (NAVY_FILL.test(line)) {
          offenders.push(`${path.relative(APP_DIR, file)}:${i + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('fund filter chip uses an inverting token (not hardcoded white) for the active label', () => {
    const src = readFileSync(
      path.join(APP_DIR, '(app)/funds/components/MobileFundLibraryView.tsx'),
      'utf8',
    )
    // Active chip background is --c-ink (flips to light in dark mode), so the
    // active label must invert too — `var(--c-card)`, not `#fff`.
    expect(src).not.toMatch(/filter === f\.v \? '#fff'/)
  })

  it('NAV info banner uses theme tokens, not hardcoded light blue', () => {
    for (const rel of [
      '(app)/funds/components/MobileFundLibraryView.tsx',
      '(app)/funds/components/DesktopFundLibraryView.tsx',
    ]) {
      const src = readFileSync(path.join(APP_DIR, rel), 'utf8')
      // Only the banner's surface fill is in scope (the light-blue fund-type
      // chip palette uses a `bg:` key and is a separate, still-legible case).
      expect(src, `${rel} still hardcodes the light-blue banner background`).not.toContain("background: '#eff6ff'")
    }
  })
})

describe('issue #264 — fund-type chips are theme-tokenized', () => {
  // The fund-type palette (equity/debt/balanced/gold) drove chip + icon-tile
  // colours from hardcoded light-pastel hex, which stayed light on the dark
  // canvas. Both the surface and the accent text must come from flipping
  // tokens instead.
  for (const rel of [
    '(app)/funds/components/MobileFundLibraryView.tsx',
    '(app)/funds/components/DesktopFundLibraryView.tsx',
  ]) {
    it(`${rel} TYPE_META uses CSS tokens, not hardcoded hex`, () => {
      const src = readFileSync(path.join(APP_DIR, rel), 'utf8')
      const block = src.match(/const TYPE_META[^=]*=\s*\{([\s\S]*?)\n\}/)
      expect(block, 'TYPE_META block not found').not.toBeNull()
      expect(block![1], 'TYPE_META still has a hardcoded hex colour').not.toMatch(/#[0-9a-fA-F]{6}/)
    })
  }

  it('globals.css defines fund-type tokens with dark-mode overrides', () => {
    const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
    const root = css.slice(css.indexOf(':root'), css.indexOf('@theme inline'))
    const dark = css.slice(css.indexOf('.dark {'), css.indexOf('@layer base'))
    for (const token of ['--c-fund-equity', '--c-fund-debt', '--c-fund-balanced', '--c-fund-gold']) {
      expect(root, `${token} missing from :root`).toContain(token)
      expect(dark, `${token} not overridden in .dark`).toContain(token)
    }
  })
})

describe('issue #264 — --c-btn-primary stays navy in both themes', () => {
  it('globals.css does not redefine --c-btn-primary inside the .dark block', () => {
    const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
    const darkBlock = css.slice(css.indexOf('.dark {'), css.indexOf('@layer base'))
    expect(darkBlock).not.toContain('--c-btn-primary')
  })
})

describe('issue #264 — CreateGoalSheet (new goal modal)', () => {
  it('Create button uses --c-btn-primary so white label survives dark mode', () => {
    render(<CreateGoalSheet open onClose={() => {}} onSuccess={() => {}} />)
    const createBtn = screen.getByRole('button', { name: 'createBtn' })
    expect(createBtn.style.background).toContain('--c-btn-primary')
    expect(createBtn.style.background).not.toContain('--c-navy')
    // Border was also navy and must track the fill.
    expect(createBtn.style.border).not.toContain('--c-navy')
  })

  it('selected goal-icon button uses --c-btn-primary, not --c-navy', () => {
    render(<CreateGoalSheet open onClose={() => {}} onSuccess={() => {}} />)
    // 'target' is the default selected icon.
    const activeIcon = screen.getByTestId('goal-icon-btn-target')
    expect(activeIcon.style.background).toContain('--c-btn-primary')
    expect(activeIcon.style.background).not.toContain('--c-navy')
  })
})
