'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

// "Updated {time} ago" line shown under a fund's NAV. The relative bucket is
// computed ONCE per `isoStr`, inside an effect — never during render — so:
//   • Date.now() is read after paint, satisfying react-hooks/purity (the old
//     relDate() called it in the render body → lint error + non-deterministic).
//   • the label stays steady across parent re-renders: previously every render
//     recomputed the bucket with a newer Date.now(), so the "Updated Xm ago"
//     line drifted even though updated_at was unchanged.
// `isoStr` is required (callers gate on `fund.updated_at` before rendering).
// Translation (t) is applied in render from the stored bucket, so the effect's
// only dependency is `isoStr` — `t`'s identity is NOT in the dep list (next-intl
// and the test mock both return a fresh function per render, which would otherwise
// re-run the effect on every parent re-render and re-read Date.now()).
type Bucket =
  | { kind: 'justNow' }
  | { kind: 'min'; m: number }
  | { kind: 'hour'; h: number }
  | { kind: 'day'; d: number }

export function FundNavAge({ isoStr, style }: { isoStr: string; style?: React.CSSProperties }) {
  const t = useTranslations('funds')
  const [bucket, setBucket] = useState<Bucket | null>(null)
  useEffect(() => {
    const diff = Date.now() - new Date(isoStr).getTime()
    const mins = Math.floor(diff / 60000)
    let next: Bucket
    if (mins < 1) next = { kind: 'justNow' }
    else if (mins < 60) next = { kind: 'min', m: mins }
    else {
      const h = Math.floor(mins / 60)
      next = h < 24 ? { kind: 'hour', h } : { kind: 'day', d: Math.floor(h / 24) }
    }
    /* Canonical "subscribe to an external system" effect (React docs):
       the relative-age bucket is derived from Date.now() (an external mutable
       value) and written to state once per `isoStr` change, memoizing the label
       so it stays steady across parent re-renders (the drift bug this fixes).
       The rule's heuristic can't distinguish this from the cascading-render
       anti-pattern, so it's suppressed here only — unlike the mounted-animation
       cases elsewhere, there is no CSS-only refactor for "current time". */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see block comment above
    setBucket(next)
  }, [isoStr])
  if (!bucket) return null
  // Translation is applied in render from the stored bucket (so `t`'s changing
  // identity isn't an effect dependency); `format` is inlined here rather than
  // typed separately to keep next-intl's Translator type inferred.
  const time =
    bucket.kind === 'justNow' ? t('relJustNow')
      : bucket.kind === 'min' ? t('relMinutes', { m: bucket.m })
        : bucket.kind === 'hour' ? t('relHours', { h: bucket.h })
          : t('relDays', { d: bucket.d })
  return <div style={style}>{t('updatedAgo', { time })}</div>
}

