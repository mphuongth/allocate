import { describe, it, expect } from 'vitest'
import { classifyFailure, summarizeFailures } from '../../e2e/helpers/failureClass'

describe('classifyFailure', () => {
  it('classifies socket-level errors as infra', () => {
    expect(classifyFailure({ message: 'connect ECONNREFUSED 127.0.0.1:54321' })).toBe('infra')
    expect(classifyFailure({ message: 'read ECONNRESET' })).toBe('infra')
    expect(classifyFailure({ message: 'socket hang up' })).toBe('infra')
    expect(classifyFailure({ message: 'TypeError: fetch failed' })).toBe('infra')
    expect(classifyFailure({ message: 'page.goto: net::ERR_CONNECTION_REFUSED' })).toBe('infra')
  })

  it('classifies database throttling and exhaustion as infra', () => {
    expect(classifyFailure({ message: 'FATAL: remaining connection slots are reserved' })).toBe(
      'infra',
    )
    expect(classifyFailure({ message: 'too many connections for role "postgres"' })).toBe('infra')
    expect(
      classifyFailure({ message: 'canceling statement due to statement timeout' }),
    ).toBe('infra')
    expect(classifyFailure({ message: 'Disk IO budget exhausted for this project' })).toBe('infra')
  })

  it('classifies gateway/rate-limit responses as infra', () => {
    expect(classifyFailure({ message: 'Expected 400 but received 503 Service Unavailable' })).toBe(
      'infra',
    )
    expect(classifyFailure({ message: 'request failed with 504 Gateway Timeout' })).toBe('infra')
    expect(classifyFailure({ message: 'HTTP 429 Too Many Requests' })).toBe('infra')
    expect(classifyFailure({ message: 'apiResponse.json: status 502' })).toBe('infra')
    expect(classifyFailure({ message: 'Received: 429' })).toBe('infra')
  })

  it('does not read a bare number in a stack frame or a value as a status code', () => {
    // The classifier sees message + stack. A line number, an amount, or a goal
    // id containing 503 must not turn a real regression into "infra".
    expect(
      classifyFailure({
        message: 'expect(received).toBe(expected)\n    at e2e/dashboard.spec.ts:503:11',
      }),
    ).toBe('product')
    expect(
      classifyFailure({ message: 'expect(received).toBe(expected)\n\nExpected: 429\nReceived: 0' }),
    ).toBe('product')
    expect(classifyFailure({ message: 'amount_vnd 502000 did not match' })).toBe('product')
  })

  it('classifies a webServer that never came up as infra', () => {
    // Playwright words this several ways; all of them mention config.webServer.
    expect(
      classifyFailure({ message: 'Timed out waiting 120000ms from config.webServer.' }),
    ).toBe('infra')
    expect(
      classifyFailure({
        message: 'Process from config.webServer was not able to start. Exit code: 1',
      }),
    ).toBe('infra')
    expect(
      classifyFailure({
        message: 'Timed out waiting 120000ms from config.webServer to start at http://localhost:3000',
      }),
    ).toBe('infra')
  })

  it('classifies browser/worker crashes as infra', () => {
    expect(
      classifyFailure({ message: 'Target page, context or browser has been closed' }),
    ).toBe('infra')
    expect(classifyFailure({ message: 'browserType.launch: Browser closed unexpectedly' })).toBe(
      'infra',
    )
  })

  it('classifies assertion failures as product failures', () => {
    expect(
      classifyFailure({
        message: 'expect(received).toBe(expected)\n\nExpected: 400\nReceived: 200',
      }),
    ).toBe('product')
    expect(
      classifyFailure({
        message: 'expect(locator).toBeVisible() failed\n\nLocator resolved to 0 elements',
      }),
    ).toBe('product')
  })

  it('treats a plain locator timeout as a product failure, not infra', () => {
    // The suite's most common failure: an element never appeared. "Timed out"
    // alone must not be read as infrastructure trouble.
    expect(
      classifyFailure({
        status: 'timedOut',
        message: 'Timed out 5000ms waiting for expect(locator).toBeVisible()',
      }),
    ).toBe('product')
    expect(
      classifyFailure({
        status: 'timedOut',
        message: 'Test timeout of 30000ms exceeded.',
      }),
    ).toBe('product')
  })

  it('lets an infra marker win even when the test timed out', () => {
    expect(
      classifyFailure({
        status: 'timedOut',
        message: 'Test timeout of 30000ms exceeded.\nError: connect ETIMEDOUT db.supabase.co:5432',
      }),
    ).toBe('infra')
  })

  it('defaults to a product failure when there is no message at all', () => {
    expect(classifyFailure({})).toBe('product')
    expect(classifyFailure({ message: '' })).toBe('product')
  })
})

describe('summarizeFailures', () => {
  it('splits failures into infra and product buckets', () => {
    const summary = summarizeFailures([
      { title: 'a', message: 'connect ECONNREFUSED 127.0.0.1:54321' },
      { title: 'b', message: 'expect(received).toBe(expected)' },
      { title: 'c', message: 'HTTP 429 Too Many Requests' },
    ])

    expect(summary.infra.map((f) => f.title)).toEqual(['a', 'c'])
    expect(summary.product.map((f) => f.title)).toEqual(['b'])
  })

  it('reports an all-infra run so a red lane is not read as a regression', () => {
    const summary = summarizeFailures([
      { title: 'a', message: 'socket hang up' },
      { title: 'b', message: 'too many connections' },
    ])

    expect(summary.infraOnly).toBe(true)
    expect(summary.total).toBe(2)
  })

  it('is not infra-only when a single product failure is present', () => {
    const summary = summarizeFailures([
      { title: 'a', message: 'socket hang up' },
      { title: 'b', message: 'expect(locator).toBeVisible() failed' },
    ])

    expect(summary.infraOnly).toBe(false)
  })

  it('reports no failures as an empty, non-infra-only summary', () => {
    const summary = summarizeFailures([])
    expect(summary.total).toBe(0)
    expect(summary.infraOnly).toBe(false)
  })
})
