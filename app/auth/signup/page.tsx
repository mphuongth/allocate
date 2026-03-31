'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useTranslations } from 'next-intl'
import ThemeToggleButton from '@/app/components/ThemeToggleButton'

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-lg shadow p-8 text-center border border-transparent dark:border-gray-700">
          <div className="text-4xl mb-4">📧</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">{t('checkEmailTitle')}</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">{t('checkEmailMessage')}</p>
          <Link
            href="/auth/login"
            className="inline-block py-2 px-6 bg-indigo-600 text-white rounded-md font-medium hover:bg-indigo-700 transition-colors"
          >
            {t('goToLogin')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggleButton />
      </div>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-lg shadow p-8 border border-transparent dark:border-gray-700">
        <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100 mb-6">{t('signupTitle')}</h1>
        {formError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-md">{formError}</div>
        )}
        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('emailLabel')}
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
              className={inputCls}
              placeholder="••••••••"
            />
            {passwordError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{passwordError}</p>
            )}
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
              className={inputCls}
              placeholder="••••••••"
            />
            {confirmError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{confirmError}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-indigo-600 text-white rounded-md font-medium hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? t('signingUp') : t('signupBtn')}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
          {t('hasAccount')}{' '}
          <Link href="/auth/login" className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
            {t('loginLink')}
          </Link>
        </p>
      </div>
    </div>
  )
}
