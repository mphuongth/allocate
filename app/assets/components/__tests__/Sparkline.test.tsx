import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Sparkline, { SPARKLINE_WIDTH, sparklinePoints } from '../Sparkline'
import type { ChartPoint } from '../netWorthHistory'

// The point maths and the SVG were copied byte-for-byte between NetWorthCard and
// DesktopNetWorthPanel, differing only in height, so neither copy was covered
// (#569). The maths lives on its own here so it can be checked without a DOM.
const points = (values: number[], height: number) =>
  sparklinePoints(values, height)
    .split(' ')
    .map((pair) => pair.split(',').map(Number))

describe('sparklinePoints', () => {
  it('spreads points evenly across the full width', () => {
    const xs = points([1, 2, 3], 36).map(([x]) => x)

    expect(xs).toEqual([0, SPARKLINE_WIDTH / 2, SPARKLINE_WIDTH])
  })

  it('draws a rising series downward in SVG coordinates', () => {
    const ys = points([1, 5, 9], 36).map(([, y]) => y)

    // SVG y grows downward, so a rising value must produce a falling y.
    expect(ys[0]).toBeGreaterThan(ys[1])
    expect(ys[1]).toBeGreaterThan(ys[2])
  })

  it('keeps every point inside the box, with room for the stroke', () => {
    for (const height of [36, 40]) {
      for (const [, y] of points([1, 50, 3, 99, 20], height)) {
        expect(y).toBeGreaterThanOrEqual(3)
        expect(y).toBeLessThanOrEqual(height - 3)
      }
    }
  })

  it('scales to the height it is given', () => {
    const short = points([1, 9], 36).map(([, y]) => y)
    const tall = points([1, 9], 40).map(([, y]) => y)

    expect(tall).not.toEqual(short)
  })

  // A flat series has no range to scale by; the old code guarded this with
  // `|| 1` fallbacks, and losing that would divide by zero and emit NaN.
  it('survives a flat series', () => {
    for (const [, y] of points([5, 5, 5], 36)) expect(Number.isFinite(y)).toBe(true)
  })

  it('survives an all-zero series', () => {
    for (const [, y] of points([0, 0], 36)) expect(Number.isFinite(y)).toBe(true)
  })
})

describe('Sparkline', () => {
  const data: ChartPoint[] = [
    { label: 'a', value: 1 },
    { label: 'b', value: 2 },
  ]

  it('renders nothing for a single point — a line needs two', () => {
    const { container } = render(<Sparkline data={[data[0]]} positive height={36} />)

    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders at the height it is given, so mobile and desktop can differ', () => {
    const { container: mobile } = render(<Sparkline data={data} positive height={36} />)
    const { container: desktop } = render(<Sparkline data={data} positive height={40} />)

    expect(mobile.querySelector('svg')).toHaveAttribute('viewBox', `0 0 ${SPARKLINE_WIDTH} 36`)
    expect(desktop.querySelector('svg')).toHaveAttribute('viewBox', `0 0 ${SPARKLINE_WIDTH} 40`)
  })

  it('colours by direction', () => {
    const { container: up } = render(<Sparkline data={data} positive height={36} />)
    const { container: down } = render(<Sparkline data={data} positive={false} height={36} />)

    expect(up.querySelector('polyline')).toHaveAttribute('stroke', 'var(--c-pos)')
    expect(down.querySelector('polyline')).toHaveAttribute('stroke', 'var(--c-neg)')
  })
})
