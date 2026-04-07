'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'

export default function LanguageSwitcher() {
  const locale = useLocale()
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function switchLocale(next: string) {
    document.cookie = `locale=${next};path=/;max-age=31536000;SameSite=Lax`
    startTransition(() => router.refresh())
  }

  return (
    <div className={`flex items-center gap-1 text-xs font-medium ${isPending ? 'opacity-50' : ''}`}>
      <button
        onClick={() => switchLocale('en')}
        className={`px-1.5 py-0.5 rounded transition-colors ${
          locale === 'en'
            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
            : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
        }`}
      >
        EN
      </button>
      <span className="text-gray-300 dark:text-gray-600">|</span>
      <button
        onClick={() => switchLocale('vi')}
        className={`px-1.5 py-0.5 rounded transition-colors ${
          locale === 'vi'
            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
            : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
        }`}
      >
        VI
      </button>
    </div>
  )
}
