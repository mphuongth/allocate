import { useTranslations } from 'next-intl'
import { Calendar, TrendingUp, Settings } from 'lucide-react'
import { fmtCompact } from '@/lib/formatters'

// A scaled-down still of the real Overview screen, drawn in CSS for the landing hero.
//
// It is deliberately built from the SAME i18n keys and the same formatter the real screens
// use (nav.*, dashboard.*, fmtCompact) rather than hardcoded English strings, so it follows
// the page locale and cannot quietly drift into advertising an app we don't ship. The shell
// mirrors app/components/navigation/Sidebar.tsx: a light 220px sidebar with a wordmark and
// *labelled* nav items — not an icon-only rail. Sizes are ~0.45× the real ones to fit the
// 540px hero frame; proportions and colours are otherwise the app's.

const NAVY = '#0F2A4A'
const LINE = '#e9e5dc'
const CANVAS = '#faf8f4'
const NAVY_TINT = '#eef2f8'
const POS = '#047857'
const POS_TINT = '#ecfdf5'
const MUTED = '#78716c'
const INK = '#18181b'

// The production host the mockup's browser chrome shows. Kept honest on purpose: the
// previous mockup advertised `cairn.app`, a domain we do not own.
const APP_HOST = 'cairn-money.vercel.app/dashboard'

/** Same stacked-rounded-rects mark the real Sidebar renders. */
function CairnMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.85)} viewBox="110 180 283 240" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <rect x="111.872" y="359.936" width="280.064" height="57.856" rx="24.3" fill="#3B5A82"/>
      <rect x="152.064" y="293.888" width="220.16" height="50.176" rx="21.07" fill="#163A61"/>
      <rect x="163.84" y="233.984" width="167.936" height="44.032" rx="18.49" fill="#10B981"/>
      <rect x="208.128" y="181.76" width="103.936" height="35.84" rx="15.05" fill={NAVY}/>
    </svg>
  )
}

/** The Overview nav icon, same shape as Sidebar's MountainsIcon. */
function MountainsIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M3 19h18l-6-9-3 4-2-3z" />
      <circle cx="8" cy="7" r="1.5" />
    </svg>
  )
}

// Sample figures. Written as raw numbers and run through the app's own fmtCompact so the
// mockup can never show a money format the app doesn't produce.
const NET_WORTH = 487_500_000
const KPI_VALUES = { invested: 446_200_000, current: 487_500_000, assets: 512_400_000, liabilities: 24_900_000 }
const GOALS = [
  { key: 'mockGoalRetirement', value: 215_400_000, target: 2_000_000_000, pct: 10.8 },
  { key: 'mockGoalHouse', value: 142_800_000, target: 500_000_000, pct: 28.6 },
  { key: 'mockGoalEmergency', value: 85_000_000, target: 100_000_000, pct: 85 },
] as const

