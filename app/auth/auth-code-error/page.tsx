import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthLayout } from '../AuthLayout'

// Dedicated OAuth-failure page the callback redirects to (#516). It's a normal
// Next.js server-rendered page under /auth/*, so it inherits the per-request CSP
// nonce like every other auth page — no raw inline script. The link back to
// login is a plain <a>, so recovery works even with JavaScript disabled.
export default async function AuthCodeErrorPage() {
  const t = await getTranslations('auth')
  return (
    <AuthLayout>
      <div data-testid="auth-card" className="cn-auth-card" style={{ textAlign: 'center' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'var(--c-navy-tint)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, margin: '0 auto 16px',
        }}>
          ⚠️
        </div>
        <h1 className="cn-auth-title" style={{ marginBottom: 12 }}>{t('oauthErrorTitle')}</h1>
        <p className="cn-auth-sub" style={{ marginBottom: 24 }}>{t('oauthErrorMessage')}</p>
        <Link
          href="/auth/login"
          className="cn-btn primary"
          style={{ display: 'inline-flex', padding: '11px 24px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
        >
          {t('goToLogin')}
        </Link>
      </div>
    </AuthLayout>
  )
}
