'use client'

import type { CSSProperties } from 'react'
import { fmtCompact } from '@/lib/formatters'
import type { GoalInflationOutlook, InflationLadder } from '@/lib/inflation'

// The purchasing-power view of a goal, shown on both goal-detail surfaces.
//
// Everything here is commentary on numbers rendered elsewhere: the progress bar
// beside it stays nominal money over the nominal target, because that ratio is
// checkable against the ledger and this one is not. So the card never restates
// progress, and it never appears without naming the rate it assumed.
//
// It speaks in one of two registers. With a DEADLINE it can be exact, and shows
// both directions of the same comparison: the target grows (how much more to put
// in) and idle savings shrink (what standing still costs). They are one division
// apart — see goalInflationOutlook — but they answer different questions, and
// users ask both. Without a deadline it drops to a LADDER of horizons rather
// than assuming a date, because assuming one would fabricate the single input
// the user declined to give.

// "2030-06" → "06/2030" (vi) or "Jun 2030" (en). Built from the parts at local
// midnight and read only as month+year, so no timezone can move it.
function formatYm(ym: string, isVi: boolean): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  if (isVi) return `${String(m).padStart(2, '0')}/${y}`
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

// 4 → "4%", 4.5 → "4.5%". Kept plain rather than locale-formatted: this reads as
// a rate label beside prose, not as an amount in a column of figures.
const fmtRate = (n: number) => `${n}%`

const MUTED: CSSProperties = { fontSize: 12, color: 'var(--c-muted)' }
const RULE: CSSProperties = { marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--c-line)' }

// ─── With a deadline: the exact answer ────────────────────────────────────────

function DeadlineBody({ outlook, targetAmount, currentValue, targetDate, isVi }: {
  outlook: GoalInflationOutlook
  targetAmount: number
  currentValue: number
  targetDate: string
  isVi: boolean
}) {
  const when = formatYm(targetDate, isVi)
  return (
    <>
      {/* Direction 1 — what the same basket costs at the deadline. */}
      <div data-testid="inflation-target-future" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--c-ink)', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
        {fmtCompact(outlook.targetInFutureMoney)}
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-muted)', marginLeft: 6, letterSpacing: 0 }}>
          {isVi ? `vào ${when}` : `by ${when}`}
        </span>
      </div>
      <div style={{ ...MUTED, marginTop: 4 }}>
        {isVi
          ? `để mua được thứ ${fmtCompact(targetAmount)} mua được hôm nay`
          : `to buy what ${fmtCompact(targetAmount)} buys today`}
      </div>

      {/* Direction 2 — what the balance already saved is worth against it. */}
      <div data-testid="inflation-savings-today" style={{ ...MUTED, ...RULE }}>
        {isVi
          ? `${fmtCompact(currentValue)} hôm nay, nếu để yên, khi đó chỉ còn tương đương ${fmtCompact(outlook.savingsInTodayMoney)}`
          : `${fmtCompact(currentValue)} today, left idle, is worth ${fmtCompact(outlook.savingsInTodayMoney)} against that horizon`}
      </div>

      {/* The shortfall, said in both currencies of the day. Absent once the goal
          is already ahead of its inflated target — there is no gap to name. */}
      {outlook.gapInFutureMoney > 0 && (
        <div data-testid="inflation-gap-future" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-warn)', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
          {isVi ? 'Thiếu ' : 'Shortfall '}
          {fmtCompact(outlook.gapInFutureMoney)}
          <span style={{ fontWeight: 500, color: 'var(--c-muted)' }}>
            {isVi
              ? ` theo giá ${when} · ${fmtCompact(outlook.gapInTodayMoney)} theo giá hôm nay`
              : ` in ${when} money · ${fmtCompact(outlook.gapInTodayMoney)} in today's`}
          </span>
        </div>
      )}

      {/* The band. A single rate would present a guess as the answer; three cost
          nothing more and show how much the guess is actually worth. */}
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {outlook.scenarios.map(s => (
          <div
            key={s.ratePct}
            data-testid={`inflation-scenario-${s.ratePct}`}
            data-current={s.isCurrent ? 'true' : 'false'}
            style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 11,
              background: s.isCurrent ? 'var(--c-navy-tint)' : 'var(--c-card)',
              color: s.isCurrent ? 'var(--c-navy)' : 'var(--c-muted)',
              border: '1px solid var(--c-line)',
              fontWeight: s.isCurrent ? 600 : 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtRate(s.ratePct)} · {fmtCompact(s.targetInFutureMoney)}
          </div>
        ))}
      </div>
    </>
  )
}