export function LandingAppMockup() {
  const t = useTranslations('landing')
  const tNav = useTranslations('nav')
  const tDash = useTranslations('dashboard')

  const navItems = [
    { label: tNav('dashboard'), icon: <MountainsIcon />, active: true },
    { label: tNav('planning'), icon: <Calendar size={12} strokeWidth={1.8} />, active: false },
    { label: tNav('funds'), icon: <TrendingUp size={12} strokeWidth={1.8} />, active: false },
    { label: tNav('settings'), icon: <Settings size={12} strokeWidth={1.8} />, active: false },
  ]

  const kpis = [
    { l: tDash('invested'), v: KPI_VALUES.invested },
    { l: tDash('currentValue'), v: KPI_VALUES.current },
    { l: tDash('totalAssets'), v: KPI_VALUES.assets },
    { l: tDash('liabilities'), v: KPI_VALUES.liabilities },
  ]

  return (
    <div className="lp-mockup" style={{ width: 540, flexShrink: 0, background: '#fff', borderRadius: '12px 12px 0 0', boxShadow: '0 -8px 64px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)', overflow: 'hidden' }}>
      {/* Browser chrome */}
      <div className="lp-mockup-chrome" style={{ background: '#edeae2', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #e0dcd2' }}>
        <div style={{ display: 'flex', gap: 5 }}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', display: 'block' }}/>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', display: 'block' }}/>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', display: 'block' }}/>
        </div>
        <div className="lp-chrome-url" style={{ flex: 1, textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: MUTED, background: '#e0dcd2', borderRadius: 5, padding: '3px 10px' }}>
          {APP_HOST}
        </div>
      </div>

      {/* App shell */}
      <div className="lp-mockup-app" style={{ display: 'flex', height: 400, overflow: 'hidden' }}>
        {/* Sidebar — light, wordmark, labelled nav, user card (mirrors the real Sidebar) */}
        <div className="lp-m-sidebar" style={{ width: 112, background: '#fff', borderRight: `1px solid ${LINE}`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '11px 10px 10px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: `1px solid ${LINE}`, flexShrink: 0 }}>
            <CairnMark size={17} />
            <span className="lp-m-wordmark" style={{ fontSize: 12, fontWeight: 700, color: NAVY, letterSpacing: '-0.02em' }}>Cairn</span>
          </div>
          <div style={{ flex: 1, padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {navItems.map(item => (
              <div key={item.label} className="lp-m-nav-item" style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '6px 8px', borderRadius: 6,
                background: item.active ? NAVY_TINT : 'transparent',
                color: item.active ? NAVY : MUTED,
                fontSize: 10, fontWeight: item.active ? 600 : 400,
                whiteSpace: 'nowrap',
              }}>
                {item.icon}
                <span className="lp-m-nav-label">{item.label}</span>
              </div>
            ))}
          </div>
          {/* User card */}
          <div className="lp-m-user" style={{ padding: '8px 8px 10px', borderTop: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ width: 20, height: 20, borderRadius: '50%', background: NAVY, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>M</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('mockUserName')}</span>
          </div>
        </div>

        {/* Main content */}
        <div className="lp-m-content" style={{ flex: 1, background: CANVAS, padding: '13px 15px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Page header */}
          <div className="lp-m-page-header" style={{ marginBottom: 12, borderBottom: `1px solid ${LINE}`, paddingBottom: 10 }}>
            <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: MUTED, fontWeight: 600, marginBottom: 2 }}>{tDash('overview')}</div>
            <div className="lp-m-page-title" style={{ fontSize: 15, fontWeight: 700, color: INK, letterSpacing: '-0.025em' }}>{tDash('greeting', { name: t('mockUserFirstName') })}</div>
          </div>

          {/* Net-worth card — label, value, P&L chip, sparkline, range pills, 2×2 KPI grid */}
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 4 }}>{tDash('netWorth')}</div>
            <div className="lp-m-kpi-val" style={{ fontSize: 20, fontWeight: 700, color: INK, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(NET_WORTH)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6 }}>
              <span style={{ padding: '2px 6px', borderRadius: 999, fontSize: 9, fontWeight: 600, background: POS_TINT, color: POS }}>+9.3%</span>
              <span style={{ fontSize: 9.5, color: POS, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>+{fmtCompact(41_300_000)}</span>
              <span style={{ fontSize: 9, color: MUTED }}>{tDash('overall')}</span>
            </div>
            {/* Sparkline */}
            <svg style={{ height: 26, display: 'block', marginTop: 10, width: '100%' }} viewBox="0 0 380 26" preserveAspectRatio="none">
              <polyline points="0,21 32,19 63,20 95,17 127,15 158,12 190,10 222,8 253,7 285,4 317,2 348,1 380,0" fill="none" stroke={POS} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="0,21 32,19 63,20 95,17 127,15 158,12 190,10 222,8 253,7 285,4 317,2 348,1 380,0 380,26 0,26" fill={POS_TINT} stroke="none"/>
            </svg>
            {/* Range pills */}
            <div style={{ display: 'flex', gap: 3, marginTop: 5 }}>
              {['1M', '3M', '6M', '1Y', 'All'].map(r => (
                <span key={r} style={{
                  flex: 1, textAlign: 'center', padding: '3px 0', borderRadius: 4,
                  fontSize: 9, fontWeight: 600,
                  background: r === '1Y' ? NAVY_TINT : 'transparent',
                  color: r === '1Y' ? NAVY : MUTED,
                }}>{r}</span>
              ))}
            </div>
            {/* KPI 2×2 grid */}
            <div className="lp-m-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, marginTop: 11, background: LINE, borderRadius: 8, overflow: 'hidden' }}>
              {kpis.map(k => (
                <div key={k.l} style={{ background: '#fff', padding: '7px 9px' }}>
                  <div style={{ fontSize: 8, color: MUTED, whiteSpace: 'nowrap' }}>{k.l}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: INK, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(k.v)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Goals */}
          <div style={{ fontSize: 11, fontWeight: 600, color: INK, marginBottom: 7, letterSpacing: '-0.01em' }}>{tDash('sectionGoals')}</div>
          {GOALS.map(g => (
            <div key={g.key} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 11px', marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: INK }}>{t(g.key)}</div>
                <div style={{ fontSize: 9, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                  {t('mockGoalTarget', { amount: fmtCompact(g.target) })}
                </div>
              </div>
              <div style={{ height: 4, background: LINE, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 99, background: g.pct >= 100 ? POS : NAVY, width: `${g.pct}%` }}/>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                <span style={{ fontSize: 9, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(g.value)}</span>
                <span style={{ fontSize: 9, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{g.pct.toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
