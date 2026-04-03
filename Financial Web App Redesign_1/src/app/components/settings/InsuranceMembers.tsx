import { Plus, Edit, Trash2 } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

// Mock data
const members = [
  { 
    id: 1,
    member: 'Trùng',
    relationship: 'Child',
    annualFee: 19855000,
    monthlyFee: 1662917,
    paymentDate: '31/5/2026'
  },
  { 
    id: 2,
    member: 'Minh',
    relationship: 'Husband',
    annualFee: 27840000,
    monthlyFee: 2320000,
    paymentDate: '15/12/2026'
  },
  { 
    id: 3,
    member: 'Phương',
    relationship: 'Self',
    annualFee: 23580000,
    monthlyFee: 1965000,
    paymentDate: '27/12/2026'
  },
];

const relationshipColors: Record<string, string> = {
  'Self': 'bg-violet-100 text-violet-700',
  'Husband': 'bg-blue-100 text-blue-700',
  'Child': 'bg-green-100 text-green-700',
};

export function InsuranceMembers() {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('vi-VN').format(value);
  };

  const totalAnnual = members.reduce((sum, m) => sum + m.annualFee, 0);
  const totalMonthly = members.reduce((sum, m) => sum + m.monthlyFee, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Insurance Members</h2>
          <p className="text-sm text-gray-500 mt-1">
            Total: ₫ {formatNumber(totalAnnual)} / year • ₫ {formatNumber(totalMonthly)} / month
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Add Member
        </Button>
      </div>

      {/* Members Table */}
      <Card className="p-6">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[180px]">Member</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[140px]">Relationship</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[140px]">Annual Fee</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[140px]">Monthly Fee</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[120px]">Payment Date</th>
                <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-center w-[120px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50">
                  <td className="py-4 pr-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-white font-semibold flex-shrink-0">
                        {member.member.charAt(0)}
                      </div>
                      <span className="font-medium text-gray-900 truncate">{member.member}</span>
                    </div>
                  </td>
                  <td className="py-4 pr-4">
                    <Badge className={`${relationshipColors[member.relationship] || 'bg-gray-100 text-gray-700'} whitespace-nowrap`}>
                      {member.relationship}
                    </Badge>
                  </td>
                  <td className="py-4 pr-4 text-right font-medium text-gray-900">
                    ₫ {formatNumber(member.annualFee)}
                  </td>
                  <td className="py-4 pr-4 text-right">
                    <span className="font-semibold text-violet-600">₫ {formatNumber(member.monthlyFee)}</span>
                  </td>
                  <td className="py-4 pr-4 text-sm text-gray-600">{member.paymentDate}</td>
                  <td className="py-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                        <Edit className="h-4 w-4 text-blue-600" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Info Card */}
      <Card className="p-6 bg-green-50 border-green-200">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white flex-shrink-0">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-green-900 mb-1">About Insurance</h4>
            <p className="text-sm text-green-800">
              Monthly fees (annual / 12) are automatically added to your Monthly Plan. You can override or skip for any specific month.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
