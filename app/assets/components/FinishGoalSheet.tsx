'use client'

// "Liquidate & finish" (#650) — the one sheet both goal-detail surfaces open.
//
// A goal is finished by realizing everything it still holds in ONE submit: the
// server writes every withdrawal and the completion snapshot in a single
// transaction, so there is no half-finished state to design for. What this sheet
// owns is the part the server cannot know — the cash each holding actually paid
// out — plus refusing to submit until every holding has a figure, and naming
// whatever still feeds the goal instead of letting the user fill in a form that
// was always going to be refused.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale } from 'next-intl'
import { AlertTriangle, Check, X } from 'lucide-react'
import { iconHit } from './iconHit'
import { fmt } from '@/lib/formatters'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'
import { CairnLoader } from '@/components/ui/CairnLoader'
import { useDialogMount, useResetOnOpen } from '@/components/ui/useDialogMount'
import { useManagedTimeout } from '@/components/ui/useManagedTimeout'
import { TypeIcon } from './goalDetailShared'
import type { InvRow } from '@/features/dashboard/contracts'
import {
  buildFinishHoldings, finishPlanFrom, isFinishPlanComplete, realizedFor, totalRealized,
  type FinishHolding, type FinishInput, type ServerHolding,
} from '@/lib/finishGoal'

export interface Blocker { code: string; label: string }

interface Props {
  open: boolean
  goalId: string
  goalName: string
  /** The goal's live holdings, exactly as the holdings tab built them. */
  rows: InvRow[]
  onClose: () => void
  /** Fired after a successful finish, so the caller can close the detail view. */
  onFinished: () => void
  desktop?: boolean
}

// Each blocker names a decision the user has to undo somewhere else, so the copy
// says WHERE — a message that only says "blocked" leaves them hunting.
function blockerCopy(code: string, isVI: boolean): string {
  if (code === 'recurring_saving') {
    return isVI
      ? 'Tiết kiệm định kỳ đang chảy vào mục tiêu này. Dừng hoặc đổi mục tiêu cho nó trong Kế hoạch.'
      : 'A recurring saving still feeds this goal. Stop it or point it elsewhere in Planning.'
  }
  if (code === 'dca_plan') {
    return isVI
      ? 'Quỹ đang DCA vào mục tiêu này. Bỏ liên kết mục tiêu ở trang Quỹ.'
      : 'A fund is dollar-cost-averaging into this goal. Unlink the goal on the Funds page.'
  }
  if (code === 'held_settlement') {
    return isVI
      ? 'Có tiền đang chờ gộp trong mục tiêu này. Bỏ chờ gộp hoặc hoàn tất việc gộp trước.'
      : 'Cash is parked in this goal for a merge. Release it or complete the merge first.'
  }
  if (code === 'future_holding') {
    return isVI
      ? 'Mục tiêu có khoản đóng góp ghi ngày trong tương lai. Chờ tới ngày đó, hoặc chuyển khoản đó ra khỏi mục tiêu.'
      : 'This goal holds a contribution dated in the future. Wait for that date, or move it out of the goal.'
  }
  if (code === 'successor_handover') {
    return isVI
      ? 'Sổ này đã hứa chuyển sang sổ kế nhiệm. Huỷ bàn giao trước khi tất toán.'
      : 'This book is promised to a successor. Cancel the handover before closing it.'
  }
  return isVI ? 'Còn một liên kết đang chảy vào mục tiêu này.' : 'Something still feeds this goal.'
}

