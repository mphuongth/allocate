'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useTranslations } from 'next-intl'
import ThemeToggleButton from '@/app/components/ThemeToggleButton'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

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
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-pink-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 text-2xl mb-4 shadow-lg shadow-violet-200 dark:shadow-violet-900/30">
            📧
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">{t('checkEmailTitle')}</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm mb-8">{t('checkEmailMessage')}</p>
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
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-pink-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggleButton />
      </div>

      <div className="w-full max-w-md">
        {/* Logo + heading */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 text-white font-bold text-2xl mb-4 shadow-lg shadow-violet-200 dark:shadow-violet-900/30">
            A
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('signupTitle')}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t('signupSubtitle')}</p>
        </div>

        {/* Card */}
        <Card className="p-8">
          {formError && (
            <div className="mb-5 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg border border-red-100 dark:border-red-900/40">
              {formError}
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">{t('emailLabel')} <span className="text-red-500">*</span></Label>
              <Input
                id="email"
                type="email"
                name="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('passwordLabel')} <span className="text-red-500">*</span></Label>
              <Input
                id="password"
                type="password"
                name="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={handlePasswordBlur}
                placeholder="••••••••"
              />
              {passwordError
                ? <p className="text-sm text-red-600 dark:text-red-400">{passwordError}</p>
                : <p className="text-xs text-gray-500 dark:text-gray-400">{t('passwordTooShort')}</p>
              }
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('confirmPasswordLabel')} <span className="text-red-500">*</span></Label>
              <Input
                id="confirmPassword"
                type="password"
                name="confirmPassword"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={handleConfirmBlur}
                placeholder="••••••••"
              />
              {confirmError && (
                <p className="text-sm text-red-600 dark:text-red-400">{confirmError}</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-700 text-white dark:text-white"
              size="lg"
            >
              {loading ? t('signingUp') : t('signupBtn')}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            <span className="text-gray-600 dark:text-gray-400">{t('hasAccount')} </span>
            <Link href="/auth/login" className="text-violet-600 dark:text-violet-400 hover:text-violet-700 font-medium">
              {t('loginLink')}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
