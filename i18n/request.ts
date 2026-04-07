import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const locale = cookieStore.get('locale')?.value ?? 'vi'
  const validLocale = ['vi', 'en'].includes(locale) ? locale : 'vi'

  return {
    locale: validLocale,
    messages: (await import(`../messages/${validLocale}.json`)).default,
  }
})
