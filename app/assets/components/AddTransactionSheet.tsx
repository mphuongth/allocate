'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, TrendingUp, Building2, Coins, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { iconHit } from './iconHit'
import { useLocale, useTranslations } from 'next-intl'
import DialogShell from '@/components/ui/DialogShell'
import { CairnLoader } from '@/components/ui/CairnLoader'
import { todayIso } from '@/lib/dates'
import { computeFundPricing, computeSellPreview, buildBuyPayload, buildEditPayload, buildSellPayload, type TxForm } from './addTransactionModel'
import { BuyFundFields, BuyBankFields, BuyGoldFields, SellForm } from './addTransactionForms'

export interface Fund { id: string; name: string; nav: number; code: string | null; fund_type?: string }
interface Goal { goal_id: string; goal_name: string; completed_at?: string | null }
export interface Bank { code: string; name: string; logo_url?: string | null }

// A sellable position, collected from the dashboard overview. Funds live in
// goals or unallocated; bank/gold live in unallocated.
export interface Holding {
  key: string
  name: string
  source: string
  /**
   * The goal this position sits in (null = unallocated). `source` is its NAME,
   * for display; the sell payload needs the id — a fund's balance is the
   * (goal, fund) bucket, so a sell without it draws down the wrong one (#587).
   */
  goalId: string | null
  type: AssetType
  currentValue: number
  units: number | null
  navPerUnit: number | null
  gainPct: number | null
  interestRate: number | null
  fundId?: string
  transactionId?: string
  purchasePrice?: number
  /** Fund only: the bucket's remaining cost basis, which a sale draws from (#587). */
  costBasis?: number
}

function collectHoldings(d: {
  goals?: { goalId?: string; goalName: string; funds?: FundLike[]; nonFunds?: NonFundLike[] }[]
  unallocated?: { funds?: FundLike[]; nonFunds?: NonFundLike[] }
}): Holding[] {
  const out: Holding[] = []
  // Funds: allocated to goals or unallocated. Each position keeps the goal's id
  // as well as its name — the sell posts the id (#587).
  const fundSources: { f: FundLike; source: string; goalId: string | null }[] = [
    ...(d.goals ?? []).flatMap((g) => (g.funds ?? []).map((f) => ({ f, source: g.goalName, goalId: g.goalId ?? null }))),
    ...((d.unallocated?.funds) ?? []).map((f) => ({ f, source: 'Unallocated', goalId: null })),
  ]
  fundSources.forEach(({ f, source, goalId }, i) => {
    out.push({
      key: `fund-${f.fundId}-${i}`, name: f.fundName, source, goalId, type: 'fund',
      currentValue: f.currentValue, units: f.quantity, navPerUnit: f.currentNAV,
      gainPct: f.profitLossPercentage, interestRate: null,
      fundId: f.fundId, purchasePrice: f.purchasePrice, costBasis: f.costBasis,
    })
  })
  // Bank / gold: also allocated to goals or unallocated.
  const nonFundSources: { it: NonFundLike; source: string; goalId: string | null }[] = [
    ...(d.goals ?? []).flatMap((g) => (g.nonFunds ?? []).map((it) => ({ it, source: g.goalName, goalId: g.goalId ?? null }))),
    ...((d.unallocated?.nonFunds) ?? []).map((it) => ({ it, source: 'Unallocated', goalId: null })),
  ]
  nonFundSources.forEach(({ it, source, goalId }, i) => {
    if (it.type !== 'bank' && it.type !== 'gold') return
    out.push({
      key: `nf-${it.transactionId}-${i}`, name: it.notes || it.type, source, goalId,
      type: it.type as AssetType,
      currentValue: it.currentValue, units: it.units,
      navPerUnit: it.units && it.units > 0 ? it.currentValue / it.units : null,
      gainPct: null, interestRate: it.interestRate,
      transactionId: it.transactionId, purchasePrice: it.amount,
    })
  })
  return out
}

interface FundLike { fundId: string; fundName: string; quantity: number; currentNAV: number; currentValue: number; purchasePrice: number; costBasis?: number; profitLossPercentage: number }
interface NonFundLike { transactionId: string; type: string; amount: number; currentValue: number; interestRate: number | null; units: number | null; notes: string | null }

