import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const BENEFITS = [
  {
    icon: '📊',
    title: 'Tự động Tính Phân bổ',
    description:
      'Tự động phân bổ lương tháng vào hóa đơn, bảo hiểm và đầu tư một cách thông minh.',
  },
  {
    icon: '💰',
    title: 'Theo dõi Tài sản Ròng',
    description:
      'Theo dõi tổng tài sản, nợ và tài sản ròng theo thời gian thực. Nắm bắt sức khỏe tài chính ngay lập tức.',
  },
  {
    icon: '📈',
    title: 'Lên Kế hoạch Đầu tư',
    description:
      'Quản lý và theo dõi các quỹ đầu tư. Biết chính xác bạn phân bổ bao nhiêu cho từng quỹ mỗi tháng.',
  },
  {
    icon: '🛡️',
    title: 'Quản lý Bảo hiểm',
    description:
      'Tập trung tất cả hợp đồng bảo hiểm vào một nơi. Theo dõi mức bảo hiểm và phí hàng tháng dễ dàng.',
  },
]

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-2xl font-bold text-indigo-700 tracking-tight">Allocate</span>
          <nav className="flex items-center gap-6">
            <Link
              href="/auth/login"
              className="text-sm font-medium text-gray-600 hover:text-indigo-700 transition-colors"
            >
              Đăng nhập
            </Link>
            <Link
              href="/auth/signup"
              className="text-sm font-medium px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
            >
              Đăng ký
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="py-24 px-6 text-center">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight mb-6">
              Tự động hóa Phân bổ Hàng tháng
            </h1>
            <p className="text-lg text-gray-600 mb-10 max-w-xl mx-auto leading-relaxed">
              Kiểm soát tài chính với kế hoạch phân bổ thông minh. Theo dõi đầu tư, quản lý bảo hiểm và tối ưu ngân sách hàng tháng.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/auth/signup"
                className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
              >
                Đăng ký
              </Link>
              <Link
                href="/auth/login"
                className="px-6 py-3 border-2 border-indigo-600 text-indigo-700 font-semibold rounded-lg hover:bg-indigo-50 transition-colors"
              >
                Đăng nhập
              </Link>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-20 px-6 bg-gray-50">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-14">Tại sao chọn Allocate?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {BENEFITS.map((b) => (
                <div
                  key={b.title}
                  className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="w-12 h-12 bg-indigo-50 rounded-lg flex items-center justify-center text-2xl mb-4">
                    {b.icon}
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{b.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{b.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8 px-6 text-center">
        <p className="text-sm text-gray-400">© 2026 Allocate. All rights reserved.</p>
      </footer>
    </div>
  )
}
