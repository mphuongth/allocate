'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Calendar, ArrowUpRight, ArrowDownRight, ArrowRight } from 'lucide-react'
import { fmtCompact } from '@/lib/formatters'
import TransactionLedgerSheet from './TransactionLedgerSheet'
import {
  type LedgerTransaction,
  type AssetType,
  isWithdrawal,
  txPrimaryName,
  fmtTxDate,
} from './transactionUtils'

// Asset-type badge colors for investment rows. Withdrawals use the negative
// color regardless of asset.
const ASSET_BADGE: Record<AssetType, string> = {
  fund: '#2563eb',
  bank: '#047857',
  stock: '#7c3aed',
  gold: '#b45309',
}

interface Props {
  locale: string
  /** Desktop renders the ledger as a centered modal; mobile as a bottom sheet. */
  desktop?: boolean
  /** Bumped by the dashboard when it refetches, so the preview stays fresh. */
  refreshKey?: number
  /** Called after a mutation in the ledger so the dashboard can refresh. */
  onChanged?: () => void
}

export default function RecentActivityCard({ locale, desktop, refreshKey, onChanged }: Props) {
  const t = useTranslations('dashboard')
  const tt = useTranslations('transactions')
  const [txs, setTxs] = useState<LedgerTransaction[]>([])
  const [total, setTotal] = useState(0)
  const [showLedger, setShowLedger] = useState(false)
  const [localKey, setLocalKey] = useState(0)

  const assetLabel = useCallback((tx: LedgerTransaction): string => {
    const a = tx.asset_type
    if (!a) return ''
    return tt(`asset${a.charAt(0).toUpperCase() + a.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold')
  }, [tt])

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/investment-transactions?limit=5')
      .then((r) => (r.ok ? r.json() : { transactions: [], total: 0 }))
      .then((data) => {
        if (cancelled) return
        setTxs(data.transactions ?? [])
        setTotal(data.total ?? 0)
      })
      .catch(() => { if (!cancelled) { setTxs([]); setTotal(0) } })
    return () => { cancelled = true }
  }, [refreshKey, localKey])

  return (
    <section data-testid="recent-activity" style={{
      background: 'var(--c-card)',
      border: '1px solid var(--c-line)',
      borderRadius: 'var(--r-card)',
      boxShadow: 'var(--shadow-card)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '13px 16px', borderBottom: total > 0 ? '1px solid var(--c-line)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-card-2)', color: 'var(--c-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Calendar size={15} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t('recentActivity')}</div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1 }}>{t('transactions', { count: total })}</div>
          </div>
        </div>
        <button
          data-testid="recent-activity-view-all"
          onClick={() => setShowLedger(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '5px 6px', flexShrink: 0 }}
        >
          {t('viewAll')}
          <ArrowRight size={13} />
        </button>
      </div>

      {/* Rows */}
      {total === 0 ? (
        <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--c-muted)', textAlign: 'center' }}>
          {t('recentActivityEmpty')}
        </div>
      ) : (
        txs.map((tx, i) => {
          const withdrawal = isWithdrawal(tx)
          const color = withdrawal ? 'var(--c-neg)' : 'var(--c-pos)'
          const badgeColor = withdrawal ? 'var(--c-neg)' : (ASSET_BADGE[tx.asset_type as AssetType] ?? 'var(--c-muted)')
          const badgeText = withdrawal ? tt('withdrawal') : assetLabel(tx)
          const goalName = tx.savings_goals?.goal_name ?? tt('noGoal')
          return (
            <div
              key={tx.transaction_id}
              data-testid="recent-activity-row"
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: i < txs.length - 1 ? '1px solid var(--c-line)' : 'none' }}
            >
              <div style={{ width: 30, height: 30, borderRadius: 8, background: `color-mix(in srgb, ${color} 12%, transparent)`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {withdrawal ? <ArrowDownRight size={14} strokeWidth={2.2} /> : <ArrowUpRight size={14} strokeWidth={2.2} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 999, color: badgeColor, background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`, flexShrink: 0 }}>
                    {badgeText}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {txPrimaryName(tx, assetLabel(tx))}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 2 }}>
                  {goalName} · {fmtTxDate(tx.investment_date, locale)}
                </div>
              </div>
              <span className="tabular" style={{ fontSize: 12, fontWeight: 600, color, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {withdrawal ? '−' : '+'}{fmtCompact(tx.amount_vnd)}
              </span>
            </div>
          )
        })
      )}

      <TransactionLedgerSheet
        open={showLedger}
        desktop={desktop}
        locale={locale}
        onClose={() => setShowLedger(false)}
        onChanged={() => { setLocalKey((k) => k + 1); onChanged?.() }}
      />
    </section>
  )
}
