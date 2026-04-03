import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getTranslations } from 'next-intl/server'
import ThemeToggleButton from './components/ThemeToggleButton'
import LanguageSwitcher from './components/LanguageSwitcher'
import { TrendingUp, PieChart, Target, Shield, Clock, BarChart3 } from 'lucide-react'

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  const t = await getTranslations('landing')

  const FEATURES = [
    { Icon: PieChart, title: t('benefit1Title'), description: t('benefit1Desc') },
    { Icon: Target, title: t('benefit2Title'), description: t('benefit2Desc') },
    { Icon: TrendingUp, title: t('benefit3Title'), description: t('benefit3Desc') },
    { Icon: BarChart3, title: t('benefit4Title'), description: t('benefit4Desc') },
    { Icon: Clock, title: t('benefit5Title'), description: t('benefit5Desc') },
    { Icon: Shield, title: t('benefit6Title'), description: t('benefit6Desc') },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-pink-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Header */}
      <header className="border-b border-black/5 dark:border-white/5 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
                A
              </div>
              <span className="text-xl font-bold text-gray-900 dark:text-gray-100">Allocate</span>
            </div>
            <div className="flex items-center gap-3">
              <LanguageSwitcher />
              <ThemeToggleButton />
              <Link
                href="/auth/login"
                className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors px-3 py-2"
              >
                {t('loginLink')}
              </Link>
              <Link
                href="/auth/signup"
                className="text-sm font-medium px-4 py-2 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors"
              >
                {t('signupLink')}
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32">
        <div className="text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
              {t('heroTitle')}{' '}
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                {t('heroTitleGradient')}
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
              {t('heroSubtitle')}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/signup"
              className="px-8 py-4 bg-violet-600 text-white text-lg font-semibold rounded-lg hover:bg-violet-700 transition-colors shadow-sm"
            >
              {t('heroSignupBtn')}
            </Link>
            <Link
              href="/auth/login"
              className="px-8 py-4 border-2 border-violet-600 text-violet-700 dark:text-violet-400 text-lg font-semibold rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
            >
              {t('heroLoginBtn')}
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">{t('whyTitle')}</h2>
          <p className="text-xl text-gray-600 dark:text-gray-400">{t('featuresSub')}</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border-2 border-transparent hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-lg transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 shrink-0">
                  <feature.Icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{feature.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{feature.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="bg-gradient-to-br from-violet-600 to-purple-600 rounded-2xl p-12 md:p-16 text-center">
          <h2 className="text-4xl font-bold text-white mb-4">{t('ctaTitle')}</h2>
          <p className="text-xl text-violet-100 mb-8 max-w-2xl mx-auto">{t('ctaSub')}</p>
          <Link
            href="/auth/signup"
            className="inline-block px-8 py-4 bg-white text-violet-600 text-lg font-semibold rounded-lg hover:bg-gray-100 transition-colors"
          >
            {t('ctaBtn')}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/5 dark:border-white/5 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center text-white font-bold text-xs">
                A
              </div>
              <span className="text-lg font-bold text-gray-900 dark:text-gray-100">Allocate</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">© 2026 Allocate. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
