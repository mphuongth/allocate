'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useTranslations } from 'next-intl'
import ThemeToggleButton from '@/app/components/ThemeToggleButton'

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors'

export default function SignupPage() {
  const t = useTranslations('auth')
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)

  function handlePasswordBlur() {
    if (password && password.length < 8) {
      setPasswordError(t('passwordTooShort'))
    } else {
      setPasswordError(null)
    }
  }

  function handleConfirmBlur() {
    if (confirmPassword && password !== confirmPassword) {
      setConfirmError(t('passwordMismatch'))
    } else {
      setConfirmError(null)
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (password.length < 8) {
      setPasswordError(t('passwordTooShort'))
      return
    }
    if (password !== confirmPassword) {
      setConfirmError(t('passwordMismatch'))
      return
    }

    setLoading(true)

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    try {
      const { data, error } = await supabase.auth.signUp({ email, password })

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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-purple-50 to-pink-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 text-white text-2xl mb-5 shadow-lg shadow-violet-200 dark:shadow-violet-900/30">
            📧
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('checkEmailTitle')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">{t('checkEmailMessage')}</p>
          <Link
            href="/auth/login"
            className="inline-block py-2.5 px-6 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 transition-colors"
          >
            {t('goToLogin')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-purple-50 to-pink-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggleButton />
      </div>

      <div className="w-full max-w-md">
        {/* Logo + heading */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 text-white font-bold text-2xl mb-5 shadow-lg shadow-violet-200 dark:shadow-violet-900/30">
            A
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('signupTitle')}</h1>
          <p className="text-gray-500 dark:text-gray-400">{t('signupSubtitle')}</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-8">
          {formError && (
            <div className="mb-5 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg border border-red-100 dark:border-red-900/40">
              {formError}
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('emailLabel')}
              </label>
              <input
                type="email"
                id="email"
                name="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputCls}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('passwordLabel')}
              </label>
              <input
                type="password"
                id="password"
                name="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={handlePasswordBlur}
                placeholder="••••••••"
                className={inputCls}
              />
              {passwordError
                ? <p className="text-xs text-red-600 dark:text-red-400">{passwordError}</p>
                : <p className="text-xs text-gray-400 dark:text-gray-500">{t('passwordTooShort')}</p>
              }
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('confirmPasswordLabel')}
              </label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={handleConfirmBlur}
                placeholder="••••••••"
                className={inputCls}
              />
              {confirmError && (
                <p className="text-xs text-red-600 dark:text-red-400">{confirmError}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 active:bg-violet-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? t('signingUp') : t('signupBtn')}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
            {t('hasAccount')}{' '}
            <Link href="/auth/login" className="text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 font-medium transition-colors">
              {t('loginLink')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