// ─── Without a deadline: the shape, not a guessed date ────────────────────────

function LadderBody({ ladder, targetAmount, isVi }: {
  ladder: InflationLadder
  targetAmount: number
  isVi: boolean
}) {
  return (
    <>
      <div style={MUTED}>
        {isVi
          ? `${fmtCompact(targetAmount)} hôm nay sẽ tốn`
          : `${fmtCompact(targetAmount)} today will cost`}
      </div>

      <div style={{ display: 'grid', gap: 1, marginTop: 8, background: 'var(--c-line)', borderRadius: 10, overflow: 'hidden' }}>
        {ladder.steps.map(s => (
          <div
            key={s.years}
            data-testid={`inflation-ladder-${s.years}`}
            style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 10px', background: 'var(--c-card)' }}
          >
            <span style={{ fontSize: 11, color: 'var(--c-muted)', flex: 1 }}>
              {isVi ? `sau ${s.years} năm` : `in ${s.years} ${s.years === 1 ? 'year' : 'years'}`}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtCompact(s.targetInFutureMoney)}
            </span>
          </div>
        ))}
      </div>

      {/* The one line here that is about the user's own money rather than the
          target, and the one that needs no horizon at all. */}
      {ladder.yearOneLoss > 0 && (
        <div data-testid="inflation-year-loss" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-warn)', marginTop: 10, fontVariantNumeric: 'tabular-nums' }}>
          {isVi ? 'Mỗi năm đứng yên mất ' : 'Standing still costs '}
          {fmtCompact(ladder.yearOneLoss)}
          <span style={{ fontWeight: 500, color: 'var(--c-muted)' }}>
            {isVi ? ' sức mua' : ' of purchasing power a year'}
          </span>
        </div>
      )}

      <div data-testid="inflation-set-deadline" style={{ ...MUTED, ...RULE, fontSize: 11 }}>
        {isVi
          ? 'Đặt hạn cho mục tiêu để thấy con số chính xác thay vì các mốc ước lượng.'
          : 'Give the goal a deadline to get the exact figure instead of these horizons.'}
      </div>
    </>
  )
}

export default function InflationOutlookCard({
  outlook, ladder, targetAmount, currentValue, targetDate, isVi, style,
}: {
  outlook: GoalInflationOutlook | null
  // Used only when there is no deadline. A month the user named beats a ladder
  // of horizons nobody chose, so `outlook` wins whenever both are present.
  ladder: InflationLadder | null
  targetAmount: number
  currentValue: number
  targetDate: string | null
  isVi: boolean
  // Spacing is the caller's business: desktop stacks this in a gapped column,
  // the mobile sheet in a padded block that needs its own bottom margin.
  style?: CSSProperties
}) {
  // With neither shape there is genuinely nothing to say — no target amount at
  // all, or a deadline already reached. Silence, not an empty card.
  if (!outlook && !ladder) return null
  const rate = fmtRate((outlook ?? ladder!).ratePct)

  return (
    <div
      data-testid="inflation-outlook"
      style={{
        padding: 16, borderRadius: 14,
        background: 'var(--c-card-2)',
        border: '1px solid var(--c-line)',
        ...style,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', marginBottom: 10 }}>
        {isVi ? 'Sức mua' : 'Purchasing power'}
      </div>

      {outlook
        ? <DeadlineBody outlook={outlook} targetAmount={targetAmount} currentValue={currentValue} targetDate={targetDate ?? ''} isVi={isVi} />
        : <LadderBody ladder={ladder!} targetAmount={targetAmount} isVi={isVi} />}

      <div data-testid="inflation-assumption-note" style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 10, lineHeight: 1.45 }}>
        {isVi
          ? `Giả định lạm phát ${rate}/năm — con số để dự phóng, không phải CPI công bố. Tiến độ phía trên vẫn tính theo tiền thật.`
          : `Assumes ${rate}/yr inflation — a planning assumption, not published CPI. The progress above stays in nominal money.`}
      </div>
    </div>
  )
}
