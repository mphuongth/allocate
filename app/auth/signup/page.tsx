'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useTranslations } from 'next-intl'
import { Eye, EyeOff } from 'lucide-react'
import { AuthLayout } from '../AuthLayout'
import PendingButton from '@/components/ui/PendingButton'
import { announceCacheOwner } from '@/lib/clientCache'

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
  color: 'var(--c-muted)',
}

export default function SignupPage() {
  const t = useTranslations('auth')
  const router = useRouter()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  function handlePasswordBlur() {
    if (password && password.length < 8) {
      setPasswordError(t('passwordTooShort'))
    } else {
      setPasswordError(null)
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (password.length < 8) {
      setPasswordError(t('passwordTooShort'))
      return
    }

    setLoading(true)

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      })

      if (error) {
        // One neutral message for every signup failure so an attacker can't
        // tell "email already registered" apart from other errors (user
        // enumeration). Supabase project-level "email enumeration protection"
        // is the server-side complement.
        setFormError(t('cannotCreateAccount'))
        return
      }

      if (!data.session) {
        setConfirmSent(true)
        return
      }

      // Take over the service worker's cache ownership before leaving this page,
      // so a stale owner left by an earlier account on this machine can't answer
      // the new account's first failed request (#565). Never block signup on it.
      await announceCacheOwner(data.user?.id ?? '').catch(() => {})

      router.push('/dashboard')
      router.refresh()
    } catch {
      setFormError(t('cannotConnect'))
    } finally {
      setLoading(false)
    }
  }

  if (confirmSent) {
    return (
      <AuthLayout>
        <div data-testid="auth-card" className="cn-auth-card" style={{ textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'var(--c-navy-tint)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, margin: '0 auto 16px',
          }}>
            📧
          </div>
          <h1 className="cn-auth-title" style={{ marginBottom: 12 }}>{t('checkEmailTitle')}</h1>
          <p className="cn-auth-sub" style={{ marginBottom: 24 }}>{t('checkEmailMessage')}</p>
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

  return (
    <AuthLayout>
      <div data-testid="auth-card" className="cn-auth-card">
        <h1 className="cn-auth-title">{t('signupTitle')}</h1>
        <p className="cn-auth-sub">{t('signupSubtitle')}</p>

        {formError && (
          <div role="alert" style={{
            marginBottom: 16,
            padding: '10px 12px',
            background: 'rgba(220,38,38,0.08)',
            color: '#dc2626',
            fontSize: 13,
            borderRadius: 9,
            border: '1px solid rgba(220,38,38,0.2)',
          }}>
            {formError}
          </div>
        )}

        <form onSubmit={handleSignup} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <label htmlFor="name" style={fieldLabelStyle}>{t('fullNameLabel')}</label>
            <input
              id="name"
              type="text"
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Minh Nguyen"
              className="cn-input"
            />
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <label htmlFor="email" style={fieldLabelStyle}>{t('emailLabel')}</label>
            <input
              id="email"
              type="email"
              name="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="cn-input"
            />
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <label htmlFor="password" style={fieldLabelStyle}>{t('passwordLabel')}</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={handlePasswordBlur}
                placeholder="••••••••"
                className="cn-input"
                style={{ paddingRight: 40 }}
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
            {passwordError && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#dc2626' }}>{passwordError}</p>
            )}
          </div>

          <PendingButton
            type="submit"
            pending={loading}
            pendingLabel={t('signingUp')}
            className="cn-btn primary"
            style={{
              width: '100%',
              padding: '13px 16px',
              marginTop: 18,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {t('signupBtn')}
          </PendingButton>
        </form>
      </div>

      <p className="cn-auth-alt">
        {t('hasAccount')}{' '}
        <Link href="/auth/login" style={{ color: 'var(--c-navy)', fontWeight: 600, textDecoration: 'none' }}>
          {t('loginLink')}
        </Link>
      </p>
    </AuthLayout>
  )
}
