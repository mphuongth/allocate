'use client'

import { useTranslations } from 'next-intl'
import { TrendingUp } from 'lucide-react'
import { DEFAULT_INFLATION_RATE_PCT } from '@/lib/inflation'
import PercentSettingCard from './PercentSettingCard'

// The inflation assumption, and the only control for it.
//
// An empty field is "not chosen" (DEFAULT_INFLATION_RATE_PCT applies); a typed
// 0 is "assume no inflation" — see PercentSettingCard.
//
// The hint carries the published record because the honest question about this
// field is "how would I know what to put here". It also says the number is an
// assumption: CPI is measured per year after the fact, but a goal maturing in
// 2030 depends on years nobody has lived, so a year landing above or below is
// not a reason to come back and edit this.

export default function InflationRateCard() {
  const t = useTranslations('settings')
  return (
    <PercentSettingCard
      field="inflation_rate_pct"
      inputId="inflation-rate"
      Icon={TrendingUp}
      label={t('inflationRate')}
      unit={t('inflationUnit')}
      defaultPct={DEFAULT_INFLATION_RATE_PCT}
      saveLabel={t('inflationSave')}
      saveFailed={t('inflationSaveFailed')}
      rangeError={t('inflationRangeError')}
      hint={`${t('inflationHint')} ${t('inflationDefaultNote')}`}
      hintTestId="inflation-rate-hint"
    />
  )
}
