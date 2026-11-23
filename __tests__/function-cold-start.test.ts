import { readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// With the functions moved next to the database (function-region.test.ts), the
// slow request left is the first one after the app has sat idle. Measured on
// production: the dashboard overview took ~1.1 s on a cold instance and
// ~0.3 s on a warm one; right after a deploy the first call took 3.3 s.
//
// Fluid compute is Vercel's answer to that: instances are reused across
// concurrent requests instead of one request each, and the function's compiled
// bytecode is cached between boots. It is a project setting that newer projects
// get by default; pinning it here means the deployment does not depend on when
// the project happened to be created or on a dashboard toggle nobody can review.
const root = path.resolve(__dirname, '..')
const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
  fluid?: boolean
}

describe('Vercel function cold starts', () => {
  it('opts every deployment into Fluid compute', () => {
    expect(vercel.fluid).toBe(true)
  })
})
