import type { Metadata, Viewport } from 'next'
import { Be_Vietnam_Pro, Geist } from 'next/font/google'
import { Toaster } from 'sonner'
import ThemeProvider from '@/components/layout/ThemeProvider'
import ServiceWorkerRegistration from '@/components/layout/ServiceWorkerRegistration'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getLocale, getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { buildSiteMetadata, buildStructuredData } from '@/lib/seo'
import './globals.css'
import { cn } from "@/lib/utils";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  variable: '--font-be-vietnam',
  weight: ['400', '500', '600', '700'],
})

const geist = Geist({subsets:['latin'],variable:'--font-geist'});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)',  color: '#0F2A4A' },
  ],
}

// Localized, because this is the one page crawlers and link scrapers can actually read and
// the site defaults to Vietnamese. The shape lives in lib/seo.ts so it can be unit-tested
// without booting Next; see lib/__tests__/seo.test.ts.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const t = await getTranslations('meta')
  return buildSiteMetadata(locale, t)
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const messages = await getMessages()
  const locale = await getLocale()
  // Per-request CSP nonce set by middleware; undefined in dev (no CSP there), in
  // which case React omits the attribute and the inline script runs unrestricted.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  const tMeta = await getTranslations('meta')
  // Escaped rather than interpolated raw: a `<` in the payload can terminate the <script>
  // element early, and the strings come from a translation catalogue. Carries the nonce
  // like the theme script above — browsers do not execute a JSON-LD data block, but the
  // CSP applies to the element and there is no reason to make it an exception.
  const structuredData = JSON.stringify(buildStructuredData(locale, tMeta)).replace(/</g, '\\u003c')

  return (
    <html lang={locale} suppressHydrationWarning className={cn("font-sans", beVietnamPro.variable, geist.variable)}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}` }} />
        <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: structuredData }} />
      </head>
      <body className={`${beVietnamPro.variable} font-sans antialiased bg-canvas dark:bg-gray-950 text-gray-900 dark:text-gray-100`}>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <Toaster position="top-right" richColors />
            <ServiceWorkerRegistration />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
