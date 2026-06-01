import { describe, it, expect } from 'vitest'
import {
  STATUS_COLOR,
  BAR_COLOR,
  BAR_COLOR_DETAIL,
  insurancePaidState,
  insuranceStatusLabel,
} from '../insuranceShared'

describe('STATUS_COLOR', () => {
  it('maps each status to its dot/badge colour', () => {
    expect(STATUS_COLOR.on_track).toBe('var(--c-muted)')
    expect(STATUS_COLOR.upcoming).toBe('var(--c-warn)')
    expect(STATUS_COLOR.overdue).toBe('var(--c-neg)')
    expect(STATUS_COLOR.completed).toBe('var(--c-pos)')
    expect(STATUS_COLOR.ready).toBe('var(--c-navy)')
  })
})

describe('BAR_COLOR vs BAR_COLOR_DETAIL', () => {
  it('paints a ready member amber in the compact list/card', () => {
    expect(BAR_COLOR.ready).toBe('var(--c-warn)')
  })
  it('paints a ready member navy in the detail view', () => {
    expect(BAR_COLOR_DETAIL.ready).toBe('var(--c-navy)')
  })
  it('differs only on the ready key', () => {
    ;(['on_track', 'upcoming', 'overdue', 'completed'] as const).forEach((k) => {
      expect(BAR_COLOR_DETAIL[k]).toBe(BAR_COLOR[k])
    })
  })
})

describe('insurancePaidState', () => {
  it('keeps the original status when there is no recorded payment', () => {
    expect(insurancePaidState('ready', null)).toEqual({ paidYear: null, effectiveStatus: 'ready' })
    expect(insurancePaidState('overdue', undefined)).toEqual({ paidYear: null, effectiveStatus: 'overdue' })
  })
  it('presents a member paid in the current year as completed', () => {
    const year = new Date().getFullYear()
    const { paidYear, effectiveStatus } = insurancePaidState('overdue', `${year}-06-15`)
    expect(paidYear).toBe(year)
    expect(effectiveStatus).toBe('completed')
  })
})

describe('insuranceStatusLabel', () => {
  it('returns Vietnamese labels', () => {
    expect(insuranceStatusLabel('ready', true)).toBe('Đã tích lũy đủ')
    expect(insuranceStatusLabel('completed', true)).toBe('Đã thanh toán')
  })
  it('returns English labels', () => {
    expect(insuranceStatusLabel('ready', false)).toBe('Ready to pay')
    expect(insuranceStatusLabel('on_track', false)).toBe('Not due')
  })
  it('falls back to the raw status for unknown values', () => {
    expect(insuranceStatusLabel('weird', false)).toBe('weird')
  })
})
