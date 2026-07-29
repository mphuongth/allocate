'use client'

import { ArrowDownToLine } from 'lucide-react'
import { fmtCompact, fmtPct, fmtTimeAgo } from '@/lib/formatters'
import { CairnLoader } from '@/app/components/ui/CairnLoader'
import type { DashboardData } from '../DashboardClient'
import type { AllocationTotals } from '../overviewData'
import { TIME_RANGES, type TimeRange, type ChartPoint } from './netWorthHistory'
import Sparkline from './Sparkline'

// Taller than the mobile card's — the desktop panel has the room for it.
const SPARKLINE_HEIGHT = 40

const ALLOC_COLORS: Record<string, { color: string; label: string; labelVi: string }> = {
  fund:  { color: '#2563eb', label: 'Funds',   labelVi: 'Quỹ' },
  bank:  { color: '#047857', label: 'Savings', labelVi: 'Tiết kiệm' },
  gold:  { color: 'var(--c-fund-gold)', label: 'Gold',    labelVi: 'Vàng' },
  stock: { color: '#7c3aed', label: 'Stock',   labelVi: 'Cổ phiếu' },
}

interface Props {
  data: DashboardData
  allocationTotals: AllocationTotals | null
  goldUnits?: number
  locale: string
  refreshing?: boolean
  navUpdatedAt?: string | null
  onDownloadReport: () => void
  // History + range owned by the parent so the range persists across the
  // desktop↔mobile breakpoint switch (#5).
  history?: ChartPoint[]
  timeRange?: TimeRange
  onRangeChange?: (range: TimeRange) => void
}

export default function DesktopNetWorthPanel({ data, allocationTotals, goldUnits, locale, refreshing, navUpdatedAt, onDownloadReport, history = [], timeRange = '1Y', onRangeChange }: Props) {
  const { netWorth } = data
  const isPos = netWorth.overallProfitLoss >= 0
  const isVi = locale === 'vi'

  const segments = allocationTotals ? (() => {
    const raw: Record<string, number> = {
      fund: allocationTotals.fundTotal,
      bank: allocationTotals.bankTotal,
      gold: allocationTotals.goldTotal,
      stock: allocationTotals.stockTotal,
    }
    const total = Object.values(raw).reduce((a, b) => a + b, 0)
    return Object.entries(raw)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([type, value]) => ({
        type,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: ALLOC_COLORS[type]?.color ?? '#94a3b8',
        label: isVi ? (ALLOC_COLORS[type]?.labelVi ?? type) : (ALLOC_COLORS[type]?.label ?? type),
      }))
  })() : []

  const kpis = [
    { l: isVi ? 'Đã đầu tư'       : 'Invested',     v: netWorth.totalInvested },
    { l: isVi ? 'Giá trị hiện tại' : 'Current value', v: netWorth.currentValue },
    { l: isVi ? 'Tổng tài sản'     : 'Total Assets',  v: netWorth.totalAssets },
    { l: isVi ? 'Nợ'               : 'Liabilities',  v: netWorth.totalLiabilities },
  ]

  return (
    <div data-testid="desktop-net-worth-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="cn-card" style={{ padding: '22px 20px 18px' }}>
        {/* Label */}
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6 }}>
          {isVi ? 'Tài sản ròng' : 'Net worth'}
        </div>

        {/* Value — pulses + shows an XS Cairn while re-fetching (value stays visible).
            The `num-refresh` wrapper is what scopes the `.num` pulse animation. */}
        <div className={refreshing ? 'num-refresh' : undefined} style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={refreshing ? 'num' : undefined}>{fmtCompact(netWorth.netWorth)}</span>
          {refreshing && <CairnLoader size={14} variant="muted" />}
        </div>

        {/* P&L chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600,
            background: isPos ? 'var(--c-pos-tint)' : 'var(--c-neg-tint)',
            color: isPos ? 'var(--c-pos)' : 'var(--c-neg)',
          }}>
            {fmtPct(netWorth.overallProfitLossPercentage)}
          </span>
          <span style={{ fontSize: 12, color: isPos ? 'var(--c-pos)' : 'var(--c-neg)', fontWeight: 500 }}>
            {isPos ? '+' : ''}{fmtCompact(netWorth.overallProfitLoss)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>
            {isVi ? 'tổng thể' : 'overall'}
          </span>
        </div>

        {/* Sparkline */}
        <div style={{ marginTop: 16, paddingBottom: 4 }}>
          {history.length > 1
            ? <Sparkline data={history} positive={isPos} height={SPARKLINE_HEIGHT} />
            : <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>{isVi ? 'Không có dữ liệu' : 'No history yet'}</span>
              </div>
          }
        </div>

        {/* Range pills */}
        <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
          {TIME_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange?.(r)}
              aria-pressed={timeRange === r}
              style={{
                flex: 1, padding: '4px 0',
                border: 'none', cursor: 'pointer',
                background: timeRange === r ? 'var(--c-navy-tint)' : 'transparent',
                color: timeRange === r ? 'var(--c-navy)' : 'var(--c-muted)',
                fontSize: 11, fontWeight: 600, borderRadius: 5,
                fontFamily: 'inherit',
                transition: 'background 120ms, color 120ms',
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* KPI 2×2 grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, marginTop: 16, background: 'var(--c-line)', borderRadius: 10, overflow: 'hidden' }}>
          {kpis.map((k, i) => (
            <div key={i} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{k.l}</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{fmtCompact(k.v)}</div>
            </div>
          ))}
        </div>

        {/* Allocation bar + breakdown */}
        {segments.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div
              data-testid="allocation-bar"
              style={{ display: 'flex', height: 7, borderRadius: 999, overflow: 'hidden', gap: 1.5, background: 'var(--c-card-2)' }}
            >
              {segments.map((seg, i) => (
                <div
                  key={seg.type}
                  style={{
                    width: `${seg.pct}%`,
                    background: seg.color,
                    borderRadius: i === 0
                      ? '999px 0 0 999px'
                      : i === segments.length - 1
                        ? '0 999px 999px 0'
                        : 0,
                  }}
                />
              ))}
            </div>
            {/* Breakdown — one row per segment */}
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
              {segments.map((seg, i) => (
                <div
                  key={seg.type}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto auto',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--c-line)',
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--c-ink)', fontWeight: 500 }}>{seg.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right' }}>
                    {seg.pct.toFixed(seg.pct < 10 ? 1 : 0)}%
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums', minWidth: 64, textAlign: 'right' }}>
                    {seg.type === 'gold' && goldUnits != null && goldUnits > 0
                      ? (isVi ? `${goldUnits.toFixed(goldUnits < 10 ? 1 : 0)} chỉ` : `${goldUnits.toFixed(goldUnits < 10 ? 1 : 0)} ${goldUnits === 1 ? 'unit' : 'units'}`)
                      : fmtCompact(seg.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Download report */}
      <button
        data-testid="generate-report-btn"
        onClick={onDownloadReport}
        className="cn-btn"
        style={{ width: '100%', justifyContent: 'center', gap: 7, fontSize: 13, padding: '10px 14px' }}
      >
        <ArrowDownToLine size={15} strokeWidth={2} />
        {isVi ? 'Xuất báo cáo' : 'Download report'}
      </button>

      {navUpdatedAt && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--c-muted)', textAlign: 'center' }}>
          {isVi ? 'NAV cập nhật' : 'NAV updated'} {fmtTimeAgo(navUpdatedAt, locale)}
        </p>
      )}
    </div>
  )
}
