import { vi, beforeEach, afterEach } from 'vitest'
import SuccessorBookSheet from '../SuccessorBookSheet'
import { dialogContract } from './helpers/dialogContract'

// Guard for #688. This sheet was a bare fixed <div>: no role, no accessible
// name, no Escape, focus left on the page behind it and Tab walking straight out
// of the modal into the ledger underneath.
vi.mock('@/lib/formatters', () => ({ fmtCompact: (n: number) => String(n) }))

const target = {
  bookId: 'b1', bookName: 'Tích luỹ VCB', amount: 5_000_000, rate: 4.2,
  date: '2026-06-01', sourceExpiry: '2026-05-01', lockDays: 30,
  savingId: null, ym: null, planId: null,
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => vi.unstubAllGlobals())

dialogContract({
  name: 'SuccessorBookSheet',
  accessibleName: 'Open successor book',
  insideTestId: 'successor-amount',
  open: (onClose) => <SuccessorBookSheet target={target} isVi={false} onClose={onClose} onDone={() => {}} />,
})
