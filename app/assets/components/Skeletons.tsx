import { Skeleton } from '@/app/components/ui/Skeleton'

/** Card chrome matching the real dashboard cards (GoalCard / NetWorthCard). */
const cardStyle: React.CSSProperties = {
  background: 'var(--c-card)',
  border: '1px solid var(--c-line)',
  borderRadius: 'var(--r-card)',
  boxShadow: 'var(--shadow-card)',
  padding: 20,
}

export function NetWorthSkeleton() {
  return (
    <div style={cardStyle} data-testid="net-worth-skeleton">
      <Skeleton width={96} height={16} className="mb-4" />
      <Skeleton width={192} height={40} className="mb-6" />
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <Skeleton width={80} height={12} className="mb-2" />
            <Skeleton width={112} height={20} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function GoalSkeleton() {
  return (
    <div style={{ ...cardStyle, padding: 20 }} data-testid="goal-skeleton">
      <div className="flex items-center justify-between mb-3">
        <Skeleton width={128} height={16} />
        <Skeleton width={64} height={16} />
      </div>
      <Skeleton width={160} height={24} className="mb-3" />
      <Skeleton width="100%" height={8} round />
    </div>
  )
}

export function InsuranceSkeleton() {
  return (
    <div style={cardStyle} data-testid="insurance-skeleton">
      <div className="flex items-center justify-between mb-3">
        <Skeleton width={112} height={16} />
        <Skeleton width={64} height={20} />
      </div>
      <Skeleton width={96} height={12} className="mb-4" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton height={16} />
        <Skeleton height={16} />
      </div>
      <Skeleton width="100%" height={8} round className="mt-3" />
    </div>
  )
}
