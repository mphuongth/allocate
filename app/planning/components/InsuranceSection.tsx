import type { MonthlyPlan, InsuranceMember } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  insuranceMembers: InsuranceMember[]
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

export default function InsuranceSection({ insuranceMembers }: Props) {
  if (insuranceMembers.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Insurance</h2>
        </div>
        <div className="text-center py-10 text-gray-400 text-sm">No insurance members configured</div>
      </div>
    )
  }

  const totalMonthly = insuranceMembers.reduce((sum, m) => sum + Math.round(m.annual_payment_vnd / 12), 0)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">Insurance</h2>
        <p className="text-xs text-gray-400 mt-0.5">Monthly premiums (annual ÷ 12) across all members.</p>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {['Member', 'Relationship', 'Monthly Premium'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {insuranceMembers.map((m) => (
            <tr key={m.member_id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">{m.member_name}</td>
              <td className="px-4 py-3 text-gray-500">{m.relationship}</td>
              <td className="px-4 py-3 text-gray-700">{fmt(Math.round(m.annual_payment_vnd / 12))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 bg-gray-50">
            <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-gray-700">Total Monthly</td>
            <td className="px-4 py-3 text-sm font-semibold text-gray-900">{fmt(totalMonthly)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
