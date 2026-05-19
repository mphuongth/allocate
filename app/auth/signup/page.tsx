'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useTranslations } from 'next-intl'
import { Eye, EyeOff } from 'lucide-react'

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
        if (error.message.toLowerCase().includes('already') || error.status === 422) {
          setFormError(t('emailInUse'))
        } else {
          setFormError(t('cannotCreateAccount'))
        }
        return
      }

      if (!data.session) {
        setConfirmSent(true)
        return
      }

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
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--c-canvas)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px 24px',
        textAlign: 'center',
      }}>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: 'var(--c-navy-tint)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          marginBottom: 16,
        }}>
          📧
        </div>
        <h1 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 600, color: 'var(--c-ink)', letterSpacing: '-0.02em' }}>
          {t('checkEmailTitle')}
        </h1>
        <p style={{ margin: '0 0 32px', fontSize: 14, color: 'var(--c-muted)', maxWidth: 300 }}>
          {t('checkEmailMessage')}
        </p>
        <Link
          href="/auth/login"
          style={{
            display: 'inline-block',
            padding: '13px 24px',
            background: 'var(--c-btn-primary)',
            color: '#fff',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          {t('goToLogin')}
        </Link>
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--c-canvas)',
      display: 'flex',
      flexDirection: 'column',
      padding: '40px 24px 24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          data-testid="brand-mark"
          src="/cairn-icon.svg"
          alt="Cairn"
          width={36}
          height={36}
          style={{ borderRadius: 9, flexShrink: 0 }}
        />
        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--c-ink)' }}>
          Cairn
        </span>
      </div>

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
          {t('signupTitle')}
        </h1>
        <p style={{ marginTop: 8, marginBottom: 28, fontSize: 14, color: 'var(--c-muted)' }}>
          {t('signupSubtitle')}
        </p>

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
          <label style={{ display: 'block' }}>
            <span style={labelSpanStyle}>{t('fullNameLabel')}</span>
            <input
              id="name"
              type="text"
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Minh Nguyen"
              style={inputStyle}
            />
          </label>

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
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={handlePasswordBlur}
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
            {passwordError && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#dc2626' }}>{passwordError}</p>
            )}
          </label>

          <button
            type="submit"
            disabled={loading}
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
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? t('signingUp') : t('signupBtn')}
          </button>
        </form>

        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--c-muted)', marginTop: 'auto', paddingTop: 24 }}>
          {t('hasAccount')}{' '}
          <Link
            href="/auth/login"
            style={{ color: 'var(--c-navy)', fontWeight: 600, textDecoration: 'none' }}
          >
            {t('loginLink')}
          </Link>
        </div>
      </div>
    </div>
  )
}
