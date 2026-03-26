'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, Suspense } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import ThemeToggleButton from '@/app/components/ThemeToggleButton'

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const expired = searchParams.get('expired') === 'true'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(expired ? 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.' : null)
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
        setError('Email hoặc mật khẩu không đúng.')
        setLoading(false)
      } else {
        setRedirecting(true)
        router.push('/dashboard')
        router.refresh()
        // keep loading=true — page will unmount on redirect
      }
    } catch {
      setError('Không thể kết nối. Vui lòng kiểm tra internet và thử lại.')
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-lg shadow p-8 border border-transparent dark:border-gray-700">
      <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-gray-100 mb-6">Đăng nhập vào Allocate</h1>
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-md">{error}</div>
      )}
      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Email
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
            Mật khẩu
          </label>
          <input
            type="password"
            id="password"
            name="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
            placeholder="••••••••"
          />
        </div>
        <div className="text-right">
          <span className="text-sm text-gray-400 dark:text-gray-500 cursor-not-allowed">Quên mật khẩu?</span>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 bg-indigo-600 text-white rounded-md font-medium hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {redirecting ? 'Đang chuyển trang…' : loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
        Chưa có tài khoản?{' '}
        <Link href="/auth/signup" className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
          Đăng ký
        </Link>
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggleButton />
      </div>
      <Suspense fallback={<div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-lg shadow p-8 animate-pulse h-80" />}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
