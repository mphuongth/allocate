import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter'
import LaneReporter from '../../e2e/reporters/laneReporter'

/**
 * The reporter's job is to make a red run legible. The case that matters most
 * here is the one Playwright never routes through `onTestEnd`: a global error
 * (the webServer failing to start), which otherwise vanishes from the summary.
 */

function makeReporter() {
  const reporter = new LaneReporter()
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  return { reporter, output: () => log.mock.calls.map((c) => String(c[0])).join('\n') }
}

const failedResult = {
  status: 'failed',
  retry: 0,
  errors: [],
  error: { message: 'expect(received).toBe(expected)' },
} as unknown as TestResult

const failedTest = {
  expectedStatus: 'passed',
  retries: 0,
  titlePath: () => ['', 'smoke', 'a.spec.ts', 'some test'],
} as unknown as TestCase

const passedRun = { status: 'passed' } as FullResult
const failedRun = { status: 'failed' } as FullResult

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LaneReporter', () => {
  it('reports a webServer that never started as an infra failure', () => {
    const { reporter, output } = makeReporter()

    reporter.onBegin()
    reporter.onError({ message: 'Timed out waiting 120000ms from config.webServer.' })
    reporter.onEnd(failedRun)

    expect(output()).toContain('1 infra failure(s)')
    expect(output()).toContain('0 product failure(s)')
    expect(output()).toContain('Every failure looks like infrastructure')
  })

  it('still summarizes when the only failure is global — no test ever ran', () => {
    const { reporter, output } = makeReporter()

    reporter.onBegin()
    reporter.onError({ message: 'connect ECONNREFUSED 127.0.0.1:54321' })
    reporter.onEnd(failedRun)

    expect(output()).not.toBe('')
    expect(output()).toContain('infra')
  })

  it('counts a global error alongside test failures', () => {
    const { reporter, output } = makeReporter()

    reporter.onBegin()
    reporter.onTestEnd(failedTest, failedResult)
    reporter.onError({ message: 'socket hang up' })
    reporter.onEnd(failedRun)

    expect(output()).toContain('1 product failure(s), 1 infra failure(s)')
    expect(output()).not.toContain('Every failure looks like infrastructure')
  })

  it('stays quiet when nothing ran and nothing failed — e.g. `--list`', () => {
    const { reporter, output } = makeReporter()

    reporter.onBegin()
    reporter.onEnd(passedRun)

    expect(output()).toBe('')
  })
})
