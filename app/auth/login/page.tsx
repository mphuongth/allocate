'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, Suspense } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useTranslations } from 'next-intl'
import ThemeToggleButton from '@/app/components/ThemeToggleButton'

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
        // keep loading=true — page will unmount on redirect
      }
    } catch {
      setError(t('cannotConnect'))
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      {/* Logo + heading */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 text-white font-bold text-2xl mb-5 shadow-lg shadow-violet-200 dark:shadow-violet-900/30">
          A
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('loginTitle')}</h1>
        <p className="text-gray-500 dark:text-gray-400">{t('loginSubtitle')}</p>
      </div>

      {/* Card */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-8">
        {error && (
          <div className="mb-5 px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg border border-red-100 dark:border-red-900/40">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
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
              className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('passwordLabel')}
              </label>
              <span className="text-sm text-gray-400 dark:text-gray-500 cursor-not-allowed select-none">
                {t('forgotPassword')}
              </span>
            </div>
            <input
              type="password"
              id="password"
              name="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading || redirecting}
            className="w-full py-2.5 px-4 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 active:bg-violet-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {redirecting ? t('redirecting') : loading ? t('loggingIn') : t('loginBtn')}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
          {t('noAccount')}{' '}
          <Link href="/auth/signup" className="text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 font-medium transition-colors">
            {t('signupLink')}
          </Link>
        </p>
      </div>

    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-purple-50 to-pink-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggleButton />
      </div>
      <Suspense fallback={<div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-8 animate-pulse h-96" />}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
