import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, isAppLocale } from '@/lib/locale'

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const locale = cookieStore.get('locale')?.value
  // One allowlist for every locale that arrives from outside — this cookie and
  // the PDF report route's body both go through it (lib/locale).
  const validLocale = isAppLocale(locale) ? locale : DEFAULT_LOCALE

  return {
    locale: validLocale,
    messages: (await import(`../messages/${validLocale}.json`)).default,
  }
})
