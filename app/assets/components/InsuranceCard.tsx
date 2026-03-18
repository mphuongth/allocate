const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

interface Props {
  insuranceId: string
  insuranceName: string
  coverageType: string | null
  annualPremium: number
  amountSaved: number
  savingsProgressPercentage: number
  status: 'on_track' | 'upcoming' | 'overdue' | 'completed'
  nextPaymentDate: string | null
}

const statusConfig = {
  on_track: { label: 'On Track', className: 'bg-green-100 text-green-700' },
  upcoming: { label: 'Upcoming', className: 'bg-yellow-100 text-yellow-700' },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-700' },
  completed: { label: 'Completed', className: 'bg-gray-100 text-gray-500' },
}

export default function InsuranceCard({
  insuranceName, coverageType, annualPremium, amountSaved,
  savingsProgressPercentage, status, nextPaymentDate,
}: Props) {
  const cfg = statusConfig[status]
  const isCompleted = status === 'completed'
  const progress = Math.min(savingsProgressPercentage, 100)

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-5 ${isCompleted ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between mb-1">
        <h3 className="font-semibold text-gray-900 text-sm">{insuranceName}</h3>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.className}`}>{cfg.label}</span>
      </div>

      {coverageType && (
        <p className="text-xs text-gray-400 mb-3">{coverageType}</p>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
        <div>
          <p className="text-gray-400 mb-0.5">Annual Premium</p>
          <p className="font-medium text-gray-800">{fmt(annualPremium)}</p>
        </div>
        <div>
          <p className="text-gray-400 mb-0.5">Amount Saved</p>
          <p className="font-medium text-gray-800">{fmt(amountSaved)}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
          <span>Savings Progress</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${isCompleted ? 'bg-gray-400' : 'bg-indigo-500'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {nextPaymentDate && !isCompleted && (
        <p className="text-xs text-gray-400 mt-2">
          Next payment: {new Date(nextPaymentDate).toLocaleDateString('vi-VN')}
        </p>
      )}
    </div>
  )
}
