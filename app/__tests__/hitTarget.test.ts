import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

// `.hit-44` grows a control's tappable area to at least 44×44 (Apple HIG,
// WCAG 2.5.5) without growing what you see: an invisible ::after, centred on
// the control, is what the finger lands on (#766). It is for compact chips and
// pills whose visual size is part of the design; a bare icon button can just
// take minWidth/minHeight 44 the way the rest of the app does.
describe('.hit-44 (#766)', () => {
  const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')

  it('anchors the hit area to the control', () => {
    expect(css).toMatch(/\.hit-44\s*\{[^}]*position:\s*relative/)
  })

  it('makes the hit area at least 44px each way, centred', () => {
    const after = css.match(/\.hit-44::after\s*\{([^}]*)\}/)
    expect(after, '.hit-44::after missing').not.toBeNull()
    const rule = after![1]
    expect(rule).toMatch(/content:\s*''/)
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/width:\s*max\(100%,\s*44px\)/)
    expect(rule).toMatch(/height:\s*max\(100%,\s*44px\)/)
    expect(rule).toMatch(/translate\(-50%,\s*-50%\)/)
  })
})
