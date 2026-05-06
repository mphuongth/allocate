import type { Metadata, Viewport } from 'next'
import { DM_Sans, Geist } from 'next/font/google'
import { Toaster } from 'sonner'
import ThemeProvider from './components/ThemeProvider'
import ServiceWorkerRegistration from './components/ServiceWorkerRegistration'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getLocale } from 'next-intl/server'
import './globals.css'
import { cn } from "@/lib/utils";

const dmSans = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-dm-sans',
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

export const metadata: Metadata = {
  title: { template: '%s | Cairn', default: 'Cairn' },
  description: 'Personal finance, one stone at a time. Plan, track, and grow toward every goal.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Cairn' },
  icons: {
    icon: [
      { url: '/favicon-32.png?v=2', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png?v=2',   sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png?v=2', sizes: '180x180', type: 'image/png' }],
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const messages = await getMessages()
  const locale = await getLocale()

  return (
    <html lang={locale} suppressHydrationWarning className={cn("font-sans", dmSans.variable, geist.variable)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}` }} />
      </head>
      <body className={`${dmSans.variable} font-sans antialiased bg-canvas dark:bg-gray-950 text-gray-900 dark:text-gray-100`}>
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