// When set, the sheet opens in edit mode: fields are prefilled from this
// transaction and saving issues a PUT instead of a POST. Editing is limited to
// investments (buy/deposit) — withdrawals are managed via the sell flow.
export interface EditableTransaction {
  transaction_id: string
  asset_type: string | null
  investment_date: string
  amount_vnd: number
  unit_price: number | null
  units: number | null
  interest_rate: number | null
  expiry_date: string | null
  notes: string | null
  fund_id: string | null
  goal_id: string | null
  // Structured bank reference (FK to banks.code). Null on legacy deposits.
  bank_code?: string | null
  // Set on every row of an accumulating book (anchor and tranches alike). It is
  // what makes the deposit a book — there is no separate "type" column — so the
  // edit form reads the savings type from it.
  deposit_group_id?: string | null
  top_up_lock_days?: number | null
}

// When set (and `existing` is not), the sheet opens in create mode with these
// fields pre-filled — e.g. logging a contribution toward a goal, or recording a
// recurring bank deposit. Saving still issues a POST (a brand-new transaction).
export interface PrefillTransaction {
  asset_type?: string | null
  amount_vnd?: number | null
  goal_id?: string | null
  investment_date?: string | null
  // Associates the new transaction with a monthly plan so it counts toward that
  // month's By-goal contributions (the plan queries transactions by plan_id).
  plan_id?: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  onSaved?: () => void
  desktop?: boolean
  existing?: EditableTransaction | null
  prefill?: PrefillTransaction | null
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '10px 12px', fontSize: 16,
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
  { v: 'fund', Icon: TrendingUp, enLabel: 'Fund', viLabel: 'Quỹ',       color: '#2563eb', bg: 'rgba(37,99,235,0.10)' },
  { v: 'bank', Icon: Building2,  enLabel: 'Bank', viLabel: 'Ngân hàng', color: '#047857', bg: 'rgba(4,120,87,0.10)' },
  { v: 'gold', Icon: Coins,      enLabel: 'Gold', viLabel: 'Vàng',      color: 'var(--c-fund-gold)', bg: 'rgba(180,83,9,0.10)' },
] as const

type AssetType = typeof ASSET_TYPES[number]['v']

// The visible heading is the dialog's accessible name. One id for both
// wrappers: only ever one of them is on screen.
const TITLE_ID = 'add-transaction-title'

