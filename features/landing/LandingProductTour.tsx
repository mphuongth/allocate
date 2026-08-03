'use client'

import { useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

// The landing page's "what does this actually look like?" section.
//
// Everything else on the page is drawn: the hero and plan spotlight are hand-built CSS
// stills (LandingAppMockup / LandingPlanMockup), and the six feature cards are pure text.
// That left a visitor deciding whether to hand over an email with no picture of four of
// the app's screens. This section shows real PNGs captured from the running app by
// scripts/generate-tour-screenshots.mjs — so, like the mockups, it cannot advertise an app
// we do not ship, and unlike the mockups it costs nothing to keep in step (re-run the
// script).
//
// The shots are baked per locale because the UI inside them is localized; serving the
// Vietnamese captures to an English visitor would show an interface they cannot read.
// Tab labels come from nav.* — the same keys the real Sidebar renders — so the tour can
// never name a screen something the app doesn't call it.

const NAVY = '#0F2A4A'
const MUTED_ON_NAVY = 'rgba(255,255,255,0.58)'

// Capture sizes (see generate-tour-screenshots.mjs). Declared on the tags so each box
// reserves its aspect ratio and the section doesn't reflow as the PNGs load.
const SHOT_W = 1440
const SHOT_H = 900
const SHOT_MOBILE_W = 390
const SHOT_MOBILE_H = 844

// Where the tour swaps to the mobile captures. Matches the phone breakpoint the rest of
// the landing page uses (LANDING_RESPONSIVE_CSS in app/page.tsx) — they must agree, or the
// chrome bar hides at a different width than the image swaps.
const MOBILE_BP = 640

const SCREENS = [
  { id: 'dashboard', navKey: 'dashboard', bodyKey: 'tourDashboardBody' },
  { id: 'planning', navKey: 'planning', bodyKey: 'tourPlanningBody' },
  { id: 'funds', navKey: 'funds', bodyKey: 'tourFundsBody' },
  { id: 'settings', navKey: 'settings', bodyKey: 'tourSettingsBody' },
] as const

export function LandingProductTour() {
  const t = useTranslations('landing')
  const tNav = useTranslations('nav')
  const locale = useLocale()
  const [active, setActive] = useState(0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const current = SCREENS[active]
  const currentName = tNav(current.navKey)

  // Roving-tabindex arrow navigation, wrapping at both ends (WAI-ARIA tabs pattern).
  function onKeyDown(e: React.KeyboardEvent) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = (active + delta + SCREENS.length) % SCREENS.length
    setActive(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <section
      id="tour"
      className="lp-tour"
      style={{
        background: NAVY,
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
        padding: '96px 0',
        borderTop: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="lp-tour-inner" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 48px' }}>
        {/* Header */}
        <div className="reveal lp-section-header" style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 10 }}>
            {t('tourKicker')}
          </div>
          <h2 className="lp-section-h2" style={{ fontSize: 40, fontWeight: 700, color: '#fff', letterSpacing: '-0.038em', lineHeight: 1.1, margin: '0 0 14px' }}>
            {t('tourH2')}
          </h2>
          <p className="lp-section-lead" style={{ fontSize: 16, color: MUTED_ON_NAVY, lineHeight: 1.65, maxWidth: 560, margin: '0 auto' }}>
            {t('tourLead')}
          </p>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label={t('tourKicker')}
          onKeyDown={onKeyDown}
          className="reveal reveal-delay-1 lp-tour-tabs"
          style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 26, flexWrap: 'wrap' }}
        >
          {SCREENS.map((s, i) => {
            const selected = i === active
            return (
              <button
                key={s.id}
                ref={el => { tabRefs.current[i] = el }}
                id={`lp-tour-tab-${s.id}`}
                role="tab"
                aria-selected={selected}
                aria-controls="lp-tour-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(i)}
                className="lp-tour-tab"
                style={{
                  padding: '8px 18px',
                  borderRadius: 10,
                  fontSize: 13.5,
                  fontWeight: selected ? 600 : 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  background: selected ? '#fff' : 'rgba(255,255,255,0.09)',
                  color: selected ? NAVY : 'rgba(255,255,255,0.82)',
                  border: `1px solid ${selected ? 'transparent' : 'rgba(255,255,255,0.14)'}`,
                  transition: 'background 150ms, color 150ms',
                }}
              >
                {tNav(s.navKey)}
              </button>
            )
          })}
        </div>

        {/* Panel — browser frame + the selected screenshot */}
        <div
          id="lp-tour-panel"
          role="tabpanel"
          aria-labelledby={`lp-tour-tab-${current.id}`}
          tabIndex={0}
          className="reveal reveal-delay-2"
        >
          <div
            className="lp-tour-frame"
            style={{
              background: '#fff',
              borderRadius: 14,
              overflow: 'hidden',
              boxShadow: '0 24px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)',
            }}
          >
            {/* Same chrome the hero mockup wears, so the two read as one product. */}
            <div className="lp-tour-chrome" style={{ background: '#edeae2', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #e0dcd2' }}>
              <div style={{ display: 'flex', gap: 5 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', display: 'block' }} />
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', display: 'block' }} />
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', display: 'block' }} />
              </div>
              <div className="lp-chrome-url" style={{ flex: 1, textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: '#78716c', background: '#e0dcd2', borderRadius: 5, padding: '3px 10px' }}>
                {`cairn-money.vercel.app/${current.id}`}
              </div>
            </div>

            {/* Art direction, not just scaling: the desktop capture is 1440px of dense
                UI, and squeezing it into a phone column renders it unreadable — which
                would defeat the point of the section. Small screens get the app's real
                mobile view instead. <picture> is what makes this cheap: the browser
                fetches only the matching source, where a display:none pair would pull
                both. (next/image can't express art direction, hence the plain tags.) */}
            <picture>
              <source
                media={`(max-width: ${MOBILE_BP}px)`}
                srcSet={`/tour/${current.id}-${locale}-mobile.png`}
                width={SHOT_MOBILE_W}
                height={SHOT_MOBILE_H}
              />
              <img
                key={current.id}
                className="lp-tour-shot"
                src={`/tour/${current.id}-${locale}.png`}
                alt={t('tourAlt', { screen: currentName })}
                width={SHOT_W}
                height={SHOT_H}
                loading="lazy"
                decoding="async"
                style={{ display: 'block', width: '100%', height: 'auto' }}
              />
            </picture>
          </div>

          {/* Caption for the selected screen. */}
          <p
            className="lp-tour-caption"
            style={{ fontSize: 14.5, color: MUTED_ON_NAVY, lineHeight: 1.65, textAlign: 'center', maxWidth: 560, margin: '22px auto 0' }}
          >
            {t(current.bodyKey)}
          </p>
        </div>
      </div>
    </section>
  )
}
