import { readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Guard for #596: CI used to gate merges on typecheck + unit tests alone, so a
// broken migration, a lint error, a build failure, or a dead smoke path could
// merge — and the production migration job shipped on that same thin signal.
// These assertions lock in the shape of the gate: five independently-reported
// jobs, and a production deploy that waits on all of them.
//
// Read the workflow as text rather than parsing YAML — the repo has no YAML
// parser dependency, and the questions here ("is there a job called X", "what
// does migrate need") are answerable structurally without one.
const root = path.resolve(__dirname, '..')
const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')

/** Top-level job ids: keys indented exactly two spaces under `jobs:`. */
function jobIds(workflow: string): string[] {
  const jobs = workflow.slice(workflow.indexOf('\njobs:'))
  return [...jobs.matchAll(/^ {2}([a-z0-9][a-z0-9-]*):$/gm)].map((m) => m[1])
}

/** The `needs:` entries of a job, whether written inline or as a list. */
function needsOf(workflow: string, job: string): string[] {
  const start = workflow.indexOf(`\n  ${job}:\n`)
  expect(start, `job "${job}" not found`).toBeGreaterThan(-1)
  const block = workflow.slice(start + 1)
  const inline = block.match(/^ {4}needs:\s*\[([^\]]*)\]/m)
  if (inline) return inline[1].split(',').map((s) => s.trim()).filter(Boolean)
  const single = block.match(/^ {4}needs:\s*([a-z0-9-]+)\s*$/m)
  return single ? [single[1]] : []
}

describe('CI quality gates (#596)', () => {
  it('reports unit, lint, build, DB and smoke-E2E status as independent jobs', () => {
    // One job per gate: a red X on the PR names the thing that broke instead of
    // collapsing every check into "Unit Tests".
    expect(jobIds(ci)).toEqual(expect.arrayContaining(['test', 'lint', 'build', 'db', 'e2e-smoke']))
  })

  it('runs lint and a production build on every PR', () => {
    expect(ci).toMatch(/npm run lint/)
    expect(ci).toMatch(/npm run build/)
  })

  it('exercises the SQL suite against a Supabase stack started from scratch', () => {
    // `supabase start` on a fresh runner replays every migration onto an empty
    // database, so this is also the "migrations apply cleanly" gate.
    expect(ci).toMatch(/supabase start/)
    expect(ci).toMatch(/npm run test:db/)
  })

  it('enforces unit-test coverage rather than running bare vitest', () => {
    expect(ci).toMatch(/npm run test:coverage/)
  })

  it('gates the production migration push on every check, not just unit tests', () => {
    // The migrate job writes to the production schema. Anything that can fail
    // must be able to stop it.
    expect(needsOf(ci, 'migrate')).toEqual(
      expect.arrayContaining(['test', 'lint', 'build', 'db', 'e2e-smoke']),
    )
    expect(ci).toMatch(/supabase db push/)
  })
})

describe('coverage configuration (#596)', () => {
  const cfg = readFileSync(path.join(root, 'vitest.config.ts'), 'utf8')

  it('measures every application/server source file, not only imported ones', () => {
    // The include patterns are what pull untested files into the report as 0%
    // instead of leaving them out and overstating the global percentage.
    expect(cfg).toMatch(/include:\s*\[[^\]]*app\/\*\*/)
    expect(cfg).toMatch(/include:\s*\[[^\]]*lib\/\*\*/)
    expect(cfg).toMatch(/include:\s*\[[^\]]*components\/\*\*/)
  })

  it('sets thresholds for the critical money routes, not just a global number', () => {
    expect(cfg).toMatch(/thresholds:/)
    expect(cfg).toMatch(/app\/api\/v1\/investment-transactions\/route\.ts/)
    expect(cfg).toMatch(/app\/api\/v1\/investment-transactions\/\[id\]\/route\.ts/)
    expect(cfg).toMatch(/app\/api\/v1\/dashboard\/overview\/route\.ts/)
  })
})
