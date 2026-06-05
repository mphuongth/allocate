'use client'

import { useState, useEffect } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { fmt, fmtCompact, fmtPct } from '@/lib/formatters'

const TIME_RANGES = ['1M', '3M', '6M', '1Y', 'All'] as const
type TimeRange = typeof TIME_RANGES[number]

const RANGE_PARAM: Record<TimeRange, string> = {
  '1M': '1m', '3M': '3m', '6M': '6m', '1Y': '1y', 'All': 'all',
}

interface ChartPoint { label: string; value: number }

// SVG sparkline — no recharts dependency
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
  const H = 36
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

const ALLOC_COLORS = {
  fund:  '#2563eb',
  bank:  '#047857',
  gold:  'var(--c-fund-gold)',
  stock: '#7c3aed',
} as const

function AllocationBar({ fund, bank, gold, stock, goldUnits, locale }: { fund: number; bank: number; gold: number; stock: number; goldUnits?: number; locale: string }) {
  const isVi = locale === 'vi'
  const total = fund + bank + gold + stock
  if (total <= 0) return null
  const segments = [
    { key: 'fund',  value: fund,  color: ALLOC_COLORS.fund,  label: isVi ? 'Quỹ'       : 'Fund' },
    { key: 'bank',  value: bank,  color: ALLOC_COLORS.bank,  label: isVi ? 'Tiết kiệm' : 'Bank' },
    { key: 'gold',  value: gold,  color: ALLOC_COLORS.gold,  label: isVi ? 'Vàng'      : 'Gold' },
    { key: 'stock', value: stock, color: ALLOC_COLORS.stock, label: isVi ? 'Cổ phiếu'  : 'Stock' },
  ].filter((s) => s.value > 0)

  const formatDetail = (key: string, value: number) => {
    if (key === 'gold' && goldUnits != null && goldUnits > 0) {
      const u = goldUnits.toFixed(goldUnits < 10 ? 1 : 0)
      if (isVi) return `${u} chỉ`
      return `${u} ${goldUnits === 1 ? 'unit' : 'units'}`
    }
    return fmtCompact(value)
  }

  return (
    <div data-testid="allocation-bar" style={{ marginTop: 14 }}>
      {/* Bar */}
      <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex', gap: 1, background: 'var(--c-card-2)' }}>
        {segments.map((s, i) => (
          <div
            key={s.key}
            style={{
              flex: s.value / total,
              background: s.color,
              minWidth: 4,
              borderRadius: i === 0 ? '999px 0 0 999px' : i === segments.length - 1 ? '0 999px 999px 0' : 0,
            }}
          />
        ))}
      </div>
      {/* Breakdown — one row per segment */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
        {segments.map((s, i) => {
          const pct = (s.value / total) * 100
          return (
            <div
              key={s.key}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto auto',
                alignItems: 'center',
                gap: 8,
                padding: '8px 0',
                borderTop: i === 0 ? 'none' : '1px solid var(--c-line)',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--c-ink)', fontWeight: 500 }}>{s.label}</span>
              <span style={{ fontSize: 12, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>
                {pct.toFixed(pct < 10 ? 1 : 0)}%
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums', minWidth: 64, textAlign: 'right' }}>
                {formatDetail(s.key, s.value)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface Props {
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  totalInvested: number
  currentValue: number
  overallProfitLoss: number
  overallProfitLossPercentage: number
  allocationBar?: { fund: number; bank: number; gold: number; stock: number; goldUnits?: number }
  refreshKey?: number
}

export default function NetWorthCard({
  totalAssets, totalLiabilities, netWorth, totalInvested, currentValue,
  overallProfitLoss, overallProfitLossPercentage, allocationBar, refreshKey,
}: Props) {
  const locale = useLocale()
  const t = useTranslations('dashboard')
  const plPositive = overallProfitLoss >= 0
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y')
  const [history, setHistory] = useState<ChartPoint[]>([])

  useEffect(() => {
    fetch(`/api/v1/dashboard/history?range=${RANGE_PARAM[timeRange]}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : [])
      .then((data: ChartPoint[]) => setHistory(data))
      .catch(() => setHistory([]))
  }, [timeRange, refreshKey])

  const kpis = [
    { label: t('invested'),     value: totalInvested },
    { label: t('currentValue'), value: currentValue },
    { label: t('totalAssets'),  value: totalAssets },
    { label: t('liabilities'),  value: totalLiabilities },
  ]

  return (
    <div style={{
      background: 'var(--c-card)',
      border: '1px solid var(--c-line)',
      borderRadius: 'var(--r-card)',
      boxShadow: 'var(--shadow-card)',
      padding: '20px 18px 18px',
    }}>
      {/* Label */}
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6,
      }}>
        {t('netWorth')}
      </div>

      {/* Hero number */}
      <div style={{
        fontSize: 32, fontWeight: 600, letterSpacing: '-0.025em',
        fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)',
        lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {fmt(netWorth)}
      </div>

      {/* P&L row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 999,
          background: plPositive ? 'var(--c-pos-tint)' : 'var(--c-neg-tint)',
          color: plPositive ? 'var(--c-pos)' : 'var(--c-neg)',
        }}>
          {plPositive
            ? <TrendingUp size={12} strokeWidth={2.2} />
            : <TrendingDown size={12} strokeWidth={2.2} />}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmtPct(overallProfitLossPercentage)}
          </span>
        </span>
        <span style={{
          fontSize: 13, fontVariantNumeric: 'tabular-nums',
          color: plPositive ? 'var(--c-pos)' : 'var(--c-neg)',
        }}>
          {overallProfitLoss >= 0 ? '+' : ''}{fmtCompact(overallProfitLoss)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('overall')}</span>
      </div>

      {/* Sparkline */}
      <div style={{ marginTop: 16, paddingBottom: 6 }}>
        {history.length > 1
          ? <Sparkline data={history} positive={plPositive} />
          : <div style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>{t('noHistoryYet')}</span>
            </div>
        }
      </div>

      {/* Range pills */}
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {TIME_RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setTimeRange(r)}
            style={{
              flex: 1, padding: '5px 0',
              border: 'none', cursor: 'pointer',
              background: timeRange === r ? 'var(--c-navy-tint)' : 'transparent',
              color: timeRange === r ? 'var(--c-navy)' : 'var(--c-muted)',
              fontSize: 11, fontWeight: 600, borderRadius: 6,
              fontFamily: 'inherit',
              transition: 'background 120ms, color 120ms',
            }}
          >
            {r}
          </button>
        ))}
      </div>

      {/* KPI 2×2 grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 1, marginTop: 16,
        background: 'var(--c-line)', borderRadius: 10, overflow: 'hidden',
      }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>{k.label}</div>
            <div style={{
              fontSize: 14, fontWeight: 600, marginTop: 2,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtCompact(k.value)}
            </div>
          </div>
        ))}
      </div>

      {/* Allocation bar */}
      {allocationBar && <AllocationBar {...allocationBar} locale={locale} />}
    </div>
  )
}
