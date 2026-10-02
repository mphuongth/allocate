'use client'

import { useTranslations } from 'next-intl'
import { Landmark } from 'lucide-react'
import { DEFAULT_RENEW_MIN_RATE_PCT } from '@/lib/renewThreshold'
import PercentSettingCard from './PercentSettingCard'

// The renew-or-move threshold for maturing term deposits. When a deposit
// matures the user enters today's 12-month rate; at or above this the maturity
// sheet suggests renewing principal + interest, below it suggests moving the
// money into the deposit's target fund. An empty field is "not chosen" and
// DEFAULT_RENEW_MIN_RATE_PCT applies — see PercentSettingCard.

export default function RenewThresholdCard() {
  const t = useTranslations('settings')
  return (
    <PercentSettingCard
      field="renew_min_rate_pct"
      inputId="renew-min-rate"
      Icon={Landmark}
      label={t('renewThresholdRate')}
      unit={t('inflationUnit')}
      defaultPct={DEFAULT_RENEW_MIN_RATE_PCT}
      saveLabel={t('renewThresholdSave')}
      saveFailed={t('renewThresholdSaveFailed')}
      rangeError={t('inflationRangeError')}
      hint={`${t('renewThresholdHint')} ${t('renewThresholdDefaultNote', { pct: DEFAULT_RENEW_MIN_RATE_PCT })}`}
      hintTestId="renew-threshold-hint"
    />
  )
}
