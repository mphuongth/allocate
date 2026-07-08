'use client'

import { useState, useEffect } from 'react'
import { X, TrendingUp, Building2, Coins, ArrowUpRight, ArrowDownRight, ArrowDownToLine, Wallet, Shield } from 'lucide-react'
import { iconHit } from './iconHit'
import { useLocale, useTranslations } from 'next-intl'
import { CairnLoader } from '@/app/components/ui/CairnLoader'
import { todayIso } from '@/lib/dates'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import LoadError from './LoadError'

interface Fund { id: string; name: string; nav: number; code: string | null; fund_type?: string }
interface Goal { goal_id: string; goal_name: string }
interface Bank { code: string; name: string; logo_url?: string | null }

// A sellable position, collected from the dashboard overview. Funds live in
// goals or unallocated; bank/gold live in unallocated.
interface Holding {
  key: string
  name: string
  source: string
  type: AssetType
  currentValue: number
  units: number | null
  navPerUnit: number | null
  gainPct: number | null
  interestRate: number | null
  fundId?: string
  transactionId?: string
  purchasePrice?: number
}

function collectHoldings(d: {
  goals?: { goalName: string; funds?: FundLike[]; nonFunds?: NonFundLike[] }[]
  unallocated?: { funds?: FundLike[]; nonFunds?: NonFundLike[] }
}): Holding[] {
  const out: Holding[] = []
  // Funds: allocated to goals or unallocated.
  const fundSources: { f: FundLike; source: string }[] = [
    ...(d.goals ?? []).flatMap((g) => (g.funds ?? []).map((f) => ({ f, source: g.goalName }))),
    ...((d.unallocated?.funds) ?? []).map((f) => ({ f, source: 'Unallocated' })),
  ]
  fundSources.forEach(({ f, source }, i) => {
    out.push({
      key: `fund-${f.fundId}-${i}`, name: f.fundName, source, type: 'fund',
      currentValue: f.currentValue, units: f.quantity, navPerUnit: f.currentNAV,
      gainPct: f.profitLossPercentage, interestRate: null,
      fundId: f.fundId, purchasePrice: f.purchasePrice,
    })
  })
  // Bank / gold: also allocated to goals or unallocated.
  const nonFundSources: { it: NonFundLike; source: string }[] = [
    ...(d.goals ?? []).flatMap((g) => (g.nonFunds ?? []).map((it) => ({ it, source: g.goalName }))),
    ...((d.unallocated?.nonFunds) ?? []).map((it) => ({ it, source: 'Unallocated' })),
  ]
  nonFundSources.forEach(({ it, source }, i) => {
    if (it.type !== 'bank' && it.type !== 'gold') return
    out.push({
      key: `nf-${it.transactionId}-${i}`, name: it.notes || it.type, source,
      type: it.type as AssetType,
      currentValue: it.currentValue, units: it.units,
      navPerUnit: it.units && it.units > 0 ? it.currentValue / it.units : null,
      gainPct: null, interestRate: it.interestRate,
      transactionId: it.transactionId, purchasePrice: it.amount,
    })
  })
  return out
}

interface FundLike { fundId: string; fundName: string; quantity: number; currentNAV: number; currentValue: number; purchasePrice: number; profitLossPercentage: number }
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

