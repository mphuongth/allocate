'use client'

// Dashboard "Needs attention" card: lists bank term deposits that are matured
// or maturing within the reminder window, each with a one-tap "Handle" action
// that opens the renew/withdraw flow — a single term deposit also reminds the
// user to look up today's 12-month rate, which decides renew vs move to fund.
// It also lists fund purchases whose units are still an estimate (a deposit
// moved to its fund), for the week the order takes to fill, each opening the
// purchase to correct. Renders nothing when there's nothing to act on. Purely presentational — the parent supplies the already-filtered rows
// (see isActionableTermDeposit) and handles the resolve flow.

import { AlertTriangle, Building2, RefreshCw, GitMerge, TrendingUp, Pencil } from 'lucide-react'
import { fmtCompact, fmtUnits } from '@/lib/formatters'
import { daysUntil } from '@/lib/maturity'
import { GD_COLORS, type InvRow } from './goalDetailShared'
import { fmtTxDate } from './transactionUtils'
import type { EstimatedPurchase } from '@/features/dashboard/contracts'

function pillFor(inv: InvRow, isVi: boolean): { text: string; color: string; bg: string } | null {
  const diff = daysUntil(inv.expiryDate ?? '')
  if (Number.isNaN(diff)) return null // no maturity date → no status pill
  if (diff < 0) {
    const n = Math.abs(diff)
    return {
      text: isVi ? (n === 0 ? 'Đã đáo hạn' : `Quá hạn ${n} ngày`) : (n === 0 ? 'Matured' : `${n}d overdue`),
      color: 'var(--c-neg)', bg: 'var(--c-neg-tint)',
    }
  }
  return {
    text: isVi
      ? (diff === 0 ? 'Đáo hạn hôm nay' : diff === 1 ? 'Đáo hạn ngày mai' : `Đáo hạn sau ${diff} ngày`)
      : (diff === 0 ? 'Matures today' : diff === 1 ? 'Matures tomorrow' : `Matures in ${diff}d`),
    color: 'var(--c-warn)', bg: 'var(--c-warn-tint)',
  }
}

// A detected group of a goal's deposits maturing close together (see
// detectMergeClusters). The card surfaces each as a one-tap "merge them" banner
// that opens the resolve sheet on the anchor with the siblings preselected.
export interface MaturityCluster { anchorId: string; size: number }

export default function MaturityActionCard({
  items, estimates = [], isVi, onResolve, onFixEstimate, clusters, onMergeCluster, style,
}: {
  items: InvRow[]
  // Purchases priced at an estimated NAV, still within their reminder week.
  estimates?: EstimatedPurchase[]
  onFixEstimate?: (p: EstimatedPurchase) => void
  isVi: boolean
  onResolve: (inv: InvRow) => void
  // Merge clusters among `items`. Each banner opens the sheet on its anchor.
  clusters?: MaturityCluster[]
  onMergeCluster?: (anchorId: string) => void
  style?: React.CSSProperties
}) {
  if (!items.length && !estimates.length) return null

  return (
    <div data-testid="maturity-action-card" className="cn-card" style={{ overflow: 'hidden', ...style }}>
      <div style={{ padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--c-warn-tint)', color: 'var(--c-warn)', borderBottom: '1px solid rgba(180,83,9,0.12)' }}>
        <AlertTriangle size={15} strokeWidth={2.2} />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', flex: 1 }}>
          {isVi ? 'Cần xử lý' : 'Needs attention'}
        </span>
        <span data-testid="maturity-action-count" style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: 'rgba(180,83,9,0.14)', color: 'var(--c-warn)' }}>
          {items.length + estimates.length}
        </span>
      </div>
      {(clusters ?? []).map((c) => (
        <div
          key={c.anchorId}
          data-testid={`merge-cluster-banner-${c.anchorId}`}
          style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--c-card-2)', borderBottom: '1px solid var(--c-line)' }}
        >
          <GitMerge size={15} strokeWidth={2.2} style={{ color: GD_COLORS.bank, flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0 }}>
            {isVi
              ? `${c.size} sổ đáo hạn sát nhau`
              : `${c.size} deposits maturing close together`}
          </span>
          <button
            onClick={() => onMergeCluster?.(c.anchorId)}
            className="cn-btn"
            style={{ padding: '6px 12px', minHeight: 44, fontSize: 12, fontWeight: 600, gap: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <GitMerge size={12} strokeWidth={2.2} />
            {isVi ? 'Gộp lại' : 'Merge'}
          </button>
        </div>
      ))}
      <div style={{ padding: '4px 16px 6px' }}>
        {items.map((inv, i) => {
          const pill = pillFor(inv, isVi)
          return (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--c-line)' }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--c-card-2)', color: GD_COLORS.bank, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Building2 size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.name}</div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
                  <span>{fmtCompact(inv.principal ?? inv.value)}</span>
                  {pill && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: pill.bg, color: pill.color }}>{pill.text}</span>}
                </div>
                {/* Renew or move is decided on today's 12-month rate (Settings
                    threshold) — a book has no such choice. */}
                {!inv.depositGroupId && (
                  <div data-testid={`maturity-rate-reminder-${inv.id}`} style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 3, lineHeight: 1.35 }}>
                    {isVi ? 'Xem lãi suất 12 tháng hiện hành để chọn gửi lại hay chuyển quỹ' : "Check today's 12-month rate to choose renew or move to fund"}
                  </div>
                )}
              </div>
              <button
                onClick={() => onResolve(inv)}
                className="cn-btn primary"
                style={{ padding: '7px 13px', minHeight: 44, fontSize: 12.5, gap: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <RefreshCw size={13} strokeWidth={2.2} />
                {isVi ? 'Xử lý' : 'Handle'}
              </button>
            </div>
          )
        })}
        {estimates.map((p, i) => (
          <div key={p.transactionId} data-testid={`unit-estimate-${p.transactionId}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: items.length || i > 0 ? '1px solid var(--c-line)' : 'none' }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--c-card-2)', color: GD_COLORS.fund, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <TrendingUp size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.fundCode || p.fundName}</div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1, lineHeight: 1.35 }}>
                {isVi
                  ? `Cập nhật số CCQ khớp lệnh · ${fmtUnits(p.units)} CCQ ước tính · mua ${fmtTxDate(p.investmentDate, 'vi')}`
                  : `Update the filled units · ${fmtUnits(p.units)} estimated · bought ${fmtTxDate(p.investmentDate, 'en')}`}
              </div>
            </div>
            <button
              onClick={() => onFixEstimate?.(p)}
              className="cn-btn"
              style={{ padding: '7px 13px', minHeight: 44, fontSize: 12.5, gap: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Pencil size={13} strokeWidth={2.2} />
              {isVi ? 'Cập nhật' : 'Update'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
