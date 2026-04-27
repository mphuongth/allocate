import FundLibraryClient from './FundLibraryClient'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('funds') }
}

export default function FundsPage() {
  return <FundLibraryClient />
}
