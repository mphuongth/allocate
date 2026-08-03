import { useTranslations } from 'next-intl'
import { fmt, fmtCompact } from '@/lib/formatters'

// Scaled-down still of the real Monthly plan screen for the landing spotlight. Same rule as
// LandingAppMockup: copy comes from the screen's own i18n keys (planning.*) and money from
// the app's own formatter, so it follows the page locale and stays honest as the app moves.

const NAVY = '#0F2A4A'
const LINE = '#e9e5dc'
const CANVAS = '#faf8f4'
const NAVY_TINT = '#eef2f8'
const MUTED = '#78716c'
const INK = '#18181b'

const SALARY = 45_000_000
const ALLOCATED = 22_800_000
const REMAINING = 12_200_000
const ROWS = [
  { key: 'mockGoalRetirement', sub: 'VFMVF1 + DCDS', amount: 8_000_000 },
  { key: 'mockGoalHouse', sub: 'VESAF + VCB Save', amount: 7_500_000 },
  { key: 'mockGoalEmergency', sub: 'VCB Flex Save + MB 6M', amount: 4_000_000 },
  { key: 'mockGoalLaptop', sub: 'MB Term 3M', amount: 3_300_000 },
] as const

export function LandingPlanMockup() {
  const t = useTranslations('landing')
  const tPlan = useTranslations('planning')

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: '0 8px 24px rgba(15,42,74,0.12)', overflow: 'hidden' }}>
      {/* Header — screen name + the month it is planning */}
      <div style={{ background: CANVAS, borderBottom: `1px solid ${LINE}`, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK, letterSpacing: '-0.02em' }}>{tPlan('title')}</div>
        <div style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>{t('mockPlanMonth')}</div>
      </div>

      <div style={{ padding: '16px 18px' }}>
        {/* Summary — the two figures the real plan header leads with */}
        <div style={{ background: NAVY_TINT, borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: NAVY }}>{tPlan('rowTotal')}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(ALLOCATED)}</div>
            <div style={{ fontSize: 10, color: 'rgba(15,42,74,0.6)', marginTop: 2 }}>{tPlan('salaryRow', { amount: fmt(SALARY) })}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: NAVY }}>{tPlan('rowRemaining')}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(REMAINING)}</div>
          </div>
        </div>

        {/* Per-goal allocation — the real plan's "Mục tiêu" column */}
        <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: MUTED, marginBottom: 8 }}>{tPlan('colGoal')}</div>
        {ROWS.map((row, i, arr) => (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < arr.length - 1 ? `1px solid ${LINE}` : 'none' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>{t(row.key)}</div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{row.sub}</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{fmtCompact(row.amount)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
