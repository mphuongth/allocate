import type { MonthlyPlan, InsuranceMember } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  insuranceMembers: InsuranceMember[]
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

export default function InsuranceSection({ insuranceMembers }: Props) {
  if (insuranceMembers.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Insurance</h2>
        </div>
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">No insurance members configured</div>
      </div>
    )
  }

  const totalMonthly = insuranceMembers.reduce((sum, m) => sum + Math.round(m.annual_payment_vnd / 12), 0)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Insurance</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Monthly premiums (annual ÷ 12) across all members.</p>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            {['Member', 'Relationship', 'Monthly Premium'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {insuranceMembers.map((m) => (
            <tr key={m.member_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{m.member_name}</td>
              <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{m.relationship}</td>
              <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{fmt(Math.round(m.annual_payment_vnd / 12))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Total Monthly</td>
            <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{fmt(totalMonthly)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
