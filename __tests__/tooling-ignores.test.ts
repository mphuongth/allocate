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
    expect(cfg).toMatch(/exclude:\s*\[[^\]]*\.claude/s)
  })

  it('eslint.config.mjs ignores .claude', () => {
    const cfg = readFileSync(path.join(root, 'eslint.config.mjs'), 'utf8')
    expect(cfg).toMatch(/globalIgnores\(\[[^\]]*\.claude/s)
  })
})
