import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTranslations } from 'next-intl/server'
import { ScrollRevealInit } from './components/ScrollRevealInit'
import { LandingLangToggle } from './components/LandingLangToggle'

const NAVY = '#0F2A4A'
const LINE = '#e9e5dc'
const CANVAS = '#faf8f4'
const POS = '#047857'
const POS_TINT = '#ecfdf5'
const NAVY_TINT = '#eef2f8'
const MUTED = '#78716c'
const INK = '#18181b'
const INK_2 = '#3f3f46'

function CairnLogo({ width = 26, height = 22 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="110 180 283 240" xmlns="http://www.w3.org/2000/svg">
      <rect x="111.872" y="359.936" width="280.064" height="57.856" rx="24.3" fill="#3B5A82"/>
      <rect x="152.064" y="293.888" width="220.16" height="50.176" rx="21.07" fill="#163A61"/>
      <rect x="163.84" y="233.984" width="167.936" height="44.032" rx="18.49" fill="#10B981"/>
      <rect x="208.128" y="181.76" width="103.936" height="35.84" rx="15.05" fill="#F8FAFC"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 7"/>
    </svg>
  )
}

const LANDING_RESPONSIVE_CSS = `
/* Horizontal overflow guard — use overflow-x:clip instead of hidden so
   the sticky <nav> still pins. overflow:hidden creates a scroll container
   which can make position:sticky stop working in iOS Safari and some
   Chrome configurations. clip clips without creating a scroll context. */
html, body { overflow-x: clip; }

/* ── Responsive: tablet ─────────────────────────────────────────────────── */
@media (max-width: 960px) {
  .lp-nav-inner,
  .lp-hero-inner,
  .lp-features-grid,
  .lp-steps,
  .lp-spotlight-inner,
  .lp-cta-inner,
  .lp-footer-inner { padding-left: 32px !important; padding-right: 32px !important; }

  .lp-hero-inner {
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 40px !important;
    padding-top: 56px !important;
    align-items: stretch !important;
  }
  .lp-hero-copy { padding-bottom: 0 !important; text-align: left !important; min-width: 0 !important; }
  .lp-hero-h1 { font-size: 48px !important; }
  .lp-mockup-wrap { justify-content: center !important; min-width: 0 !important; }
  .lp-mockup { width: 100% !important; max-width: 560px !important; flex-shrink: 1 !important; }

  .lp-features-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .lp-steps { grid-template-columns: minmax(0, 1fr) !important; gap: 40px !important; }
  .lp-step { padding: 0 !important; border-right: none !important; border-bottom: 1px solid #e9e5dc !important; padding-bottom: 32px !important; }
  .lp-step:last-child { border-bottom: none !important; padding-bottom: 0 !important; }

  .lp-spotlight-inner { grid-template-columns: minmax(0, 1fr) !important; gap: 48px !important; }
  .lp-spotlight-copy { max-width: none !important; }
}

/* ── Responsive: phone ──────────────────────────────────────────────────── */
@media (max-width: 640px) {
  /* Nav — collapse links, keep brand + lang + login */
  .lp-nav-inner { height: 54px !important; padding: 0 18px !important; }
  .lp-nav-links { display: none !important; }
  .lp-nav-actions { gap: 6px !important; flex-shrink: 0 !important; }
  /* Both auth buttons get the smaller mobile padding so Vietnamese labels
     (Đăng nhập / Đăng ký) fit cleanly next to the language toggle. */
  .lp-nav-login,
  .lp-nav-signup {
    padding: 6px 10px !important;
    font-size: 12px !important;
    white-space: nowrap !important;
  }
  .lp-logo { flex-shrink: 0 !important; }
  .lp-logo-wordmark { font-size: 17px !important; }

  /* Hero — denser, full-width */
  .lp-hero { padding-top: 0 !important; }
  .lp-hero-inner {
    grid-template-columns: 1fr !important;
    gap: 32px !important;
    padding: 40px 20px 0 !important;
  }
  .lp-eyebrow { font-size: 10px !important; margin-bottom: 16px !important; }
  .lp-hero-h1 {
    font-size: 36px !important;
    letter-spacing: -0.035em !important;
    line-height: 1.08 !important;
    margin-bottom: 16px !important;
  }
  .lp-hero-sub {
    font-size: 15px !important;
    line-height: 1.55 !important;
    margin-bottom: 26px !important;
    max-width: none !important;
  }
  .lp-hero-ctas { gap: 8px !important; flex-wrap: wrap !important; }
  .lp-hero-ctas > a { flex: 1 !important; justify-content: center !important; min-width: 140px !important; }

  /* Mockup — scale to fit, clip taller content */
  .lp-mockup-wrap { width: 100% !important; }
  .lp-mockup {
    width: calc(100% - 20px) !important;
    margin: 0 10px !important;
    border-radius: 10px 10px 0 0 !important;
  }
  .lp-mockup-chrome { padding: 8px 12px !important; }
  .lp-chrome-url { font-size: 9.5px !important; padding: 2px 8px !important; }
  .lp-mockup-app { height: 360px !important; }
  .lp-m-sidebar { width: 44px !important; padding: 12px 0 !important; }
  .lp-m-nav-item { width: 30px !important; height: 30px !important; }
  .lp-m-content { padding: 14px 14px !important; }
  .lp-m-page-title { font-size: 14px !important; }
  .lp-m-kpi-val { font-size: 15px !important; }
  .lp-m-actions { display: none !important; }
  .lp-m-page-header { padding-bottom: 10px !important; margin-bottom: 12px !important; }

  /* Section headers */
  .lp-features,
  .lp-how,
  .lp-spotlight { padding: 64px 0 !important; }
  .lp-section-h2 { font-size: 30px !important; letter-spacing: -0.035em !important; }
  .lp-section-lead { font-size: 14.5px !important; }
  .lp-section-header { margin-bottom: 36px !important; }

  /* Features — single column */
  .lp-features-grid {
    grid-template-columns: 1fr !important;
    gap: 12px !important;
    padding: 0 20px !important;
  }
  .lp-feat { padding: 22px 20px !important; }
  .lp-feat-title { font-size: 14.5px !important; }
  .lp-feat-body { font-size: 13px !important; }

  /* How — single column already from tablet */
  .lp-steps { padding: 0 20px !important; gap: 28px !important; }
  .lp-step-num { font-size: 40px !important; margin-bottom: 12px !important; }
  .lp-step-title { font-size: 16px !important; }
  .lp-step-body { font-size: 13.5px !important; }

  /* Spotlight — stack */
  .lp-spotlight-inner { padding: 0 20px !important; gap: 36px !important; }
  .lp-spotlight-copy p { font-size: 14px !important; margin-bottom: 22px !important; }

  /* CTA */
  .lp-cta { padding: 72px 0 !important; }
  .lp-cta-inner { padding: 0 20px !important; }
  .lp-cta-h2 { font-size: 32px !important; letter-spacing: -0.035em !important; }
  .lp-cta-sub { font-size: 14.5px !important; margin-bottom: 28px !important; }
  .lp-cta-btns { flex-direction: column !important; gap: 8px !important; }
  .lp-cta-btns > a { width: 100% !important; justify-content: center !important; }

  /* Footer */
  .lp-footer { padding: 22px 0 !important; }
  .lp-footer-inner {
    padding: 0 20px !important;
  }
}

/* ── Responsive: small phone polish ─────────────────────────────────────── */
@media (max-width: 380px) {
  .lp-hero-h1 { font-size: 32px !important; }
  .lp-section-h2 { font-size: 26px !important; }
  .lp-cta-h2 { font-size: 28px !important; }
  .lp-mockup-app { height: 320px !important; }
}
`

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  const t = await getTranslations('landing')

  const features = [
    {
      iconBg: '#eef2f8',
      icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#0F2A4A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="#0F2A4A"/></svg>,
      title: t('feat1Title'),
      body: t('feat1Body'),
    },
    {
      iconBg: '#ecfdf5',
      icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>,
      title: t('feat2Title'),
      body: t('feat2Body'),
    },
    {
      iconBg: '#eff6ff',
      icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5M12 16V9M16 16v-3"/></svg>,
      title: t('feat3Title'),
      body: t('feat3Body'),
    },
    {
      iconBg: '#fef7e6',
      icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8M14 7h7v7"/></svg>,
      title: t('feat4Title'),
      body: t('feat4Body'),
    },
    {
      iconBg: '#f5f0ff',
      icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z"/></svg>,
      title: t('feat5Title'),
      body: t('feat5Body'),
    },
    {
      iconBg: '#fef2f2',
      icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>,
      title: t('feat6Title'),
      body: t('feat6Body'),
    },
  ]

  const steps = [
    { num: t('step1Num'), title: t('step1Title'), body: t('step1Body') },
    { num: t('step2Num'), title: t('step2Title'), body: t('step2Body') },
    { num: t('step3Num'), title: t('step3Title'), body: t('step3Body') },
  ]

  const checks = [t('check1'), t('check2'), t('check3'), t('check4')]

  return (
    <>
      <ScrollRevealInit />
      <div className="lp-root" style={{ fontFamily: "'Be Vietnam Pro', -apple-system, sans-serif", background: CANVAS }}>
        <style dangerouslySetInnerHTML={{ __html: LANDING_RESPONSIVE_CSS }} />

        {/* ── Nav ───────────────────────────────────────────────────────────── */}
        <nav className="lp-nav" style={{ position: 'sticky', top: 0, zIndex: 200, background: NAVY, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="lp-nav-inner" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 48px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Link href="/" className="lp-logo" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
              <CairnLogo width={26} height={22} />
              <span className="lp-logo-wordmark" style={{ fontSize: 19, fontWeight: 700, color: '#fff', letterSpacing: '-0.03em' }}>Cairn</span>
            </Link>
            <div className="lp-nav-links" style={{ display: 'flex', gap: 28 }}>
              {[['#features', 'Features'], ['#how', 'How it works'], ['#plan', 'Monthly plan']].map(([href, label]) => (
                <a key={href} href={href} style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}
                  className="hover:!text-white transition-colors duration-150">{label}</a>
              ))}
            </div>
            <div className="lp-nav-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <LandingLangToggle />
              <Link href="/auth/login"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: 500, padding: '7px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', textDecoration: 'none' }}
                className="lp-nav-login hover:!bg-white/[0.15] transition-colors duration-150">
                {t('loginLink')}
              </Link>
              <Link href="/auth/signup"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: NAVY, fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 10, border: 'none', textDecoration: 'none' }}
                className="lp-nav-signup hover:opacity-90 transition-opacity duration-150">
                {t('signupLink')}
              </Link>
            </div>
          </div>
        </nav>

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <section className="lp-hero" style={{ background: NAVY, backgroundImage: 'radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)', backgroundSize: '28px 28px', paddingTop: 88, overflow: 'hidden' }}>
          <div className="lp-hero-inner" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 48px', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'flex-end', gap: 56 }}>
            {/* Copy */}
            <div className="lp-hero-copy" style={{ paddingBottom: 80 }}>
              <div className="lp-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 22 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: POS, display: 'block', flexShrink: 0 }}/>
                {t('eyebrow')}
              </div>
              <h1 className="lp-hero-h1" style={{ margin: '0 0 18px', fontSize: 58, fontWeight: 700, color: '#fff', letterSpacing: '-0.04em', lineHeight: 1.06 }}>
                {t('heroH1')}
              </h1>
              <p className="lp-hero-sub" style={{ margin: '0 0 36px', fontSize: 17, color: 'rgba(255,255,255,0.58)', lineHeight: 1.65, maxWidth: 430 }}>
                {t('heroSub')}
              </p>
              <div className="lp-hero-ctas" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Link href="/auth/signup"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: NAVY, fontSize: 13.5, fontWeight: 600, padding: '9px 20px', borderRadius: 10, border: 'none', textDecoration: 'none', whiteSpace: 'nowrap' }}
                  className="hover:opacity-90 transition-opacity duration-150">
                  {t('heroCta1')}
                </Link>
                <a href="#how"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.82)', fontSize: 13.5, fontWeight: 500, padding: '9px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', textDecoration: 'none', whiteSpace: 'nowrap' }}
                  className="hover:!bg-white/[0.15] transition-colors duration-150">
                  {t('heroCta2')}
                </a>
              </div>
            </div>

            {/* App mockup */}
            <div className="lp-mockup-wrap" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end' }}>
              <div className="lp-mockup" style={{ width: 540, flexShrink: 0, background: '#fff', borderRadius: '12px 12px 0 0', boxShadow: '0 -8px 64px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                {/* Browser chrome */}
                <div className="lp-mockup-chrome" style={{ background: '#edeae2', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #e0dcd2' }}>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', display: 'block' }}/>
                    <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', display: 'block' }}/>
                    <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', display: 'block' }}/>
                  </div>
                  <div className="lp-chrome-url" style={{ flex: 1, textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: '#78716c', background: '#e0dcd2', borderRadius: 5, padding: '3px 10px' }}>
                    cairn.app/dashboard
                  </div>
                </div>
                {/* App layout */}
                <div className="lp-mockup-app" style={{ display: 'flex', height: 400, overflow: 'hidden' }}>
                  {/* Sidebar */}
                  <div className="lp-m-sidebar" style={{ width: 52, background: NAVY, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0', gap: 4 }}>
                    <div style={{ marginBottom: 12 }}>
                      <CairnLogo width={20} height={17} />
                    </div>
                    <div className="lp-m-nav-item" style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.15)' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></svg>
                    </div>
                    <div className="lp-m-nav-item" style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>
                    </div>
                    <div className="lp-m-nav-item" style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="2" strokeLinecap="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5M12 16V9M16 16v-3"/></svg>
                    </div>
                    <div className="lp-m-nav-item" style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 'auto' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    </div>
                  </div>
                  {/* Main content */}
                  <div className="lp-m-content" style={{ flex: 1, background: '#faf8f4', padding: '16px 18px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <div className="lp-m-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, borderBottom: '1px solid #e9e5dc', paddingBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: MUTED, fontWeight: 600, marginBottom: 2 }}>Overview</div>
                        <div className="lp-m-page-title" style={{ fontSize: 15, fontWeight: 700, color: INK, letterSpacing: '-0.025em' }}>Hi, Minh</div>
                      </div>
                      <div className="lp-m-actions" style={{ display: 'flex', gap: 5 }}>
                        <div style={{ fontSize: 9, fontWeight: 600, padding: '4px 9px', borderRadius: 7, border: `1px solid ${LINE}`, background: '#fff', color: NAVY }}>+ Transaction</div>
                        <div style={{ fontSize: 9, fontWeight: 600, padding: '4px 9px', borderRadius: 7, border: `1px solid ${NAVY}`, background: NAVY, color: '#fff' }}>+ New goal</div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                      <div style={{ background: '#fff', border: `1px solid #e9e5dc`, borderRadius: 10, padding: '9px 12px' }}>
                        <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED, fontWeight: 600, marginBottom: 3 }}>Net worth</div>
                        <div className="lp-m-kpi-val" style={{ fontSize: 17, fontWeight: 700, color: INK, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>487.5M ₫</div>
                      </div>
                      <div style={{ background: '#fff', border: `1px solid #e9e5dc`, borderRadius: 10, padding: '9px 12px' }}>
                        <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED, fontWeight: 600, marginBottom: 3 }}>Total P/L</div>
                        <div className="lp-m-kpi-val" style={{ fontSize: 17, fontWeight: 700, color: POS, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>+41.3M ₫</div>
                      </div>
                    </div>
                    <svg style={{ height: 28, display: 'block', marginBottom: 14, width: '100%' }} viewBox="0 0 460 28" preserveAspectRatio="none">
                      <polyline points="0,22 38,20 76,21 114,18 152,16 190,13 228,11 266,8 304,7 342,4 380,2 418,1 460,0" fill="none" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <polyline points="0,22 38,20 76,21 114,18 152,16 190,13 228,11 266,8 304,7 342,4 380,2 418,1 460,0 460,28 0,28" fill={NAVY_TINT} stroke="none"/>
                    </svg>
                    <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: MUTED, fontWeight: 600, marginBottom: 8 }}>Goals</div>
                    {[
                      { name: 'Retirement', meta: '215.4M ₫ · 10.8%', pct: 10.8, done: false },
                      { name: 'House down payment', meta: '142.8M ₫ · 28.6%', pct: 28.6, done: false },
                      { name: 'Emergency fund', meta: '85.0M ₫ · 85%', pct: 85, done: true },
                      { name: 'New laptop', meta: '18.1M ₫ · 51.7%', pct: 51.7, done: false },
                    ].map(g => (
                      <div key={g.name} style={{ background: '#fff', border: `1px solid #e9e5dc`, borderRadius: 10, padding: '9px 12px', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: INK }}>{g.name}</div>
                          <div style={{ fontSize: 9.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{g.meta}</div>
                        </div>
                        <div style={{ height: 4, background: '#e9e5dc', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 99, background: g.done ? POS : NAVY, width: `${g.pct}%` }}/>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────────────────── */}
        <section id="features" className="lp-features" style={{ padding: '96px 0', background: CANVAS }}>
          <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 48px' }}>
            <div className="reveal lp-section-header" style={{ textAlign: 'center', marginBottom: 52 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: NAVY, marginBottom: 10 }}>{t('featuresKicker')}</div>
              <h2 className="lp-section-h2" style={{ fontSize: 40, fontWeight: 700, color: INK, letterSpacing: '-0.038em', lineHeight: 1.1, margin: '0 0 14px' }}>{t('featuresH2')}</h2>
              <p className="lp-section-lead" style={{ fontSize: 16, color: MUTED, lineHeight: 1.65, maxWidth: 500, margin: '0 auto' }}>{t('featuresLead')}</p>
            </div>
          </div>
          <div className="lp-features-grid" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 48px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
            {features.map((f, i) => (
              <div key={i} className={`reveal reveal-delay-${i + 1} lp-feat`}
                style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '26px 24px', boxShadow: '0 1px 0 rgba(15,42,74,0.04), 0 1px 2px rgba(15,42,74,0.05)', display: 'flex', flexDirection: 'column', gap: 0, transition: 'box-shadow 200ms, transform 200ms' }}
                onMouseEnter={undefined}>
                <div style={{ width: 42, height: 42, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: f.iconBg, marginBottom: 14, flexShrink: 0 }}>
                  {f.icon}
                </div>
                <h3 className="lp-feat-title" style={{ fontSize: 15, fontWeight: 700, color: INK, letterSpacing: '-0.02em', margin: '0 0 7px' }}>{f.title}</h3>
                <p className="lp-feat-body" style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.6, margin: 0 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────────── */}
        <section id="how" className="lp-how" style={{ padding: '96px 0', background: '#fff', borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
          <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 48px' }}>
            <div className="reveal lp-section-header" style={{ textAlign: 'center', marginBottom: 52 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: NAVY, marginBottom: 10 }}>{t('howKicker')}</div>
              <h2 className="lp-section-h2" style={{ fontSize: 40, fontWeight: 700, color: INK, letterSpacing: '-0.038em', lineHeight: 1.1, margin: '0 0 14px' }}>{t('howH2')}</h2>
              <p className="lp-section-lead" style={{ fontSize: 16, color: MUTED, lineHeight: 1.65, maxWidth: 500, margin: '0 auto' }}>{t('howLead')}</p>
            </div>
          </div>
          <div className="lp-steps" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 48px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {steps.map((s, i) => (
              <div key={i} className={`reveal reveal-delay-${i + 1} lp-step`}
                style={{ padding: '0 48px', borderRight: i < 2 ? `1px solid ${LINE}` : 'none', paddingLeft: i === 0 ? 0 : undefined }}>
                <div className="lp-step-num" style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.05em', color: '#d8d3c5', lineHeight: 1, marginBottom: 18 }}>{s.num}</div>
                <h3 className="lp-step-title" style={{ fontSize: 17, fontWeight: 700, color: INK, letterSpacing: '-0.02em', margin: '0 0 9px' }}>{s.title}</h3>
                <p className="lp-step-body" style={{ fontSize: 14, color: MUTED, lineHeight: 1.65, margin: 0 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Monthly plan spotlight ──────────────────────────────────────────── */}
        <section id="plan" className="lp-spotlight" style={{ padding: '96px 0', background: CANVAS, borderBottom: `1px solid ${LINE}` }}>
          <div className="lp-spotlight-inner" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 48px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 72, alignItems: 'center' }}>
            {/* Copy */}
            <div className="reveal lp-spotlight-copy" style={{ maxWidth: 440 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: NAVY, marginBottom: 10 }}>{t('spotlightKicker')}</div>
              <h2 className="lp-section-h2" style={{ fontSize: 40, fontWeight: 700, color: INK, letterSpacing: '-0.038em', lineHeight: 1.1, margin: '0 0 14px', textAlign: 'left' }}>{t('spotlightH2')}</h2>
              <p style={{ fontSize: 15, color: MUTED, lineHeight: 1.7, margin: '0 0 28px' }}>{t('spotlightBody')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {checks.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ width: 20, height: 20, borderRadius: 10, background: POS_TINT, color: POS, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                      <CheckIcon />
                    </div>
                    <span style={{ fontSize: 13.5, color: INK_2, lineHeight: 1.5 }}>{c}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Plan mockup */}
            <div className="reveal reveal-delay-2" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: '0 8px 24px rgba(15,42,74,0.12)', overflow: 'hidden' }}>
              <div style={{ background: CANVAS, borderBottom: `1px solid ${LINE}`, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK, letterSpacing: '-0.02em' }}>May 2026</div>
                <div style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>Monthly plan</div>
              </div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Summary bar */}
                <div style={{ background: NAVY_TINT, borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: NAVY }}>Invest this month</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>22.8M ₫</div>
                    <div style={{ fontSize: 10, color: 'rgba(15,42,74,0.6)', marginTop: 2 }}>of 45M ₫ salary · 4 goals</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: NAVY }}>Remaining</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>12.2M ₫</div>
                    <div style={{ fontSize: 10, color: 'rgba(15,42,74,0.6)', marginTop: 2 }}>after expenses</div>
                  </div>
                </div>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: MUTED, marginBottom: 8 }}>Contribution by goal</div>
                {[
                  { name: 'Retirement', sub: 'VFMVF1 + DCDS', amt: '8.0M ₫' },
                  { name: 'House down payment', sub: 'VESAF + VCB Save', amt: '7.5M ₫' },
                  { name: 'Emergency fund', sub: 'VCB Flex Save + MB Term 6M', amt: '4.0M ₫' },
                  { name: 'New laptop', sub: 'MB Term 3M', amt: '3.3M ₫' },
                ].map((row, i, arr) => (
                  <div key={row.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < arr.length - 1 ? `1px solid ${LINE}` : 'none' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>{row.name}</div>
                      <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{row.sub}</div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{row.amt}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────────────────────────────────── */}
        <section className="lp-cta" style={{ background: NAVY, padding: '100px 0', backgroundImage: 'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '28px 28px' }}>
          <div className="lp-cta-inner" style={{ maxWidth: 600, margin: '0 auto', padding: '0 48px', textAlign: 'center' }}>
            <div className="reveal" style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
              <CairnLogo width={58} height={49} />
            </div>
            <h2 className="reveal lp-cta-h2" style={{ fontSize: 44, fontWeight: 700, color: '#fff', letterSpacing: '-0.04em', lineHeight: 1.1, margin: '0 0 16px' }}>{t('ctaH2')}</h2>
            <p className="reveal reveal-delay-1 lp-cta-sub" style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, margin: '0 0 38px' }}>{t('ctaSub')}</p>
            <div className="reveal reveal-delay-2 lp-cta-btns" style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Link href="/auth/signup"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: NAVY, fontSize: 13.5, fontWeight: 600, padding: '9px 20px', borderRadius: 10, border: 'none', textDecoration: 'none', whiteSpace: 'nowrap' }}
                className="hover:opacity-90 transition-opacity duration-150">
                {t('ctaCta1')}
              </Link>
              <Link href="/auth/login"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.82)', fontSize: 13.5, fontWeight: 500, padding: '9px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', textDecoration: 'none', whiteSpace: 'nowrap' }}
                className="hover:!bg-white/[0.15] transition-colors duration-150">
                {t('ctaCta2')}
              </Link>
            </div>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <footer className="lp-footer" style={{ background: '#081b30', padding: '28px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="lp-footer-inner" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="lp-footer-brand" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ opacity: 0.45 }}><CairnLogo width={22} height={19} /></span>
              <span className="lp-footer-copy" style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>{t('footerCopy')}</span>
            </div>
          </div>
        </footer>

      </div>
    </>
  )
}
