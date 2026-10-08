import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

// The Overview colours a slice by ASSET type (Quỹ, Tiết kiệm, Cổ phiếu…); the
// Funds page colours a card by FUND type (Cổ phiếu, Trái phiếu, Cân bằng). The
// two used to share hues — Quỹ and Trái phiếu were the same blue, Tiết kiệm and
// Cổ phiếu the same green — so a colour meant one thing on one tab and another
// thing on the next (#762). Gold and ETF are the exception on purpose: a gold
// fund and the gold slice, an ETF fund and the ETF slice, are the same idea.

const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
const root = css.slice(css.indexOf(':root'), css.indexOf('@theme inline'))
const dark = css.slice(css.indexOf('.dark {'), css.indexOf('@layer base'))

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`${name} has no hex value`)
  return m[1]
}

function hsl(hex: string): { h: number; s: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: (h * 60 + 360) % 360, s }
}

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

// The asset slices as the Overview draws them: the hexes in ALLOC_COLORS, plus
// the gold and ETF tokens it borrows. Asset colours are the same in both themes.
const allocSrc = readFileSync(path.join(process.cwd(), 'app/assets/components/NetWorthCard.tsx'), 'utf8')
const allocBlock = allocSrc.match(/ALLOC_COLORS = \{([\s\S]*?)\}/)![1]
const assetHexes = [...allocBlock.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0])

describe('fund-type colours (#762)', () => {
  it('finds the asset palette it compares against', () => {
    expect(assetHexes.length).toBeGreaterThanOrEqual(3)
  })

  for (const [theme, block] of [['light', root], ['dark', dark]] as const) {
    const assets = [...assetHexes, token(root, '--c-fund-gold'), token(root, '--c-fund-etf')]
    if (theme === 'dark') assets.push(token(dark, '--c-fund-gold'), token(dark, '--c-fund-etf'))

    for (const fundType of ['equity', 'debt', 'balanced']) {
      it(`--c-fund-${fundType} (${theme}) is not an asset-type hue`, () => {
        const c = hsl(token(block, `--c-fund-${fundType}`))
        // A grey has no hue to confuse; it reads as "neither".
        if (c.s < 0.25) return
        for (const a of assets) {
          const ac = hsl(a)
          expect(hueGap(c.h, ac.h), `--c-fund-${fundType} is within 30° of asset colour ${a}`).toBeGreaterThanOrEqual(30)
        }
      })
    }
  }
})
