import { vi, beforeEach, afterEach } from 'vitest'
import RecurringBookTopUpSheet from '../RecurringBookTopUpSheet'
import { dialogContract } from './helpers/dialogContract'

vi.mock('@/lib/formatters', () => ({ fmtCompact: (n: number) => String(n) }))

const target = {
  savingId: 's1', bookId: 'b1', bookName: 'Tích luỹ VCB',
  amount: 3_000_000, rate: 3.5, date: '2026-06-01', ym: '2026-06', planId: 'p1',
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => vi.unstubAllGlobals())

dialogContract({
  name: 'RecurringBookTopUpSheet',
  accessibleName: 'Top up accumulating book',
  insideTestId: 'recurring-topup-amount',
  open: (onClose) => <RecurringBookTopUpSheet target={target} isVi={false} onClose={onClose} onDone={() => {}} />,
})
