import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  SMOKE_TAG,
  SMOKE_BUDGET_MS,
  SMOKE_MIN_TESTS,
  SMOKE_MAX_TESTS,
  SMOKE_COVERAGE_AREAS,
  checkSmokeBudget,
} from '../../e2e/helpers/lanes'

const E2E_DIR = path.join(__dirname, '..', '..', 'e2e')

function specFiles(): string[] {
  return fs
    .readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => path.join(E2E_DIR, f))
}

/** Count `{ tag: '@smoke' }` annotations in a spec file. */
function countSmokeTags(file: string): number {
  const source = fs.readFileSync(file, 'utf8')
  return source.split(SMOKE_TAG).length - 1
}

describe('checkSmokeBudget', () => {
  it('passes a run that finishes inside the documented budget', () => {
    const verdict = checkSmokeBudget(SMOKE_BUDGET_MS - 1_000)
    expect(verdict.withinBudget).toBe(true)
    expect(verdict.overByMs).toBe(0)
  })

  it('flags a run that overruns the budget, with the overrun', () => {
    const verdict = checkSmokeBudget(SMOKE_BUDGET_MS + 30_000)
    expect(verdict.withinBudget).toBe(false)
    expect(verdict.overByMs).toBe(30_000)
  })

  it('treats hitting the budget exactly as within budget', () => {
    expect(checkSmokeBudget(SMOKE_BUDGET_MS).withinBudget).toBe(true)
  })

  it('documents a budget that is a small fraction of the full suite (~7.6 min)', () => {
    expect(SMOKE_BUDGET_MS).toBeGreaterThan(60_000)
    expect(SMOKE_BUDGET_MS).toBeLessThanOrEqual(4 * 60_000)
  })
})

describe('the @smoke lane inventory', () => {
  it('tags roughly 15–30 tests — enough to gate a PR, small enough to stay fast', () => {
    const total = specFiles().reduce((sum, f) => sum + countSmokeTags(f), 0)
    expect(total).toBeGreaterThanOrEqual(SMOKE_MIN_TESTS)
    expect(total).toBeLessThanOrEqual(SMOKE_MAX_TESTS)
  })

  it('covers every high-value area the lane is meant to guard', () => {
    const missing = SMOKE_COVERAGE_AREAS.filter(
      (area) => countSmokeTags(path.join(E2E_DIR, area.spec)) === 0,
    )
    expect(missing.map((a) => a.name)).toEqual([])
  })

  it('names a spec file that actually exists for every covered area', () => {
    const absent = SMOKE_COVERAGE_AREAS.filter(
      (area) => !fs.existsSync(path.join(E2E_DIR, area.spec)),
    )
    expect(absent.map((a) => a.spec)).toEqual([])
  })
})
