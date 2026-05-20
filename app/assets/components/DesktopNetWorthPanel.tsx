'use client'

import { useState, useEffect } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import { fmtCompact, fmtPct } from '@/lib/formatters'
import type { DashboardData } from '../DashboardClient'

const TIME_RANGES = ['1M', '3M', '6M', '1Y', 'All'] as const
type TimeRange = typeof TIME_RANGES[number]

const RANGE_PARAM: Record<TimeRange, string> = {
  '1M': '1m', '3M': '3m', '6M': '6m', '1Y': '1y', 'All': 'all',
}

interface ChartPoint { label: string; value: number }

function fmtTimeAgo(isoString: string, locale: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diffMs / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const isVi = locale === 'vi'
  if (days > 0) return isVi ? `${days} ngày trước` : `${days}d ago`
  if (hours > 0) return isVi ? `${hours} giờ trước` : `${hours}h ago`
  return isVi ? `${mins} phút trước` : `${mins}m ago`
}

function Sparkline({ data, positive }: { data: ChartPoint[]; positive: boolean }) {
  if (data.length < 2) return null
  const values = data.map((d) => d.value)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = (rawMax - rawMin) * 0.15 || rawMax * 0.1 || 1
  const min = Math.max(0, rawMin - pad)
  const max = rawMax + pad
  const range = max - min || 1
  const W = 100
  const H = 40
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W
      const y = H - ((v - min) / range) * (H - 6) - 3
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const color = positive ? 'var(--c-pos)' : 'var(--c-neg)'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const ALLOC_COLORS: Record<string, { color: string; label: string; labelVi: string }> = {
  fund:  { color: '#2563eb', label: 'Funds',   labelVi: 'Quỹ' },
  bank:  { color: '#047857', label: 'Savings', labelVi: 'Tiết kiệm' },
  gold:  { color: '#d97706', label: 'Gold',    labelVi: 'Vàng' },
  stock: { color: '#7c3aed', label: 'Stock',   labelVi: 'Cổ phiếu' },
}

interface AllocationTotals {
  equityTotal: number
  bondTotal: number
  balancedTotal: number
  bankTotal: number
  goldTotal: number
  stockTotal: number
  cashTotal: number
}

interface Props {
  data: DashboardData
  allocationTotals: AllocationTotals | null
  locale: string
  refreshKey?: number
  navUpdatedAt?: string | null
  onDownloadReport: () => void
}

export default function DesktopNetWorthPanel({ data, allocationTotals, locale, refreshKey, navUpdatedAt, onDownloadReport }: Props) {
  const { netWorth } = data
  const isPos = netWorth.overallProfitLoss >= 0
  const isVi = locale === 'vi'
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y')
  const [history, setHistory] = useState<ChartPoint[]>([])

  useEffect(() => {
    fetch(`/api/v1/dashboard/history?range=${RANGE_PARAM[timeRange]}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : [])
      .then((d: ChartPoint[]) => setHistory(d))
      .catch(() => setHistory([]))
  }, [timeRange, refreshKey])

  const segments = allocationTotals ? (() => {
    const raw: Record<string, number> = {
      fund: allocationTotals.equityTotal + allocationTotals.bondTotal + allocationTotals.balancedTotal,
      bank: allocationTotals.bankTotal,
      gold: allocationTotals.goldTotal,
      stock: allocationTotals.stockTotal,
    }
    const total = Object.values(raw).reduce((a, b) => a + b, 0)
    return Object.entries(raw)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([type, value], _i) => ({
        type,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: ALLOC_COLORS[type]?.color ?? '#94a3b8',
        label: isVi ? (ALLOC_COLORS[type]?.labelVi ?? type) : (ALLOC_COLORS[type]?.label ?? type),
      }))
  })() : []

  const kpis = [
    { l: isVi ? 'Đã đầu tư'       : 'Invested',     v: netWorth.totalInvested },
    { l: isVi ? 'Giá trị hiện tại' : 'Current',      v: netWorth.currentValue },
    { l: isVi ? 'Tổng tài sản'     : 'Total assets', v: netWorth.totalAssets },
    { l: isVi ? 'Nợ'               : 'Liabilities',  v: netWorth.totalLiabilities },
  ]

  return (
    <div data-testid="desktop-net-worth-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="cn-card" style={{ padding: '22px 20px 18px' }}>
        {/* Label */}
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6 }}>
          {isVi ? 'Tài sản ròng' : 'Net worth'}
        </div>

        {/* Value */}
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--c-ink)' }}>
          {fmtCompact(netWorth.netWorth)}
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
            {isVi ? 'tổng' : 'overall'}
          </span>
        </div>

        {/* Sparkline */}
        <div style={{ marginTop: 16, paddingBottom: 4 }}>
          {history.length > 1
            ? <Sparkline data={history} positive={isPos} />
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
              onClick={() => setTimeRange(r)}
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

        {/* Allocation bar */}
        {segments.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div
              data-testid="allocation-bar"
              style={{ display: 'flex', height: 7, borderRadius: 999, overflow: 'hidden', gap: 1.5 }}
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 10 }}>
              {segments.map(seg => (
                <div key={seg.type} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>{seg.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{seg.pct.toFixed(0)}%</span>
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
