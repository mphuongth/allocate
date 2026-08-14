import { describe, it, expect, vi, beforeEach } from 'vitest'
import { contentionError, isContention } from '../contention'

// Two writers reached the same rows and Postgres aborted one. Nothing was
// written and nothing is wrong with the request, so a 500 is the wrong answer
// twice over: it reads as a bug, and it gives the client no reason to retry
// (#610, and now the book anchor of #650).
describe('contentionError', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })

  it.each([
    ['40P01', 'deadlock detected'],
    ['55P03', 'could not obtain lock on row'],
    ['40001', 'could not serialize access'],
  ])('answers %s with a retryable 409', async (code, message) => {
    const res = contentionError({ code, message }, 'try again', 'book_busy')
    expect(res?.status).toBe(409)
    await expect(res?.json()).resolves.toMatchObject({ error: 'try again', code: 'book_busy' })
  })

  // The point of a discriminated map: a genuine failure must still read as one,
  // or a real bug hides behind "try again" forever.
  it('leaves a genuine failure to the caller', () => {
    expect(contentionError({ code: '23514', message: 'withdrawal invariant' }, 'try again', 'book_busy')).toBeNull()
    expect(contentionError({ message: 'connection refused' }, 'try again', 'book_busy')).toBeNull()
    expect(contentionError(null, 'try again', 'book_busy')).toBeNull()
  })

  it('exposes the same judgement on its own', () => {
    expect(isContention({ code: '40P01' })).toBe(true)
    expect(isContention({ code: 'PGRST116' })).toBe(false)
    expect(isContention(undefined)).toBe(false)
  })
})
