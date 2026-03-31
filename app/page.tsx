import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTranslations } from 'next-intl/server'
import ThemeToggleButton from './components/ThemeToggleButton'

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  const t = await getTranslations('landing')

  const BENEFITS = [
    { icon: '📊', title: t('benefit1Title'), description: t('benefit1Desc') },
    { icon: '💰', title: t('benefit2Title'), description: t('benefit2Desc') },
    { icon: '📈', title: t('benefit3Title'), description: t('benefit3Desc') },
    { icon: '🛡️', title: t('benefit4Title'), description: t('benefit4Desc') },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-2xl font-bold text-indigo-700 dark:text-indigo-400 tracking-tight">Allocate</span>
          <nav className="flex items-center gap-4">
            <ThemeToggleButton />
            <Link
              href="/auth/login"
              className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-indigo-700 dark:hover:text-indigo-400 transition-colors"
            >
              {t('loginLink')}
            </Link>
            <Link
              href="/auth/signup"
              className="text-sm font-medium px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
            >
              {t('signupLink')}
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="py-24 px-6 text-center">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight mb-6">
              {t('heroTitle')}
            </h1>
            <p className="text-lg text-gray-600 mb-10 max-w-xl mx-auto leading-relaxed">
              {t('heroSubtitle')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/auth/signup"
                className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
              >
                {t('heroSignupBtn')}
              </Link>
              <Link
                href="/auth/login"
                className="px-6 py-3 border-2 border-indigo-600 text-indigo-700 font-semibold rounded-lg hover:bg-indigo-50 transition-colors"
              >
                {t('heroLoginBtn')}
              </Link>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-20 px-6 bg-gray-50 dark:bg-gray-900">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-14">{t('whyTitle')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {BENEFITS.map((b) => (
                <div
                  key={b.title}
                  className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center text-2xl mb-4">
                    {b.icon}
                  </div>
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{b.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{b.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 px-6 text-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">© 2026 Allocate. All rights reserved.</p>
      </footer>
    </div>
  )
}
