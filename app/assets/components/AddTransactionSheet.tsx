'use client'

import { useState, useEffect } from 'react'
import { X, TrendingUp, Building2, Coins, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface Fund { id: string; name: string; nav: number; code: string | null }
interface Goal { goal_id: string; goal_name: string }

interface Props {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '10px 12px', fontSize: 14,
  background: 'var(--c-card-2)', border: '1px solid var(--c-line)',
  borderRadius: 10, color: 'var(--c-ink)', fontFamily: 'inherit',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--c-muted)', marginBottom: 6,
}

const ASSET_TYPES = [
  { v: 'fund', Icon: TrendingUp, enLabel: 'Fund',  viLabel: 'Quỹ' },
  { v: 'bank', Icon: Building2,  enLabel: 'Bank',  viLabel: 'Ngân hàng' },
  { v: 'gold', Icon: Coins,      enLabel: 'Gold',  viLabel: 'Vàng' },
] as const

type AssetType = typeof ASSET_TYPES[number]['v']

const GOLD_PROVIDERS = ['PNJ', 'DOJI', 'SJC', 'Bảo Tín']

export default function AddTransactionSheet({ open, onClose, onSaved }: Props) {
  const t = useTranslations('addTx')
  const tc = useTranslations('common')

  const [mounted, setMounted] = useState(open)
  const [funds, setFunds] = useState<Fund[]>([])
  const [goals, setGoals] = useState<Goal[]>([])

  // form state
  const [assetType, setAssetType] = useState<AssetType>('fund')
  const [dir, setDir] = useState<'buy' | 'sell'>('buy')
  const [goalId, setGoalId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')

  // fund fields
  const [fundId, setFundId] = useState('')
  const [amount, setAmount] = useState('')
  const [units, setUnits] = useState('')

  // bank fields
  const [bankName, setBankName] = useState('')
  const [depositType, setDepositType] = useState<'term' | 'flex'>('term')
  const [bankAmount, setBankAmount] = useState('')
  const [rate, setRate] = useState('')
  const [maturity, setMaturity] = useState('')

  // gold fields
  const [goldProvider, setGoldProvider] = useState('PNJ')
  const [goldQty, setGoldQty] = useState('')
  const [goldPrice, setGoldPrice] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Fetch funds + goals in parallel
      Promise.all([
        fetch('/api/v1/funds').then(r => r.json()),
        fetch('/api/v1/savings-goals').then(r => r.json()),
      ]).then(([fundsData, goalsData]) => {
        const fundList: Fund[] = Array.isArray(fundsData) ? fundsData : []
        const goalList: Goal[] = Array.isArray(goalsData) ? goalsData : []
        setFunds(fundList)
        setGoals(goalList)
        if (fundList.length > 0 && !fundId) setFundId(fundList[0].id)
      }).catch(() => {})
    } else {
      const t = setTimeout(() => {
        setMounted(false)
        resetForm()
      }, 220)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function resetForm() {
    setAssetType('fund')
    setDir('buy')
    setGoalId('')
    setDate(new Date().toISOString().slice(0, 10))
    setNote('')
    setFundId('')
    setAmount('')
    setUnits('')
    setBankName('')
    setDepositType('term')
    setBankAmount('')
    setRate('')
    setMaturity('')
    setGoldProvider('PNJ')
    setGoldQty('')
    setGoldPrice('')
    setError('')
  }

  function handleAssetTypeChange(v: AssetType) {
    setAssetType(v)
    setDir('buy')
    setError('')
  }

  // Auto-calculate units from amount when fund is selected
  const selectedFund = funds.find(f => f.id === fundId)
  const autoUnits = selectedFund && amount && !units
    ? (Number(amount.replace(/\./g, '')) / selectedFund.nav).toFixed(2)
    : units

  async function handleSave() {
    setError('')

    let body: Record<string, unknown> = {
      asset_type: assetType,
      transaction_type: dir === 'buy' ? 'investment' : 'withdrawal',
      investment_date: date,
      notes: note || null,
      goal_id: goalId || null,
    }

    if (assetType === 'fund') {
      const amt = Number(amount.replace(/\./g, ''))
      if (!fundId) { setError(t('fundRequired')); return }
      if (!amt) { setError(t('amountRequired')); return }
      body = {
        ...body,
        fund_id: fundId,
        amount_vnd: amt,
        units: units ? Number(units) : (selectedFund ? amt / selectedFund.nav : null),
        unit_price: selectedFund?.nav ?? null,
      }
    } else if (assetType === 'bank') {
      const amt = Number(bankAmount.replace(/\./g, ''))
      if (!amt) { setError(t('amountRequired')); return }
      body = {
        ...body,
        amount_vnd: amt,
        notes: bankName || note || null,
        interest_rate: rate ? Number(rate) : null,
        expiry_date: maturity || null,
      }
    } else {
      // gold
      const qty = Number(goldQty)
      const price = Number(goldPrice.replace(/\./g, ''))
      if (!qty || !price) { setError(t('amountRequired')); return }
      body = {
        ...body,
        amount_vnd: Math.round(qty * price),
        units: qty,
        unit_price: price,
        notes: goldProvider || null,
      }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/v1/investment-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? tc('error'))
      } else {
        onClose()
        onSaved?.()
      }
    } catch {
      setError(tc('error'))
    } finally {
      setSaving(false)
    }
  }

  if (!mounted) return null

  const isVI = false // will be driven by next-intl locale in future
  const dirLabels = {
    fund:  { buy: t('buy'),      sell: t('sell')     },
    bank:  { buy: t('deposit'),  sell: t('withdraw') },
    gold:  { buy: t('buy'),      sell: t('sell')     },
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 100,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: open ? 'fade-in 180ms ease' : 'fade-out 180ms ease forwards',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, maxHeight: '90dvh',
          background: 'var(--c-card)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: '8px 16px 32px',
          overflowY: 'auto',
          animation: open ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'slide-down 180ms ease forwards',
          boxShadow: '0 -8px 24px rgba(0,0,0,0.12)',
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--c-ink)' }}>
            {t('title')}
          </h3>
          <button
            onClick={onClose}
            style={{ padding: 6, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)', display: 'flex' }}
            aria-label={tc('cancel')}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg, #dc2626)' }}>{error}</p>}

          {/* Asset type */}
          <div>
            <label style={labelStyle}>{t('assetType')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {ASSET_TYPES.map(({ v, Icon, enLabel }) => {
                const active = assetType === v
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleAssetTypeChange(v)}
                    style={{
                      padding: '9px 4px',
                      background: active ? 'var(--c-navy-tint)' : 'var(--c-card-2)',
                      color: active ? 'var(--c-navy)' : 'var(--c-muted)',
                      border: `1.5px solid ${active ? 'var(--c-navy)' : 'transparent'}`,
                      borderRadius: 10,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: 11, fontWeight: 600, transition: 'all 150ms',
                    }}
                  >
                    <Icon size={16} strokeWidth={active ? 2 : 1.6} />
                    {enLabel}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Direction */}
          <div>
            <label style={labelStyle}>{t('direction')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {(['buy', 'sell'] as const).map((d) => {
                const active = dir === d
                const col = d === 'buy' ? 'var(--c-pos, #16a34a)' : 'var(--c-neg, #dc2626)'
                const label = dirLabels[assetType][d]
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDir(d)}
                    style={{
                      padding: '10px 8px',
                      background: active ? col : 'var(--c-card-2)',
                      color: active ? '#fff' : 'var(--c-ink)',
                      border: `1px solid ${active ? col : 'var(--c-line)'}`,
                      borderRadius: 10,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: 13, fontWeight: 600, transition: 'all 150ms',
                    }}
                  >
                    {d === 'buy'
                      ? <ArrowUpRight size={14} strokeWidth={2.2} />
                      : <ArrowDownRight size={14} strokeWidth={2.2} />}
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Goal */}
          {goals.length > 0 && (
            <div>
              <label style={labelStyle}>{t('goal')}</label>
              <select
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
                style={{ ...inputStyle }}
              >
                <option value="">{t('noGoal')}</option>
                {goals.map(g => (
                  <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--c-line)', margin: '0 -2px' }} />

          {/* Fund-specific */}
          {assetType === 'fund' && (
            <>
              <div>
                <label style={labelStyle}>{t('fund')}</label>
                <select
                  value={fundId}
                  onChange={(e) => { setFundId(e.target.value); setUnits('') }}
                  style={{ ...inputStyle }}
                >
                  {funds.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.code ? `${f.code} — ` : ''}{f.name}
                    </option>
                  ))}
                  {funds.length === 0 && <option value="">{t('noFunds')}</option>}
                </select>
                {selectedFund && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--c-muted)' }}>
                    NAV {selectedFund.nav.toLocaleString('vi-VN')} ₫
                  </p>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>{t('amount')}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value.replace(/[^0-9]/g, '')); setUnits('') }}
                    placeholder="5.000.000"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t('units')}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={units || autoUnits || ''}
                    onChange={(e) => setUnits(e.target.value)}
                    placeholder="Auto"
                    style={inputStyle}
                  />
                </div>
              </div>
            </>
          )}

          {/* Bank-specific */}
          {assetType === 'bank' && (
            <>
              <div>
                <label style={labelStyle}>{t('bankName')}</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Techcombank"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t('depositType')}</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {(['term', 'flex'] as const).map(opt => {
                    const active = depositType === opt
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setDepositType(opt)}
                        style={{
                          padding: '9px 6px', borderRadius: 10,
                          background: active ? 'var(--c-navy-tint)' : 'var(--c-card-2)',
                          color: active ? 'var(--c-navy)' : 'var(--c-muted)',
                          border: `1px solid ${active ? 'var(--c-navy)' : 'var(--c-line)'}`,
                          cursor: 'pointer', fontFamily: 'inherit',
                          fontSize: 12, fontWeight: 500, transition: 'all 120ms',
                        }}
                      >
                        {opt === 'term' ? t('termDeposit') : t('flexDeposit')}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: depositType === 'term' ? '1.2fr 1fr' : '1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>{t('principal')}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={bankAmount}
                    onChange={(e) => setBankAmount(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="10.000.000"
                    style={inputStyle}
                  />
                </div>
                {depositType === 'term' && (
                  <div>
                    <label style={labelStyle}>{t('rate')}</label>
                    <input
                      type="number"
                      step="0.1"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="5.5"
                      style={inputStyle}
                    />
                  </div>
                )}
              </div>
              {depositType === 'term' && (
                <div>
                  <label style={labelStyle}>{t('maturity')}</label>
                  <input
                    type="date"
                    value={maturity}
                    onChange={(e) => setMaturity(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              )}
            </>
          )}

          {/* Gold-specific */}
          {assetType === 'gold' && (
            <>
              <div>
                <label style={labelStyle}>{t('provider')}</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {GOLD_PROVIDERS.map(p => {
                    const active = goldProvider === p
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setGoldProvider(p)}
                        style={{
                          fontSize: 11, padding: '4px 9px', borderRadius: 999,
                          background: active ? 'rgba(180,83,9,0.08)' : 'var(--c-card-2)',
                          color: active ? '#b45309' : 'var(--c-muted)',
                          border: `1.5px solid ${active ? '#b45309' : 'transparent'}`,
                          cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                        }}
                      >
                        {p}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>{t('qty')}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={goldQty}
                    onChange={(e) => setGoldQty(e.target.value)}
                    placeholder="1"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t('pricePerUnit')}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={goldPrice}
                    onChange={(e) => setGoldPrice(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="9.200.000"
                    style={inputStyle}
                  />
                </div>
              </div>
              {goldQty && goldPrice && (
                <div style={{
                  background: 'var(--c-card-2)', borderRadius: 10, padding: '9px 12px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)', fontWeight: 500 }}>{t('total')}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {(Number(goldQty) * Number(goldPrice.replace(/[^0-9]/g, ''))).toLocaleString('vi-VN')} ₫
                  </span>
                </div>
              )}
            </>
          )}

          {/* Common: date + note */}
          <div>
            <label style={labelStyle}>{t('date')}</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>{t('note')}</label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              style={{ ...inputStyle, resize: 'none' }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 10,
                background: 'var(--c-card-2)', border: '1px solid var(--c-line)',
                color: 'var(--c-ink)', fontSize: 14, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {tc('cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 2, padding: '12px 16px', borderRadius: 10,
                background: 'var(--c-btn-primary)', border: 'none',
                color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? tc('saving') : tc('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
