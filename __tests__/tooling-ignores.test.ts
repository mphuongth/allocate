import { readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Regression guard for #469: the tooling configs must exclude the gitignored
// local git worktrees under `.claude/` (stale repo copies other Claude sessions
// check out). Without this, `npm test` / `npm run lint` discover those nested
// *.test files and sources and report failures/errors from a different checkout.
const root = path.resolve(__dirname, '..')

describe('tooling excludes local worktrees (#469)', () => {
  it('vitest.config.ts excludes .claude from test discovery', () => {
    const cfg = readFileSync(path.join(root, 'vitest.config.ts'), 'utf8')
    expect(cfg).toMatch(/exclude:\s*\[[^\]]*\.claude/)
  })

  it('eslint.config.mjs ignores .claude', () => {
    const cfg = readFileSync(path.join(root, 'eslint.config.mjs'), 'utf8')
    expect(cfg).toMatch(/globalIgnores\(\[[^\]]*\.claude/)
  })
})

// Regression guard for #468: the typecheck must be deterministic — its result may
// not depend on the generated `.next` build artifact. The dedicated tsconfig drops
// `.next` from discovery, and a `typecheck` script + CI step keep the gate wired up.
describe('deterministic typecheck config (#468)', () => {
  it('tsconfig.typecheck.json excludes the generated .next artifact', () => {
    // Read as text — tsconfig is JSONC (has comments), which JSON.parse rejects.
    const cfg = readFileSync(path.join(root, 'tsconfig.typecheck.json'), 'utf8')
    expect(cfg).toMatch(/"exclude":\s*\[[^\]]*"\.next"/)
    expect(cfg).not.toMatch(/"include":\s*\[[^\]]*\.next\/types/)
  })

  it('package.json exposes a typecheck script that uses that config', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts.typecheck).toMatch(/tsc --noEmit .*tsconfig\.typecheck\.json/)
  })

  it('CI runs the typecheck command', () => {
    const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
    expect(ci).toMatch(/npm run typecheck/)
  })
})