const GOLD_PROVIDERS = ['PNJ', 'DOJI', 'SJC', 'Bảo Tín']

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
        fetch('/api/v1/funds').then(r => r.json()),
        fetch('/api/v1/savings-goals').then(r => r.json()),
        fetch('/api/v1/banks').then(r => r.json()).catch(() => []),
      ]).then(([fundsData, goalsData, banksData]) => {
        const fundList: Fund[] = Array.isArray(fundsData) ? fundsData : []
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
      setDepositType(existing.interest_rate != null ? 'term' : 'flex')
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

  // Fund pricing: NAV is editable (the actual purchase price). It falls back to
  // the fund's current NAV, and units derive from amount ÷ NAV (two-way linked).
  const selectedFund = funds.find(f => f.id === fundId)
  const navNum = Number(nav) || selectedFund?.nav || 0
  const displayNav = nav !== '' ? nav : (selectedFund ? String(selectedFund.nav) : '')
  const navIsCurrent = !!selectedFund && (nav === '' || Number(nav) === selectedFund.nav)
  const autoUnits = navNum > 0 && amount && !units
    ? (Number(amount.replace(/\./g, '')) / navNum).toFixed(2)
    : units

  // ── Sell derived state ──────────────────────────────────────────────────
  const sellHoldings = holdings.filter(h => h.type === assetType)
  const selectedHolding = sellHoldings.find(h => h.key === holdingKey) ?? sellHoldings[0] ?? null
  const sellMax = selectedHolding?.currentValue ?? 0
  const numSell = Number(sellAmount) || 0
  const sellOverMax = numSell > sellMax && sellMax > 0
  const sellRemaining = Math.max(0, sellMax - numSell)
  const sellNav = selectedHolding?.navPerUnit ?? null
  const sellGainLoss = (numSell && assetType === 'fund' && selectedHolding?.gainPct != null)
    ? numSell * selectedHolding.gainPct / (100 + selectedHolding.gainPct) : null
  const sellTax = assetType === 'fund' && numSell > 0 ? Math.round(numSell * 0.001) : null

  // Bank withdrawal: the cash received is editable (early withdrawal can cut interest).
  // We split the principal out of the withdrawn amount so the summary can show gain/loss.
  const numReceived = Number(received) || 0
  const bankPrincipal = selectedHolding?.purchasePrice ?? sellMax
  const bankFraction = sellMax > 0 ? Math.min(1, numSell / sellMax) : 0
  const bankPrincipalPortion = Math.round(bankPrincipal * bankFraction)
  const bankGain = assetType === 'bank' && numReceived > 0 && numSell > 0 ? numReceived - bankPrincipalPortion : null

  // Gold sells are quantity-based: enter chỉ to sell + the sale price per chỉ.
  const goldMaxUnits = selectedHolding?.units ?? 0
  const numGoldSellQty = Number(goldSellQty) || 0
  const numGoldSellPrice = Number(goldSellPrice) || 0
  const goldBuyUnit = selectedHolding?.units && selectedHolding.units > 0 && selectedHolding.purchasePrice != null
    ? Math.round(selectedHolding.purchasePrice / selectedHolding.units) : null
  const goldProceeds = Math.round(numGoldSellQty * numGoldSellPrice)
  const goldCost = goldBuyUnit != null ? Math.round(numGoldSellQty * goldBuyUnit) : null
  const goldProfit = goldProceeds > 0 && goldCost != null ? goldProceeds - goldCost : null
  const goldRemUnits = selectedHolding?.units != null ? selectedHolding.units - numGoldSellQty : null
  const isOverUnits = numGoldSellQty > goldMaxUnits && goldMaxUnits > 0

  const sellDisabled = dir === 'sell' && (
    !selectedHolding ||
    (assetType === 'gold'
      ? (numGoldSellQty <= 0 || isOverUnits)
      : assetType === 'bank'
        ? (numSell <= 0 || sellOverMax || numReceived <= 0)
        : (numSell <= 0 || sellOverMax))
  )

  // Prefill the gold sale price with the holding's current price per chỉ.
  useEffect(() => {
    if (dir === 'sell' && assetType === 'gold' && sellNav) {
      setGoldSellPrice(String(Math.round(sellNav)))
    }
  }, [dir, assetType, holdingKey, sellNav])

  async function handleSave() {
    setError('')

    // ── Edit an existing investment (PUT) ──────────────────────────────────
    if (existing) {
      let payload: Record<string, unknown>
      if (assetType === 'fund') {
        const amt = Number(amount.replace(/\./g, ''))
        if (!fundId) { setError(t('fundRequired')); return }
        if (!amt) { setError(t('amountRequired')); return }
        const navV = Number(nav) || selectedFund?.nav || null
        const u = units ? Number(units) : (navV ? amt / navV : null)
        payload = {
          asset_type: 'fund', fund_id: fundId, investment_date: date,
          amount_vnd: amt, units: u,
          unit_price: navV,
          goal_id: goalId || null, notes: note || null,
        }
      } else if (assetType === 'bank') {
        const amt = Number(bankAmount.replace(/\./g, ''))
        if (!amt) { setError(t('amountRequired')); return }
        payload = {
          asset_type: 'bank', fund_id: null, investment_date: date, amount_vnd: amt,
          interest_rate: rate ? Number(rate) : null, expiry_date: maturity || null,
          goal_id: goalId || null, notes: selectedBankName || note || null,
          bank_code: bankCode || null,
        }
      } else {
        const qty = Number(goldQty)
        const price = Number(goldPrice.replace(/\./g, ''))
        if (!qty || !price) { setError(t('amountRequired')); return }
        const unitsInChi = goldUnit === 'luong' ? qty * 10 : qty
        const pricePerChi = goldUnit === 'luong' ? Math.round(price / 10) : price
        payload = {
          asset_type: 'gold', fund_id: null, investment_date: date,
          amount_vnd: Math.round(qty * price), units: unitsInChi, unit_price: pricePerChi,
          goal_id: goalId || null, notes: goldProvider || null,
        }
      }
      setSaving(true)
      try {
        const res = await fetch(`/api/v1/investment-transactions/${existing.transaction_id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const d = await res.json()
          setError(d.error ?? tc('error'))
        } else {
          onClose()
          onSaved?.()
        }
      } catch {
        setError(tc('error'))
      } finally {
        setSaving(false)
      }
      return
    }

    // ── Sell / withdraw: pull from the chosen holding ──────────────────────
    if (dir === 'sell') {
      if (!selectedHolding) { setError(t('holdingRequired')); return }

      let sellBody: Record<string, unknown>
      if (selectedHolding.type === 'gold' && selectedHolding.transactionId) {
        // Gold: quantity (chỉ) × sale price. amount = proceeds, units = chỉ sold,
        // principal = cost basis of the sold quantity.
        if (numGoldSellQty <= 0) { setError(t('amountRequired')); return }
        if (isOverUnits) { setError(t('exceedsBalance')); return }
        sellBody = {
          transaction_type: 'withdrawal', asset_type: 'gold',
          parent_transaction_id: selectedHolding.transactionId,
          investment_date: date, amount_vnd: goldProceeds,
          units_withdrawn: parseFloat(numGoldSellQty.toFixed(4)),
          principal_withdrawn: goldCost ?? goldProceeds, goal_id: null, notes: note || null,
        }
      } else if (selectedHolding.type === 'fund' && selectedHolding.fundId) {
        if (!numSell) { setError(t('amountRequired')); return }
        if (sellOverMax) { setError(t('exceedsBalance')); return }
        const principalWithdrawn = selectedHolding.purchasePrice
          ? Math.round((numSell / selectedHolding.currentValue) * (selectedHolding.purchasePrice * (selectedHolding.units ?? 0)))
          : Math.round(numSell)
        const unitsWithdrawn = sellNav ? numSell / sellNav : (selectedHolding.units ?? 0)
        sellBody = {
          transaction_type: 'withdrawal', asset_type: 'fund', fund_id: selectedHolding.fundId,
          investment_date: date, amount_vnd: Math.round(numSell),
          units_withdrawn: parseFloat(unitsWithdrawn.toFixed(4)),
          principal_withdrawn: principalWithdrawn, goal_id: null, notes: note || null,
        }
      } else if (selectedHolding.transactionId) {
        if (!numSell) { setError(t('amountRequired')); return }
        if (sellOverMax) { setError(t('exceedsBalance')); return }
        // Bank: cash received is what the user gets; principal portion is what leaves
        // the deposit's principal, so the gain/loss is recorded accurately.
        const isBankSell = selectedHolding.type === 'bank'
        if (isBankSell && numReceived <= 0) { setError(t('amountRequired')); return }
        sellBody = {
          transaction_type: 'withdrawal', asset_type: selectedHolding.type,
          parent_transaction_id: selectedHolding.transactionId,
          investment_date: date,
          amount_vnd: isBankSell ? Math.round(numReceived) : Math.round(numSell),
          principal_withdrawn: isBankSell ? bankPrincipalPortion : Math.round(numSell),
          goal_id: null, notes: note || null,
        }
      } else {
        setError(t('holdingRequired')); return
      }

      setSaving(true)
      try {
        const res = await fetch('/api/v1/investment-transactions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sellBody),
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
      return
    }

    let body: Record<string, unknown> = {
      asset_type: assetType,
      transaction_type: 'investment',
      investment_date: date,
      notes: note || null,
      goal_id: goalId || null,
      // Logging from the Plan page ties the transaction to the month's plan so
      // the By-goal view counts it as contributed.
      plan_id: prefill?.plan_id ?? null,
    }

    if (assetType === 'fund') {
      const amt = Number(amount.replace(/\./g, ''))
      if (!fundId) { setError(t('fundRequired')); return }
      if (!amt) { setError(t('amountRequired')); return }
      const navV = Number(nav) || selectedFund?.nav || null
      body = {
        ...body,
        fund_id: fundId,
        amount_vnd: amt,
        units: units ? Number(units) : (navV ? amt / navV : null),
        unit_price: navV,
      }
    } else if (assetType === 'bank') {
      const amt = Number(bankAmount.replace(/\./g, ''))
      if (!amt) { setError(t('amountRequired')); return }
      body = {
        ...body,
        amount_vnd: amt,
        notes: selectedBankName || note || null,
        bank_code: bankCode || null,
        interest_rate: rate ? Number(rate) : null,
        expiry_date: maturity || null,
        // An accumulating book: the route self-groups this anchor row so it can
        // be topped up later. Term/flex stay ungrouped (one-off holdings).
        ...(depositType === 'accumulating' ? { accumulating: true } : {}),
      }
    } else {
      // gold — qty/price are in the selected unit; normalize to chỉ for storage
      // since gold is valued per chỉ.
      const qty = Number(goldQty)
      const price = Number(goldPrice.replace(/\./g, ''))
      if (!qty || !price) { setError(t('amountRequired')); return }
      const unitsInChi = goldUnit === 'luong' ? qty * 10 : qty
      const pricePerChi = goldUnit === 'luong' ? Math.round(price / 10) : price
      body = {
        ...body,
        amount_vnd: Math.round(qty * price),
        units: unitsInChi,
        unit_price: pricePerChi,
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
                {goals.map(g => (
                  <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--c-line)', margin: '0 -2px' }} />

          {/* Fund-specific */}
          {dir === 'buy' && assetType === 'fund' && (
            <>
              <div>
                <label style={labelStyle}>{t('fund')}</label>
                <select
                  value={fundId}
                  onChange={(e) => { setFundId(e.target.value); setUnits(''); setNav('') }}
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
                  <div style={{ display: 'flex', gap: 12, margin: '5px 0 0', fontSize: 11, color: 'var(--c-muted)' }}>
                    <span>NAV <strong style={{ color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{selectedFund.nav.toLocaleString('vi-VN')} ₫</strong></span>
                    {selectedFund.fund_type && <span style={{ textTransform: 'capitalize', color: 'var(--c-muted-2, var(--c-muted))' }}>{selectedFund.fund_type}</span>}
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>{t('amount')}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatIntVN(amount)}
                    onChange={(e) => { setAmount(parseIntVN(e.target.value)); setUnits('') }}
                    placeholder="5.000.000"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t('nav')}</label>
                  <input
                    data-testid="buy-fund-nav-input"
                    type="text"
                    inputMode="decimal"
                    value={formatDecimalVN(displayNav)}
                    onChange={(e) => { setNav(parseDecimalVN(e.target.value)); setUnits('') }}
                    placeholder={selectedFund ? formatDecimalVN(String(selectedFund.nav)) : '0'}
                    style={inputStyle}
                  />
                  {navIsCurrent && <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{t('navCurrent')}</div>}
                </div>
                <div>
                  <label style={labelStyle}>{t('units')}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatDecimalVN(units || autoUnits || '')}
                    onChange={(e) => { const v = parseDecimalVN(e.target.value); setUnits(v); setAmount(navNum > 0 && v ? String(Math.round(Number(v) * navNum)) : amount) }}
                    placeholder={t('unitsAuto')}
                    style={inputStyle}
                  />
                </div>
              </div>
            </>
          )}

          {/* Bank-specific */}
          {dir === 'buy' && assetType === 'bank' && (
            <>
              {/* Structured bank (FK) — the deposit points at a real bank, and the
                  chosen bank's name is the deposit's name (no separate name field).
                  A general "note" further down covers any extra memo. */}
              <div>
                <label style={labelStyle}>{t('bank')}</label>
                <select
                  data-testid="bank-select"
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">{t('bankNone')}</option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('depositType')}</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {(['term', 'accumulating', 'flex'] as const).map(opt => {
                    const active = depositType === opt
                    return (
                      <button
                        key={opt}
                        type="button"
                        data-testid={`deposit-type-${opt}`}
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
                        {opt === 'term' ? t('termDeposit') : opt === 'accumulating' ? t('accumulatingDeposit') : t('flexDeposit')}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: depositType !== 'flex' ? '1.2fr 1fr' : '1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>{t('principal')}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatIntVN(bankAmount)}
                    onChange={(e) => setBankAmount(parseIntVN(e.target.value))}
                    placeholder="10.000.000"
                    style={inputStyle}
                  />
                </div>
                {depositType !== 'flex' && (
                  <div>
                    <label style={labelStyle}>{t('rate')}</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatDecimalVN(rate)}
                      onChange={(e) => setRate(parseDecimalVN(e.target.value))}
                      placeholder="5,5"
                      style={inputStyle}
                    />
                  </div>
                )}
              </div>
              {depositType !== 'flex' && (
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
              {depositType !== 'flex' && Number(bankAmount) > 0 && Number(rate) > 0 && maturity && (() => {
                // Interest the user actually receives by maturity, prorated over
                // the term (deposit date → maturity) — not the full-year figure.
                const termDays = (Date.parse(maturity) - Date.parse(date)) / 86_400_000
                if (!(termDays > 0)) return null
                const interest = Math.round((Number(bankAmount) * Number(rate) / 100) * termDays / 365)
                return (
                  <div style={{
                    background: 'var(--c-pos-tint)', borderRadius: 10, padding: '9px 14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--c-pos)', fontWeight: 500 }}>{t('estInterestReceivable')}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-pos)', fontVariantNumeric: 'tabular-nums' }}>
                      +{interest.toLocaleString('vi-VN')} ₫
                    </span>
                  </div>
                )
              })()}
            </>
          )}

          {/* Gold-specific */}
          {dir === 'buy' && assetType === 'gold' && (
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
                  <label style={labelStyle}>{t('unit')}</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {(['chi', 'luong'] as const).map((u) => {
                      const active = goldUnit === u
                      return (
                        <button
                          key={u}
                          type="button"
                          onClick={() => {
                            // Keep the per-unit price consistent when switching:
                            // 1 lượng = 10 chỉ.
                            if (goldUnit !== u && goldPrice) {
                              const p = Number(goldPrice.replace(/[^0-9]/g, ''))
                              setGoldPrice(String(Math.round(p * (u === 'luong' ? 10 : 0.1))))
                            }
                            setGoldUnit(u)
                          }}
                          style={{
                            padding: '9px 4px', borderRadius: 8,
                            background: active ? 'rgba(180,83,9,0.10)' : 'var(--c-card-2)',
                            color: active ? '#b45309' : 'var(--c-muted)',
                            border: `1px solid ${active ? '#b45309' : 'var(--c-line)'}`,
                            cursor: 'pointer', fontFamily: 'inherit',
                            fontSize: 13, fontWeight: 600, transition: 'all 120ms',
                          }}
                        >
                          {u === 'chi' ? t('unitChi') : t('unitLuong')}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>{t('qty')}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatDecimalVN(goldQty)}
                    onChange={(e) => setGoldQty(parseDecimalVN(e.target.value))}
                    placeholder="1"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div>
                <label style={labelStyle}>{goldUnit === 'chi' ? t('pricePerChi') : t('pricePerLuong')}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatIntVN(goldPrice)}
                  onChange={(e) => setGoldPrice(parseIntVN(e.target.value))}
                  placeholder="9.200.000"
                  style={inputStyle}
                />
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

          {/* Sell / withdraw — pick a holding, then confirm the amount */}
          {dir === 'sell' && (
            holdingsError ? (
              <div style={{ padding: '8px 16px', background: 'var(--c-card-2)', borderRadius: 12, border: '1px dashed var(--c-line)' }}>
                <LoadError isVI={isVI} onRetry={() => { setHoldingsError(false); setHoldingsReload((n) => n + 1) }} compact />
              </div>
            ) : sellHoldings.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', background: 'var(--c-card-2)', borderRadius: 12, border: '1px dashed var(--c-line)' }}>
                <div style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--c-card)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-muted)', marginBottom: 10 }}>
                  <Wallet size={18} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t('noHoldings')}</div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{t('switchToBuy')}</div>
              </div>
            ) : (
              <>
                <div>
                  <label style={labelStyle}>{t('pickHolding')}</label>
                  <select
                    value={selectedHolding?.key ?? ''}
                    onChange={(e) => { setHoldingKey(e.target.value); setSellAmount(''); setFundSellUnits(''); setReceived('') }}
                    style={inputStyle}
                  >
                    {sellHoldings.map(h => (
                      <option key={h.key} value={h.key}>
                        {h.name} · {h.currentValue.toLocaleString('vi-VN')} ₫ · {h.source}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedHolding && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--c-card-2)', borderRadius: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--c-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: assetType === 'fund' ? '#2563eb' : assetType === 'bank' ? '#047857' : '#b45309', border: '1px solid var(--c-line)', flexShrink: 0 }}>
                      {assetType === 'fund' ? <TrendingUp size={18} /> : assetType === 'bank' ? <Building2 size={18} /> : <Coins size={18} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedHolding.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span>{t('available')}: <span style={{ fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{selectedHolding.currentValue.toLocaleString('vi-VN')} ₫</span></span>
                        {selectedHolding.units != null && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{selectedHolding.units.toLocaleString('vi-VN')} {t('unitsShort')}</span>}
                        {assetType === 'bank' && selectedHolding.interestRate != null && <span>{selectedHolding.interestRate}%/yr</span>}
                      </div>
                    </div>
                  </div>
                )}

                {assetType !== 'gold' ? (
                  <>
                    <div>
                      <label style={labelStyle}>{assetType === 'bank' ? t('amountToWithdraw') : t('amountToSell')}</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: `1.5px solid ${sellOverMax ? 'var(--c-neg)' : 'var(--c-navy)'}`, borderRadius: 10 }}>
                          <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={formatIntVN(sellAmount)}
                            onChange={(e) => {
                              const v = parseIntVN(e.target.value)
                              setSellAmount(v)
                              const n = Number(v) || 0
                              if (assetType === 'fund') setFundSellUnits(sellNav && n ? (n / sellNav).toFixed(2) : '')
                              if (assetType === 'bank') setReceived(n ? String(Math.round(n)) : '')
                            }}
                            placeholder="0"
                            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: sellOverMax ? 'var(--c-neg)' : 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                          />
                        </div>
                        <button type="button" onClick={() => {
                          setSellAmount(String(Math.round(sellMax)))
                          if (assetType === 'fund') setFundSellUnits(selectedHolding?.units != null ? selectedHolding.units.toFixed(2) : '')
                          if (assetType === 'bank') setReceived(String(Math.round(sellMax)))
                        }} style={{ padding: '8px 12px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>{t('all')}</button>
                      </div>
                      {sellOverMax && (
                        <div style={{ fontSize: 11, color: 'var(--c-neg)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <X size={12} strokeWidth={2.5} /> {t('exceedsBalance')} · {t('max')} {Math.round(sellMax).toLocaleString('vi-VN')} ₫
                        </div>
                      )}
                    </div>

                    {/* Fund: units to sell, two-way linked with the amount above */}
                    {assetType === 'fund' && (
                      <div>
                        <label style={labelStyle}>{t('unitsToSell')}</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1.5px solid var(--c-navy)', borderRadius: 10 }}>
                          <input
                            data-testid="sell-fund-units-input"
                            type="text"
                            inputMode="decimal"
                            value={formatDecimalVN(fundSellUnits)}
                            onChange={(e) => {
                              const v = parseDecimalVN(e.target.value)
                              setFundSellUnits(v)
                              const u = Number(v) || 0
                              setSellAmount(sellNav && u ? String(Math.round(u * sellNav)) : '')
                            }}
                            placeholder="0,00"
                            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                          />
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('unitsShort')}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{t('navLinkHint')}</div>
                      </div>
                    )}

                    {/* Bank: editable cash received (early withdrawal can cut interest) */}
                    {assetType === 'bank' && (
                      <div>
                        <label style={labelStyle}>{t('amountReceived')}</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1.5px solid var(--c-navy)', borderRadius: 10 }}>
                          <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                          <input
                            data-testid="sell-bank-received-input"
                            type="text"
                            inputMode="numeric"
                            value={formatIntVN(received)}
                            onChange={(e) => setReceived(parseIntVN(e.target.value))}
                            placeholder="0"
                            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                          />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{t('receivedHint')}</div>
                      </div>
                    )}

                    {/* Fund summary: remaining / gain-loss / tax */}
                    {assetType === 'fund' && numSell > 0 && !sellOverMax && (
                      <div style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('remainingAfter')}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{sellRemaining.toLocaleString('vi-VN')} ₫</span>
                        </div>
                        {sellGainLoss != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: sellTax ? '1px solid var(--c-line)' : 'none' }}>
                            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('estGainLoss')}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: sellGainLoss >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', fontVariantNumeric: 'tabular-nums' }}>{sellGainLoss >= 0 ? '+' : ''}{Math.round(sellGainLoss).toLocaleString('vi-VN')} ₫</span>
                          </div>
                        )}
                        {sellTax != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('incomeTax')}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>−{sellTax.toLocaleString('vi-VN')} ₫</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bank summary: principal portion / received / gain-loss / remaining */}
                    {assetType === 'bank' && numSell > 0 && !sellOverMax && numReceived > 0 && (
                      <div style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('principalPortion')}{bankFraction < 0.999 && <span style={{ opacity: 0.7 }}> · {Math.round(bankFraction * 100)}%</span>}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{bankPrincipalPortion.toLocaleString('vi-VN')} ₫</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('amountReceived')}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{numReceived.toLocaleString('vi-VN')} ₫</span>
                        </div>
                        {bankGain != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--c-line)' }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('gainLoss')}</span>
                            <span style={{ fontSize: 15, fontWeight: 700, color: bankGain >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', fontVariantNumeric: 'tabular-nums' }}>{bankGain >= 0 ? '+' : '−'}{Math.abs(bankGain).toLocaleString('vi-VN')} ₫</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('remainingAfter')}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{sellRemaining.toLocaleString('vi-VN')} ₫</span>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Gold: quantity (chỉ) to sell */}
                    <div>
                      <label style={labelStyle}>{t('quantityToSell')}</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: `1.5px solid ${isOverUnits ? 'var(--c-neg)' : 'var(--c-navy)'}`, borderRadius: 10 }}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={formatDecimalVN(goldSellQty)}
                            onChange={(e) => setGoldSellQty(parseDecimalVN(e.target.value))}
                            placeholder="0,00"
                            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: isOverUnits ? 'var(--c-neg)' : 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                          />
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('chiShort')}</span>
                        </div>
                        <button type="button" onClick={() => setGoldSellQty(String(goldMaxUnits))} style={{ padding: '8px 12px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>{t('all')}</button>
                      </div>
                      {isOverUnits && (
                        <div style={{ fontSize: 11, color: 'var(--c-neg)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <X size={12} strokeWidth={2.5} /> {t('exceedsQty')} · {t('max')} {goldMaxUnits} {t('chiShort')}
                        </div>
                      )}
                    </div>

                    {/* Gold: sale price per chỉ (prefilled with current price) */}
                    <div>
                      <label style={labelStyle}>{t('salePricePerChi')}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10 }}>
                        <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatIntVN(goldSellPrice)}
                          onChange={(e) => setGoldSellPrice(parseIntVN(e.target.value))}
                          placeholder="0"
                          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>/{t('chiShort')}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{t('salePriceHint')}</div>
                    </div>

                    {/* Gold summary: proceeds / cost / P&L / remaining */}
                    {numGoldSellQty > 0 && !isOverUnits && numGoldSellPrice > 0 && (
                      <div style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('totalReceived')}<span style={{ opacity: 0.7 }}> · {numGoldSellQty.toLocaleString('vi-VN')} {t('chiShort')} × {numGoldSellPrice.toLocaleString('vi-VN')}</span></span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{goldProceeds.toLocaleString('vi-VN')} ₫</span>
                        </div>
                        {goldCost != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('yourCost')}{goldBuyUnit != null && <span style={{ opacity: 0.7 }}> · {numGoldSellQty.toLocaleString('vi-VN')} {t('chiShort')} × {goldBuyUnit.toLocaleString('vi-VN')}</span>}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{goldCost.toLocaleString('vi-VN')} ₫</span>
                          </div>
                        )}
                        {goldProfit != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--c-line)' }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('profitLoss')}</span>
                            <span style={{ fontSize: 15, fontWeight: 700, color: goldProfit >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', fontVariantNumeric: 'tabular-nums' }}>{goldProfit >= 0 ? '+' : '−'}{Math.abs(goldProfit).toLocaleString('vi-VN')} ₫</span>
                          </div>
                        )}
                        {goldRemUnits != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('remainingAfter')}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{Math.max(0, goldRemUnits).toLocaleString('vi-VN')} {t('chiShort')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {assetType === 'bank' && (
                  <div style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--c-warn-tint)', borderRadius: 10, border: '1px solid rgba(180,83,9,0.15)' }}>
                    <Shield size={16} color="var(--c-warn)" style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--c-warn)', lineHeight: 1.5 }}>{t('earlyWithdrawWarn')}</p>
                  </div>
                )}

                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', background: 'var(--c-card-2)', borderRadius: 8 }}>
                    <Wallet size={14} color="var(--c-muted)" style={{ marginTop: 1, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{t('proceedsUnallocated')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', background: 'var(--c-card-2)', borderRadius: 8 }}>
                    <ArrowDownToLine size={14} color="var(--c-muted)" style={{ marginTop: 1, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{assetType === 'fund' ? t('settlementFund') : assetType === 'bank' ? t('settlementBank') : t('settlementGold')}</span>
                  </div>
                </div>
              </>
            )
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
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          animation: 'fade-in 150ms ease', backdropFilter: 'blur(2px)',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 520, maxHeight: 'calc(100vh - 48px)',
            background: 'var(--c-card)', borderRadius: 16,
            boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
            display: 'flex', flexDirection: 'column',
            animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)', overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--c-line)', flexShrink: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{existing ? t('editTitle') : t('title')}</h3>
            <button onClick={onClose} style={{ ...iconHit, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)' }} aria-label="Close"><X size={18} /></button>
          </div>
          <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }}>
            {formBody}
          </div>
        </div>
      </div>
    )
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
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: open ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'slide-down 180ms ease forwards',
          boxShadow: '0 -8px 24px rgba(0,0,0,0.12)',
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px', flexShrink: 0 }} />

        {/* Header — pinned, sits outside the scrollable body so the title stays put */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 20px', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--c-ink)' }}>
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
      </div>
    </div>
  )
}
