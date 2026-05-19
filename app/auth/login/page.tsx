'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, Suspense } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useTranslations } from 'next-intl'
import { Eye, EyeOff } from 'lucide-react'
import { AuthLayout } from '../AuthLayout'

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 12px',
  marginTop: 4,
  background: 'var(--c-card)',
  border: '1px solid var(--c-line-strong)',
  borderRadius: 9,
  fontSize: 14,
  color: 'var(--c-ink)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const labelSpanStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--c-muted)',
  fontWeight: 500,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
}

function LoginForm() {
  const t = useTranslations('auth')
  const router = useRouter()
  const searchParams = useSearchParams()
  const expired = searchParams.get('expired') === 'true'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(expired ? t('sessionExpired') : null)
  const [loading, setLoading] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(t('invalidCredentials'))
        setLoading(false)
      } else {
        setRedirecting(true)
        router.push('/dashboard')
        router.refresh()
      }
    } catch {
      setError(t('cannotConnect'))
      setLoading(false)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h1 style={{
        margin: 0,
        fontSize: 28,
        fontFamily: 'var(--font-sans)',
        fontWeight: 600,
        letterSpacing: '-0.025em',
        lineHeight: 1.15,
        color: 'var(--c-ink)',
      }}>
        {t('loginTitle')}
      </h1>
      <p style={{ marginTop: 8, marginBottom: 28, fontSize: 14, color: 'var(--c-muted)' }}>
        {t('loginSubtitle')}
      </p>

      {error && (
        <div role="alert" style={{
          marginBottom: 16,
          padding: '10px 12px',
          background: 'rgba(220,38,38,0.08)',
          color: '#dc2626',
          fontSize: 13,
          borderRadius: 9,
          border: '1px solid rgba(220,38,38,0.2)',
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleLogin} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'block' }}>
          <span style={labelSpanStyle}>{t('emailLabel')}</span>
          <input
            id="email"
            type="email"
            name="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'block' }}>
          <span style={labelSpanStyle}>{t('passwordLabel')}</span>
          <div style={{ position: 'relative' }}>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              name="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ ...inputStyle, paddingRight: 40 }}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: 'var(--c-muted)', display: 'flex',
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        <button
          type="button"
          style={{
            background: 'transparent',
            border: 'none',
            padding: '10px 0',
            fontSize: 12,
            color: 'var(--c-navy)',
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          {t('forgotPassword')}
        </button>

        <button
          type="submit"
          disabled={loading || redirecting}
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            padding: '13px 16px',
            marginTop: 18,
            background: 'var(--c-btn-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: loading || redirecting ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            opacity: loading || redirecting ? 0.7 : 1,
          }}
        >
          {redirecting ? t('redirecting') : loading ? t('loggingIn') : t('loginBtn')}
        </button>
      </form>

      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--c-muted)', marginTop: 'auto', paddingTop: 24 }}>
        {t('noAccount')}{' '}
        <Link
          href="/auth/signup"
          style={{ color: 'var(--c-navy)', fontWeight: 600, textDecoration: 'none' }}
        >
          {t('signupLink')}
        </Link>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <AuthLayout>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  )
}
