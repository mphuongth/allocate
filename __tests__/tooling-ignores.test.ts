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
// not depend on the generated `.next` build artifact. `.next` enters a normal
// typecheck via TWO paths, and the guard must cover both, because `exclude` only
// blocks one of them:
//   1. Discovery — the base config globs in `.next/types/**`. `exclude` drops it.
//   2. Import — `next-env.d.ts` ends with `import "./.next/dev/types/routes.d.ts"`.
//      `exclude` CANNOT block an imported file, so next-env.d.ts is kept out of the
//      program and replaced by a shim carrying only stable `next` references.
// (The effective graph was verified manually with `tsc --listFilesOnly`: planting a
// broken `.next/dev/types/routes.d.ts` leaves the typecheck at 0 errors and absent
// from the file list. These fast structural assertions lock that wiring in place.)
describe('deterministic typecheck config (#468)', () => {
  // Read as text — tsconfig is JSONC (has comments), which JSON.parse rejects.
  const cfg = readFileSync(path.join(root, 'tsconfig.typecheck.json'), 'utf8')

  it('drops the generated .next artifact from glob discovery', () => {
    expect(cfg).toMatch(/"exclude":\s*\[[^\]]*"\.next"/)
    expect(cfg).not.toMatch(/"include":\s*\[[^\]]*\.next\/types/)
  })

  it('keeps next-env.d.ts (which imports .next route types) out of the program', () => {
    // Covers the import path exclude can't: next-env.d.ts must be excluded AND not
    // re-added through include, or its `.next` route import re-enters the graph.
    expect(cfg).toMatch(/"exclude":\s*\[[^\]]*"next-env\.d\.ts"/)
    expect(cfg).not.toMatch(/"include":\s*\[[^\]]*next-env\.d\.ts/)
  })

  it('substitutes a shim that reintroduces no dependency on .next', () => {
    expect(cfg).toMatch(/"include":\s*\[[^\]]*tsconfig\.typecheck\.d\.ts/)
    const shim = readFileSync(path.join(root, 'tsconfig.typecheck.d.ts'), 'utf8')
    // Drop `//` comment lines but keep `///` triple-slash directives (the references).
    const directives = shim.split('\n').filter((l) => !/^\s*\/\/($|[^/])/.test(l)).join('\n')
    expect(directives).not.toMatch(/\.next/)          // no build-dependent reference/import
    expect(directives).toMatch(/reference types="next"/) // still supplies Next ambient types
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
