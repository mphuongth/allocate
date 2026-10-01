import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

// A PostgREST embed names the related TABLE, and PostgREST picks the foreign
// key itself — only while there is exactly one. investment_transactions points
// at funds through fund_id and, for a deposit's target fund, through
// target_fund_id. With two, a bare `funds(...)` embed is ambiguous (PGRST201):
// the request 400s and the dashboard overview, which reads the whole ledger
// that way, takes every screen down with it.
//
// So every embed of funds names its column: `funds!fund_id(...)`. The hint
// resolves on the schema with one FK as well as with two, so it is safe to
// ship before the second one exists.

const ROOT = path.resolve(__dirname, '../..')
const DIRS = ['app', 'lib', 'features', 'components']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

describe('funds embeds name their foreign key', () => {
  it('no select embeds funds without a !column hint', () => {
    const bare = DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)))
      .flatMap((file) => readFileSync(file, 'utf8').split('\n').map((line, i) => ({ file, line, n: i + 1 })))
      // Inside a select string: preceded by a quote, comma or space, never by `!`.
      .filter(({ line }) => /\.select\(/.test(line) && /['`,\s]funds\(/.test(line))
      .map(({ file, n }) => `${path.relative(ROOT, file)}:${n}`)

    expect(bare).toEqual([])
  })
})
