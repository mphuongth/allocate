export function NetWorthSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-4" />
      <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-48 mb-6" />
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-2" />
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-28" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function GoalSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
      </div>
      <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-40 mb-3" />
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full w-full" />
    </div>
  )
}

export function InsuranceSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-28" />
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-16" />
      </div>
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-4" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full w-full mt-3" />
    </div>
  )
}
