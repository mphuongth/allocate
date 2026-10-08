import { describe, it, expect } from 'vitest'
import { safeNextPath } from '../nextPath'

describe('safeNextPath', () => {
  it('keeps an in-app path', () => {
    expect(safeNextPath('/assets?goal=g1')).toBe('/assets?goal=g1')
  })

  it('keeps the hash of an in-app path', () => {
    expect(safeNextPath('/planning?month=6#dca')).toBe('/planning?month=6#dca')
  })

  it.each(['//evil.example', 'https://evil.example', 'assets', '/\\evil.example', null, ''])(
    'refuses %s',
    (candidate) => {
      expect(safeNextPath(candidate)).toBeNull()
    },
  )

  // The URL parser strips tab, LF and CR anywhere in the input, so these become
  // `//evil.example` once a browser (or `new URL`) reads them (#759).
  it.each(['/\t/evil.example', '/\n/evil.example', '/\r\\evil.example', '\t//evil.example'])(
    'refuses %j, which the URL parser reads as another host',
    (candidate) => {
      expect(safeNextPath(candidate)).toBeNull()
    },
  )
})
