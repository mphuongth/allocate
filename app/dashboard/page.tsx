import AuthenticatedLayout from '@/app/components/layouts/AuthenticatedLayout'

export default function DashboardPage() {
  return (
    <AuthenticatedLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Assets Dashboard</h1>
        <p className="text-gray-500">Your financial overview will appear here.</p>
      </div>
    </AuthenticatedLayout>
  )
}