export default function AddTransactionSheet({ open, onClose, onSaved, desktop, existing, prefill }: Props) {
  const t = useTranslations('addTx')
  const tc = useTranslations('common')
  const isVI = useLocale() === 'vi'

  const [mounted, setMounted] = useState(open)
  const [funds, setFunds] = useState<Fund[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [banks, setBanks] = useState<Bank[]>([])

  // form state
  const [assetType, setAssetType] = useState<AssetType>('fund')
  const [dir, setDir] = useState<'buy' | 'sell'>('buy')
  const [goalId, setGoalId] = useState('')
  // A finished goal is an archive, so it is never a destination — except for the
  // one this very holding is already filed under, which is listed (disabled) so
  // the select states where the money sits instead of silently reading
  // "No goal" (#650).
  const goalOptions = useMemo(() => {
    const active = goals.filter((g) => !g.completed_at)
    const own = goals.find((g) => g.goal_id === goalId && g.completed_at)
    return own ? [own, ...active] : active
  }, [goals, goalId])
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')

  // fund fields
  const [fundId, setFundId] = useState('')
  const [amount, setAmount] = useState('')
  const [units, setUnits] = useState('')
  const [nav, setNav] = useState('')  // editable unit price; defaults to the fund's current NAV

  // bank fields
  const [bankCode, setBankCode] = useState('')
  const [depositType, setDepositType] = useState<'term' | 'flex' | 'accumulating'>('term')
  const [bankAmount, setBankAmount] = useState('')
  const [rate, setRate] = useState('')
  const [maturity, setMaturity] = useState('')
  const [topUpLockDays, setTopUpLockDays] = useState('')

  // gold fields
  const [goldProvider, setGoldProvider] = useState('PNJ')
  const [goldUnit, setGoldUnit] = useState<'chi' | 'luong'>('chi')
  const [goldQty, setGoldQty] = useState('')
  const [goldPrice, setGoldPrice] = useState('')

  // sell fields — holdings collected lazily from the overview
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [holdingsLoaded, setHoldingsLoaded] = useState(false)
  const [holdingsError, setHoldingsError] = useState(false)
  // Bumped by the retry button to re-run the holdings fetch after a failure.
  const [holdingsReload, setHoldingsReload] = useState(0)
  const [holdingKey, setHoldingKey] = useState('')
  const [sellAmount, setSellAmount] = useState('')        // fund / bank sell amount (₫)
  const [fundSellUnits, setFundSellUnits] = useState('')  // fund sell units (linked to amount)
  const [received, setReceived] = useState('')            // bank cash actually received (₫)
  const [goldSellQty, setGoldSellQty] = useState('')      // gold sell quantity (chỉ)
  const [goldSellPrice, setGoldSellPrice] = useState('')  // gold sale price per chỉ (₫)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // A bank deposit's name is the selected bank (there's no separate name field).
  // Falls back to the general note, then null, when no bank is chosen.
  const selectedBankName = banks.find((b) => b.code === bankCode)?.name ?? ''

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Fetch funds + goals in parallel
      Promise.all([
        fetch('/api/funds').then(r => r.json()),
        // Archived goals come along (#650): a holding filed under a finished goal
        // still opens in this sheet, and without its goal in the list the select
        // would show "No goal" over a form that still holds the finished id.
        // goalOptions decides which of them can actually be chosen.
        fetch('/api/v1/savings-goals?status=all').then(r => r.json()),
        fetch('/api/v1/banks').then(r => r.json()).catch(() => []),
      ]).then(([fundsData, goalsData, banksData]) => {
        // Canonical funds-list contract: GET /api/funds → { funds: [...] } (#470).
        const fundList: Fund[] = Array.isArray(fundsData?.funds) ? fundsData.funds : []
        // /api/v1/savings-goals returns { goals: [...] }, not a bare array.
        const goalList: Goal[] = Array.isArray(goalsData)
          ? goalsData
          : (Array.isArray(goalsData?.goals) ? goalsData.goals : [])
        setFunds(fundList)
        setGoals(goalList)
        setBanks(Array.isArray(banksData) ? banksData : [])
        if (fundList.length > 0 && !fundId && !existing) setFundId(fundList[0].id)
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

  // Edit mode: prefill the form from the existing investment. Only fund / bank
  // / gold are editable here (the asset types this sheet supports); the ledger
  // routes other types to its inline form.
  useEffect(() => {
    if (!open || !existing) return
    const at: AssetType = (existing.asset_type === 'bank' || existing.asset_type === 'gold') ? existing.asset_type : 'fund'
    setAssetType(at)
    setDir('buy')
    setGoalId(existing.goal_id || '')
    setDate(existing.investment_date || todayIso())
    if (at === 'fund') {
      setFundId(existing.fund_id || '')
      setAmount(existing.amount_vnd != null ? String(existing.amount_vnd) : '')
      setUnits(existing.units != null ? String(existing.units) : '')
      setNav(existing.unit_price != null ? String(existing.unit_price) : '')
      setNote(existing.notes || '')
    } else if (at === 'bank') {
      setBankAmount(existing.amount_vnd != null ? String(existing.amount_vnd) : '')
      setRate(existing.interest_rate != null ? String(existing.interest_rate) : '')
      setMaturity(existing.expiry_date || '')
      // A book is a book because it is grouped, whatever its rate — checking the
      // rate first showed every accumulating deposit as "term" on every edit.
      setDepositType(existing.deposit_group_id != null ? 'accumulating' : existing.interest_rate != null ? 'term' : 'flex')
      setTopUpLockDays(existing.top_up_lock_days != null ? String(existing.top_up_lock_days) : '')
      setBankCode(existing.bank_code || '')
      // Legacy deposits stored their name only as free text (no bank_code). Keep
      // that text alive in the general note so editing doesn't silently drop it;
      // structured deposits derive their name from the bank, so leave note blank.
      setNote(existing.bank_code ? '' : (existing.notes || ''))
    } else {
      setGoldProvider(existing.notes || 'PNJ')
      setGoldUnit('chi')
      setGoldQty(existing.units != null ? String(existing.units) : '')
      setGoldPrice(existing.unit_price != null ? String(existing.unit_price) : '')
    }
  }, [open, existing])

  // Create mode with prefilled defaults (e.g. logging a contribution from the
  // Plan page). Unlike `existing`, this stays a POST — it just seeds the form.
  useEffect(() => {
    if (!open || existing || !prefill) return
    const at: AssetType = prefill.asset_type === 'bank' || prefill.asset_type === 'gold' ? prefill.asset_type : 'fund'
    setAssetType(at)
    setDir('buy')
    if (prefill.goal_id != null) setGoalId(prefill.goal_id)
    if (prefill.investment_date) setDate(prefill.investment_date)
    if (prefill.amount_vnd != null) {
      const amt = String(prefill.amount_vnd)
      if (at === 'bank') setBankAmount(amt)
      else if (at === 'fund') setAmount(amt)
    }
  }, [open, existing, prefill])

  // Lazily load sellable holdings from the overview the first time the user
  // switches to "Sell" — most opens are buys, so we don't pay for it up front.
  useEffect(() => {
    if (!open || dir !== 'sell' || holdingsLoaded) return
    setHoldingsError(false)
    fetch('/api/v1/dashboard/overview')
      .then(r => { if (!r.ok) throw new Error('load failed'); return r.json() })
      .then((d) => { setHoldings(collectHoldings(d ?? {})); setHoldingsLoaded(true) })
      // A failed load must show a retry — not the "no holdings" empty state,
      // which would falsely tell a user with holdings they have nothing to sell.
      .catch(() => setHoldingsError(true))
  }, [open, dir, holdingsLoaded, holdingsReload])

  // Lock background scroll while the sheet is open so the page behind it can't move.
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  function resetForm() {
    setAssetType('fund')
    setDir('buy')
    setGoalId('')
    setDate(todayIso())
    setNote('')
    setFundId('')
    setAmount('')
    setUnits('')
    setNav('')
    setBankCode('')
    setDepositType('term')
    setBankAmount('')
    setRate('')
    setMaturity('')
    setTopUpLockDays('')
    setGoldProvider('PNJ')
    setGoldUnit('chi')
    setGoldQty('')
    setGoldPrice('')
    setHoldingKey('')
    setSellAmount('')
    setFundSellUnits('')
    setReceived('')
    setGoldSellQty('')
    setGoldSellPrice('')
    setError('')
  }

  function handleAssetTypeChange(v: AssetType) {
    setAssetType(v)
    setDir('buy')
    setHoldingKey('')
    setSellAmount('')
    setFundSellUnits('')
    setReceived('')
    setGoldSellQty('')
    setGoldSellPrice('')
    setError('')
  }

  function handleDirChange(d: 'buy' | 'sell') {
    setDir(d)
    setHoldingKey('')
    setSellAmount('')
    setFundSellUnits('')
    setReceived('')
    setGoldSellQty('')
    setGoldSellPrice('')
    setError('')
  }

  // Fund buy pricing + all sell-side preview math live in addTransactionModel (#467);
  // destructured back into the same names the summary UI and handleSave read.
  const selectedFund = funds.find(f => f.id === fundId)
  const { navNum, displayNav, navIsCurrent, autoUnits } = computeFundPricing({ nav, amount, units, currentNav: selectedFund?.nav })

  const sellHoldings = holdings.filter(h => h.type === assetType)
  const selectedHolding = sellHoldings.find(h => h.key === holdingKey) ?? sellHoldings[0] ?? null
  const sell = computeSellPreview({ assetType, dir, holding: selectedHolding, sellAmount, received, goldSellQty, goldSellPrice })
  // The SellForm renders from the full `sell` preview; the sheet only needs these
  // for the submit gate, the buildSellPayload call, and the gold-price prefill.
  const { sellDisabled, numSell, sellOverMax, sellNav, numReceived, bankWithdrawPrincipal, numGoldSellQty, isOverUnits, goldProceeds, goldCost } = sell

  // Prefill the gold sale price with the holding's current price per chỉ.
  useEffect(() => {
    if (dir === 'sell' && assetType === 'gold' && sellNav) {
      setGoldSellPrice(String(Math.round(sellNav)))
    }
  }, [dir, assetType, holdingKey, sellNav])

  async function submitTransaction(url: string, method: 'POST' | 'PUT', payload: Record<string, unknown>) {
    setSaving(true)
    try {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? tc('error')); return }
      onClose()
      onSaved?.()
    } catch {
      setError(tc('error'))
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    setError('')
    const form: TxForm = {
      assetType, date, goalId, note,
      fundId, amount, units, nav, selectedFundNav: selectedFund?.nav,
      bankCode, selectedBankName, depositType, bankAmount, rate, maturity, topUpLockDays,
      goldProvider, goldUnit, goldQty, goldPrice,
    }

    // Edit an existing investment (PUT).
    if (existing) {
      const r = buildEditPayload(form)
      if (!r.ok) { setError(t(r.errorKey)); return }
      await submitTransaction(`/api/v1/investment-transactions/${existing.transaction_id}`, 'PUT', r.payload)
      return
    }

    // Sell / withdraw from the chosen holding (POST).
    if (dir === 'sell') {
      const r = buildSellPayload(selectedHolding, {
        numSell, sellOverMax, sellNav, numGoldSellQty, isOverUnits, goldProceeds, goldCost, numReceived, bankWithdrawPrincipal,
      }, { date, note })
      if (!r.ok) { setError(t(r.errorKey)); return }
      await submitTransaction('/api/v1/investment-transactions', 'POST', r.payload)
      return
    }

    // Buy / create a new investment (POST).
    const r = buildBuyPayload(form, prefill?.plan_id ?? null)
    if (!r.ok) { setError(t(r.errorKey)); return }
    await submitTransaction('/api/v1/investment-transactions', 'POST', r.payload)
  }

  if (desktop ? !open : !mounted) return null

  const dirLabels = {
    fund:  { buy: t('buy'),      sell: t('sell')     },
    bank:  { buy: t('deposit'),  sell: t('withdraw') },
    gold:  { buy: t('buy'),      sell: t('sell')     },
  }

  const formBody = (
        <div style={{ display: 'grid', gap: 16 }}>
          {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg, #dc2626)' }}>{error}</p>}

          {/* Asset type */}
          <div>
            <label style={labelStyle}>{t('assetType')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {ASSET_TYPES.map(({ v, Icon, enLabel, viLabel, color, bg }) => {
                const active = assetType === v
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleAssetTypeChange(v)}
                    style={{
                      padding: '9px 4px',
                      background: active ? bg : 'var(--c-card-2)',
                      color: active ? color : 'var(--c-muted)',
                      border: `1.5px solid ${active ? color : 'transparent'}`,
                      borderRadius: 10,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: 11, fontWeight: 600, transition: 'all 150ms',
                    }}
                  >
                    <Icon size={16} strokeWidth={active ? 2 : 1.6} />
                    {isVI ? viLabel : enLabel}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Direction — hidden when editing (investments only) */}
          {!existing && (
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
                    onClick={() => handleDirChange(d)}
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
          )}

          {/* Goal — attribution applies to Buy/Deposit; for Sell the source
              holding determines the goal (mobile design). */}
          {dir === 'buy' && (
            <div>
              <label style={labelStyle}>{t('goal')}</label>
              <select
                data-testid="addtx-goal-select"
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
                style={{ ...inputStyle }}
              >
                <option value="">{t('noGoal')}</option>
                {goalOptions.map(g => (
                  <option key={g.goal_id} value={g.goal_id} disabled={!!g.completed_at}>{g.goal_name}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--c-line)', margin: '0 -2px' }} />

          {/* Fund-specific */}
          {dir === 'buy' && assetType === 'fund' && (
            <BuyFundFields
              funds={funds} selectedFund={selectedFund}
              fundId={fundId} setFundId={setFundId}
              amount={amount} setAmount={setAmount}
              units={units} setUnits={setUnits} setNav={setNav}
              displayNav={displayNav} navIsCurrent={navIsCurrent}
              autoUnits={autoUnits} navNum={navNum}
              inputStyle={inputStyle} labelStyle={labelStyle}
            />
          )}

          {/* Bank-specific */}
          {dir === 'buy' && assetType === 'bank' && (
            <BuyBankFields
              banks={banks} bankCode={bankCode} setBankCode={setBankCode}
              depositType={depositType} setDepositType={setDepositType}
              bankAmount={bankAmount} setBankAmount={setBankAmount}
              rate={rate} setRate={setRate}
              maturity={maturity} setMaturity={setMaturity} date={date}
              topUpLockDays={topUpLockDays} setTopUpLockDays={setTopUpLockDays}
              lockType={Boolean(existing?.deposit_group_id)}
              inputStyle={inputStyle} labelStyle={labelStyle}
            />
          )}

          {/* Gold-specific */}
          {dir === 'buy' && assetType === 'gold' && (
            <BuyGoldFields
              goldProvider={goldProvider} setGoldProvider={setGoldProvider}
              goldUnit={goldUnit} setGoldUnit={setGoldUnit}
              goldQty={goldQty} setGoldQty={setGoldQty}
              goldPrice={goldPrice} setGoldPrice={setGoldPrice}
              inputStyle={inputStyle} labelStyle={labelStyle}
            />
          )}


          {/* Sell / withdraw — pick a holding, then confirm the amount */}
          {dir === 'sell' && (
            <SellForm
              sell={sell} assetType={assetType} isVI={isVI}
              holdingsError={holdingsError} setHoldingsError={setHoldingsError} setHoldingsReload={setHoldingsReload}
              sellHoldings={sellHoldings} selectedHolding={selectedHolding} setHoldingKey={setHoldingKey}
              sellAmount={sellAmount} setSellAmount={setSellAmount}
              fundSellUnits={fundSellUnits} setFundSellUnits={setFundSellUnits}
              received={received} setReceived={setReceived}
              goldSellQty={goldSellQty} setGoldSellQty={setGoldSellQty}
              goldSellPrice={goldSellPrice} setGoldSellPrice={setGoldSellPrice}
              inputStyle={inputStyle} labelStyle={labelStyle}
            />
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
              disabled={saving || sellDisabled}
              style={{
                flex: 2, padding: '12px 16px', borderRadius: 10,
                background: dir === 'sell' ? 'var(--c-neg)' : 'var(--c-btn-primary)', border: 'none',
                color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: (saving || sellDisabled) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', opacity: (saving || sellDisabled) ? 0.7 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {saving && <CairnLoader size={14} variant="on-dark" />}
              {saving
                ? tc('saving')
                : dir === 'sell'
                ? (assetType === 'bank' ? t('confirmWithdrawal') : t('confirmSale'))
                : existing ? t('saveChanges') : tc('save')}
            </button>
          </div>
        </div>
  )

  if (desktop) {
    return (
      <DialogShell
        onClose={onClose}
        labelledBy={TITLE_ID}
        overlayStyle={{
          zIndex: 200, padding: 24,
          animation: 'fade-in 150ms ease', backdropFilter: 'blur(2px)',
        }}
        panelStyle={{
          width: '100%', maxWidth: 520, maxHeight: 'calc(100vh - 48px)',
          background: 'var(--c-card)', borderRadius: 16,
          boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
          display: 'flex', flexDirection: 'column',
          animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)', overflow: 'hidden',
        }}
      >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--c-line)', flexShrink: 0 }}>
            <h3 id={TITLE_ID} style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{existing ? t('editTitle') : t('title')}</h3>
            <button onClick={onClose} style={{ ...iconHit, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)' }} aria-label="Close"><X size={18} /></button>
          </div>
          <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }}>
            {formBody}
          </div>
      </DialogShell>
    )
  }

  return (
    <DialogShell
      onClose={onClose}
      labelledBy={TITLE_ID}
      overlayStyle={{
        background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 100,
        alignItems: 'flex-end',
        animation: open ? 'fade-in 180ms ease' : 'fade-out 180ms ease forwards',
        pointerEvents: open ? 'auto' : 'none',
      }}
      panelStyle={{
          width: '100%', maxWidth: 480, maxHeight: '90dvh',
          background: 'var(--c-card)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: open ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'slide-down 180ms ease forwards',
          boxShadow: '0 -8px 24px rgba(0,0,0,0.12)',
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px', flexShrink: 0 }} />

        {/* Header — pinned, sits outside the scrollable body so the title stays put */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 20px', flexShrink: 0 }}>
          <h3 id={TITLE_ID} style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--c-ink)' }}>
            {existing ? t('editTitle') : t('title')}
          </h3>
          <button
            onClick={onClose}
            style={{ ...iconHit, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable form body */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', touchAction: 'pan-y', padding: '0 16px 32px' }}>
          {formBody}
        </div>
    </DialogShell>
  )
}