export function FinishGoalSheet({ open, goalId, goalName, rows, onClose, onFinished, desktop }: Props) {
  const isVI = useLocale() === 'vi'
  const mounted = useDialogMount(open)

  const [inputs, setInputs] = useState<FinishInput>({})
  // `blockers === null` means the prerequisite check has not produced an answer
  // — either still running (`checking`) or failed. Neither may render the form.
  const [blockers, setBlockers] = useState<Blocker[] | null>(null)
  // The SERVER's list of what this goal still holds, and the only thing allowed
  // to decide WHICH holdings exist. This page loads the newest 200 transactions,
  // so on a long-lived goal the older holdings are simply not in `rows` — a plan
  // built from them would omit those keys and be refused as incomplete, for
  // good. Null until the list arrives; the form waits.
  const [server, setServer] = useState<ServerHolding[] | null>(null)
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<number | null>(null)
  const schedule = useManagedTimeout()

  // Closing the success screen early finalizes there and then, instead of
  // waiting for a timer that unmounting is about to cancel — the finish has
  // already happened, and the dashboard has to hear about it either way.
  function handleClose() {
    if (done !== null) onFinished()
    onClose()
  }

  const holdings = useMemo(
    () => (server ? buildFinishHoldings(rows, server) : []),
    [rows, server],
  )

  // What each field actually holds: the user's edit if there is one, otherwise
  // the suggestion. Derived rather than seeded — a seeding step would have to
  // re-run whenever the holdings change identity, and that is the shape that
  // turns into a fetch loop. Untouched fields simply read as the suggestion.
  const values = useMemo(
    // An unpriced holding starts EMPTY: there is no honest suggestion to make,
    // and the submit stays disabled until the user states the cash.
    () => Object.fromEntries(holdings.map((h) => [h.key, inputs[h.key] ?? (h.unpriced ? '' : String(h.suggested))])),
    [holdings, inputs],
  )

  // Prefill every field from today's valuation the moment the sheet opens, and
  // ask the server what still feeds the goal. Preselected-and-prefilled is the
  // point: the common case is "sell all of it at what it's worth", and the user
  // only edits the lines their bank slip disagrees with.
  const load = useCallback(async () => {
    setChecking(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/savings-goals/${goalId}/finish`, { cache: 'no-store' })
      // A failed check is not a clean bill of health. Reading a non-2xx as "no
      // blockers" is the worst of both: the sheet would present the goal as
      // ready and enable a submit on a prerequisite that never ran.
      if (!res.ok) throw new Error('blocker check failed')
      const body = await res.json()
      setServer(body.holdings ?? [])
      setBlockers(body.blockers ?? [])
    } catch {
      setServer(null)
      setBlockers(null)
      setError(isVI ? 'Không kiểm tra được mục tiêu. Thử lại.' : 'Could not check the goal. Try again.')
    }
    setChecking(false)
  }, [goalId, isVI])

  // State only — useResetOnOpen runs during render, so the load lives in the
  // effect below (which also covers a sheet that mounts already open).
  useResetOnOpen(open, () => {
    setInputs({})
    setServer(null)
    setBlockers(null)
    setChecking(true)
    setSaving(false)
    setError('')
    setDone(null)
  })

  useEffect(() => {
    if (!open) return
    // Asks the server what blocks this finish. The flags `load` sets mark a
    // request about to be issued, not state derived from render, so there is
    // nothing here to move to render time.
    void load()
  }, [open, load])

  const complete = isFinishPlanComplete(holdings, values)
  const total = totalRealized(holdings, values)
  const blocked = (blockers?.length ?? 0) > 0

  async function handleConfirm() {
    if (!complete || blocked || saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/savings-goals/${goalId}/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: finishPlanFrom(holdings, values) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        // A blocker that appeared since the sheet opened re-renders as the named
        // blocker list, not as a red string under the submit button.
        if (typeof body.code === 'string' && body.code.startsWith('blocked_')) {
          setBlockers([{ code: body.code.slice('blocked_'.length), label: '' }])
        }
        setError(body.error ?? (isVI ? 'Đã xảy ra lỗi. Vui lòng thử lại.' : 'An error occurred. Please try again.'))
        setSaving(false)
        return
      }
      const body = await res.json()
      setDone(body.realized ?? total)
      setSaving(false)
      // Managed, so it is cleared when this sheet unmounts. A bare setTimeout
      // survives the user closing the success screen and opening another goal —
      // and on mobile onFinished closes the goal detail, so the timer would
      // dismiss the goal they had just opened (#650).
      schedule(() => { onFinished(); onClose() }, 1800)
    } catch {
      setError(isVI ? 'Đã xảy ra lỗi. Vui lòng thử lại.' : 'An error occurred. Please try again.')
      setSaving(false)
    }
  }

  if (!mounted) return null

  const t = {
    title: isVI ? 'Tất toán & hoàn thành' : 'Liquidate & finish',
    intro: isVI
      ? 'Bán/rút toàn bộ những gì mục tiêu còn giữ, rồi lưu trữ mục tiêu ở mức 100%.'
      : 'Sell or withdraw everything this goal still holds, then archive it at 100%.',
    received: isVI ? 'Số tiền nhận được' : 'Amount received',
    unitPrice: isVI ? 'Giá bán mỗi chỉ' : 'Sale price per chỉ',
    total: isVI ? 'Tổng thực nhận' : 'Total realized',
    confirm: isVI ? 'Tất toán & hoàn thành' : 'Liquidate & finish',
    archived: isVI
      ? 'Mục tiêu sẽ được lưu trữ ở mức 100% và giữ nguyên toàn bộ lịch sử giao dịch.'
      : 'The goal will be archived at 100% and keeps its full transaction history.',
    incomplete: isVI
      ? 'Điền số tiền thực nhận cho từng khoản trước khi tất toán.'
      : 'Fill in what each holding paid out before finishing.',
    blockedTitle: isVI ? 'Chưa thể tất toán' : 'Not ready to finish',
    nothing: isVI
      ? 'Mục tiêu này không còn khoản nào — tất toán chỉ lưu trữ mục tiêu.'
      : 'This goal holds nothing left — finishing only archives it.',
    success: isVI ? 'Đã hoàn thành mục tiêu' : 'Goal completed',
  }

  return (
    <div
      data-testid="finish-goal-sheet"
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0,
        background: desktop ? 'rgba(15, 23, 42, 0.4)' : 'rgba(15, 23, 42, 0.2)',
        zIndex: desktop ? 200 : 160,
        display: 'flex', alignItems: desktop ? 'center' : 'flex-end', justifyContent: 'center',
        padding: desktop ? 24 : 0,
        animation: open ? 'fade-in 180ms ease' : 'fade-out 180ms ease forwards',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, maxHeight: desktop ? 'calc(100vh - 48px)' : '90dvh',
          background: 'var(--c-card)',
          borderRadius: desktop ? 20 : '20px 20px 0 0',
          display: 'flex', flexDirection: 'column',
          animation: open
            ? (desktop ? 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)' : 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)')
            : (desktop ? 'fade-out 150ms ease forwards' : 'slide-down 180ms ease forwards'),
          boxShadow: desktop ? '0 24px 48px rgba(15,23,42,0.18)' : '0 -8px 24px rgba(0,0,0,0.12)',
        }}
      >
        {!desktop && <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px', flexShrink: 0 }} />}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: desktop ? '18px 20px 14px' : '0 16px 14px', borderBottom: desktop ? '1px solid var(--c-line)' : undefined, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{t.title}</h3>
            <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{goalName}</div>
          </div>
          <button onClick={handleClose} aria-label="Close" style={{ ...iconHit, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: desktop ? '16px 20px 24px' : '0 16px 24px' }}>
          {done !== null ? (
            <div data-testid="finish-goal-success" style={{ padding: '32px 0', textAlign: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--c-pos-tint)', color: 'var(--c-pos)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Check size={30} strokeWidth={2.5} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{t.success}</div>
              <div style={{ fontSize: 13, color: 'var(--c-muted)', marginTop: 4 }}>{goalName}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-pos)', marginTop: 12, letterSpacing: '-0.02em' }}>{fmt(done)}</div>
            </div>
          ) : blockers === null || server === null ? (
            // No answer from the prerequisite check yet — running, or failed.
            // Neither state may show a form whose submit would be a guess.
            checking ? (
              <div style={{ padding: '40px 0', display: 'flex', justifyContent: 'center' }}><CairnLoader /></div>
            ) : (
              <div data-testid="finish-goal-check-failed" style={{ display: 'grid', gap: 12, paddingTop: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--c-neg)' }}>{error}</div>
                <button
                  onClick={() => { void load() }}
                  style={{
                    justifySelf: 'center', padding: '10px 18px', borderRadius: 10,
                    border: '1px solid var(--c-line)', background: 'var(--c-card)',
                    color: 'var(--c-ink)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >
                  {isVI ? 'Thử lại' : 'Try again'}
                </button>
              </div>
            )
          ) : blocked ? (
            // ── Blocked ──────────────────────────────────────────────────────
            <div data-testid="finish-goal-blockers" style={{ display: 'grid', gap: 10, paddingTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
                <AlertTriangle size={16} style={{ color: 'var(--c-neg)' }} />
                {t.blockedTitle}
              </div>
              {(blockers ?? []).map((b, i) => (
                <div key={`${b.code}-${i}`} style={{ padding: '12px 14px', background: 'var(--c-card-2)', borderRadius: 12, fontSize: 12, lineHeight: 1.5 }}>
                  {b.label && <div style={{ fontWeight: 600, color: 'var(--c-ink)', marginBottom: 2 }}>{b.label}</div>}
                  <div style={{ color: 'var(--c-muted)' }}>{blockerCopy(b.code, isVI)}</div>
                </div>
              ))}
            </div>
          ) : (
            // ── The liquidation plan ─────────────────────────────────────────
            <div style={{ display: 'grid', gap: 12, paddingTop: 14 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--c-muted)', lineHeight: 1.5 }}>{t.intro}</p>

              {holdings.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--c-muted)', padding: '12px 14px', background: 'var(--c-card-2)', borderRadius: 12 }}>{t.nothing}</div>
              )}

              {holdings.map((h) => (
                <HoldingRow
                  key={h.key}
                  holding={h}
                  value={values[h.key] ?? ''}
                  onChange={(v) => setInputs((prev) => ({ ...prev, [h.key]: v }))}
                  isVI={isVI}
                  labels={t}
                />
              ))}

              {holdings.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 14px', background: 'var(--c-card-2)', borderRadius: 12 }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)', fontWeight: 600 }}>{t.total}</span>
                  <span data-testid="finish-goal-total" style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(total)}</span>
                </div>
              )}

              <p style={{ margin: 0, fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{t.archived}</p>

              {!complete && (
                <div style={{ fontSize: 11, color: 'var(--c-neg)' }}>{t.incomplete}</div>
              )}
              {error && <div style={{ fontSize: 12, color: 'var(--c-neg)' }}>{error}</div>}

              <button
                data-testid="finish-goal-confirm"
                onClick={handleConfirm}
                disabled={!complete || saving}
                style={{
                  width: '100%', padding: '14px 16px', borderRadius: 12, border: 'none',
                  background: !complete || saving ? 'var(--c-card-2)' : 'var(--c-pos)',
                  color: !complete || saving ? 'var(--c-muted)' : '#fff',
                  fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
                  cursor: !complete || saving ? 'not-allowed' : 'pointer',
                }}
              >
                {t.confirm}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function HoldingRow({ holding, value, onChange, isVI, labels }: {
  holding: FinishHolding
  value: string
  onChange: (v: string) => void
  isVI: boolean
  labels: { received: string; unitPrice: string }
}) {
  const realized = realizedFor(holding, value)
  const byUnit = holding.input === 'unitPrice'

  return (
    <div style={{ padding: '12px 14px', border: '1px solid var(--c-line)', borderRadius: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <TypeIcon type={holding.type} size={16} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{holding.name}</div>
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>
            {holding.unpriced
              ? (isVI ? 'Chưa có giá vàng — nhập giá bán thực tế' : 'No gold price set — enter what you sold at')
              : `${isVI ? 'Giá trị hiện tại' : 'Worth today'}: ${fmt(holding.value)}`}
            {holding.units != null && ` · ${holding.units} ${isVI ? 'chỉ' : 'chỉ'}`}
          </div>
        </div>
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {byUnit ? labels.unitPrice : labels.received}
        </span>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
          border: `1.5px solid ${realized == null ? 'var(--c-neg)' : 'var(--c-line)'}`,
          borderRadius: 10, background: 'var(--c-card)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--c-muted)' }}>₫</span>
          <input
            data-testid={`finish-input-${holding.key}`}
            type="text"
            inputMode="numeric"
            value={formatIntVN(value)}
            onChange={(e) => onChange(parseIntVN(e.target.value))}
            placeholder="0"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, background: 'transparent', color: 'var(--c-ink)' }}
          />
        </div>
      </label>
      {byUnit && realized != null && (
        <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>
          {isVI ? 'Thành tiền' : 'Proceeds'}: <span style={{ fontWeight: 600, color: 'var(--c-ink)' }}>{fmt(realized)}</span>
        </div>
      )}
    </div>
  )
}

export default FinishGoalSheet
