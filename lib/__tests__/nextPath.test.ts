import { describe, it, expect } from 'vitest'
import { safeNextPath } from '../nextPath'

describe('safeNextPath', () => {
  it('keeps an in-app path', () => {
    expect(safeNextPath('/assets?goal=g1')).toBe('/assets?goal=g1')
  })

  it.each(['//evil.example', 'https://evil.example', 'assets', '/\\evil.example', null, ''])(
    'refuses %s',
    (candidate) => {
      expect(safeNextPath(candidate)).toBeNull()
    },
  )
})
