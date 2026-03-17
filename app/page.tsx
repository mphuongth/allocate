import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

async function logout() {
  'use server'
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/auth/login')
}

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()

  const { data: healthData, error: healthError } = await supabase
    .from('health_check')
    .select('*')
    .limit(1)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const dbStatus =
    healthError || !healthData
      ? `✗ Database error: ${healthError?.message ?? 'No data'}`
      : '✓ Database connected'

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-20 py-20">
      <div className="w-full max-w-2xl space-y-8">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">
          Welcome to Allocate
        </h1>

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-700">System Status</h2>

          <div className="space-y-3">
            <StatusRow label="Framework" value="Next.js 16 running" ok />

            <StatusRow
              label="Database"
              value={dbStatus}
              ok={!healthError && !!healthData}
            />

            <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <span className="text-sm font-medium text-gray-600">Authentication</span>
              <div className="flex items-center gap-3">
                {user ? (
                  <>
                    <span className="text-sm text-gray-800">
                      Logged in as: <strong>{user.email}</strong>
                    </span>
                    <form action={logout}>
                      <button
                        type="submit"
                        className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                      >
                        Logout
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-gray-500">Not logged in</span>
                    <a
                      href="/auth/login"
                      className="text-sm px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
                    >
                      Login
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

function StatusRow({
  label,
  value,
  ok,
}: {
  label: string
  value: string
  ok: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm font-medium text-gray-600">{label}</span>
      <span className={`text-sm ${ok ? 'text-green-600' : 'text-red-600'}`}>
        {value}
      </span>
    </div>
  )
}
