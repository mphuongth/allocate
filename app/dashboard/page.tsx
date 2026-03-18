import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

async function logout() {
  'use server'
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/auth/login')
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-20 py-20">
      <div className="w-full max-w-2xl space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900">Dashboard</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{user.email}</span>
            <form action={logout}>
              <button
                type="submit"
                className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
              >
                Log out
              </button>
            </form>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
            Navigation
          </h2>
          <a
            href="/funds"
            className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            📚 Fund Library
          </a>
          <a
            href="/assets"
            className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            📊 Assets Dashboard
          </a>
          <a
            href="/planning"
            className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            📅 Monthly Planning
          </a>
          <a
            href="/settings"
            className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            ⚙️ Settings
          </a>
        </div>
      </div>
    </main>
  )
}
