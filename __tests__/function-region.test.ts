import { readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Vercel runs every function — the proxy, the pages, the route handlers — in
// `iad1` (Washington, D.C.) unless told otherwise. The database is in Tokyo
// (AWS ap-northeast-1), so each of the half-dozen Supabase round-trips behind a
// dashboard load crossed the Pacific twice, and so did the user's own request
// on its way from the Hong Kong edge. Measured on production before this guard
// existed: a 401 that never touches Supabase took ~400 ms to first byte.
//
// `hnd1` is Vercel's Tokyo region, the one that sits next to the database. If
// the database ever moves, move this with it — the two belong together.
const root = path.resolve(__dirname, '..')
const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
  regions?: string[]
}

describe('Vercel function region', () => {
  it('runs functions in Tokyo, next to the database', () => {
    expect(vercel.regions).toEqual(['hnd1'])
  })
})
