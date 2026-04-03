import { ArrowLeft, Plus, Edit, Trash2, TrendingUp } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';

interface GoalDetailProps {
  goalId: string;
  onBack: () => void;
}

// Mock goal data
const goalData = {
  '5': {
    name: 'Đường già',
    current: 80639799,
    invested: 79509727,
    gain: 1130072,
    fundInvestments: [
      {
        id: 1,
        date: '5/3/2026',
        fund: 'VCBF-FIF - Quỹ VCBF-FIF',
        amount: 3000000,
        units: 192.04,
        navAtPurchase: 15621,
        currentNav: 15645,
        currentValue: 3004965,
        gain: 4965
      },
      {
        id: 2,
        date: '4/3/2026',
        fund: 'VCBF-TBF - Quỹ VCBF-TBF',
        amount: 7000000,
        units: 175.53,
        navAtPurchase: 39877,
        currentNav: 37557,
        currentValue: 6592424,
        gain: -407576
      }
    ],
    savings: [
      {
        id: 1,
        date: '31/1/2026',
        type: 'Vàng',
        amount: 17150000,
        units: 1,
        interestRate: null,
        gain: 40000,
        notes: ''
      },
      {
        id: 2,
        date: '18/8/2025',
        type: 'Ngân hàng',
        amount: 52359727,
        units: null,
        interestRate: 5.45,
        gain: 1492683,
        notes: 'Eximbank'
      }
    ]
  }
};

export function GoalDetail({ goalId, onBack }: GoalDetailProps) {
  const goal = goalData[goalId as keyof typeof goalData];

  if (!goal) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Goal not found</p>
        <Button onClick={onBack} className="mt-4">Go Back</Button>
      </div>
    );
  }

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">{goal.name}</h1>
            <Button variant="ghost" size="sm">
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm">
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-6 bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200">
          <p className="text-sm text-blue-700 mb-2">CURRENT VALUE</p>
          <p className="text-3xl font-bold text-blue-900">
            ₫ {formatNumber(goal.current)}
          </p>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
          <p className="text-sm text-purple-700 mb-2">TOTAL INVESTED</p>
          <p className="text-3xl font-bold text-purple-900">
            ₫ {formatNumber(goal.invested)}
          </p>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <p className="text-sm text-green-700 mb-2">GAIN / LOSS</p>
          <p className={`text-3xl font-bold ${goal.gain >= 0 ? 'text-green-900' : 'text-red-900'}`}>
            ₫ {formatNumber(goal.gain)}
          </p>
        </Card>
      </div>

      {/* Transactions */}
      <Tabs defaultValue="funds">
        <TabsList>
          <TabsTrigger value="funds">Fund Investments</TabsTrigger>
          <TabsTrigger value="savings">Savings & Other</TabsTrigger>
        </TabsList>

        <TabsContent value="funds" className="mt-6">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Fund Investments</h3>
                <p className="text-sm text-gray-500">Tư Cài dát vă Kế hoạch Trùng</p>
              </div>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Thêm Đầu tư Quỹ
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase">Fund</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Amount</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Units</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">NAV at Purchase</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Current NAV</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Current Value</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Gain/Loss</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {goal.fundInvestments.map((investment) => (
                    <tr key={investment.id} className="hover:bg-gray-50">
                      <td className="py-3 text-sm text-gray-600">{investment.date}</td>
                      <td className="py-3">
                        <p className="font-medium text-gray-900">{investment.fund}</p>
                      </td>
                      <td className="py-3 text-right font-medium text-gray-900">
                        ₫ {formatNumber(investment.amount)}
                      </td>
                      <td className="py-3 text-right text-sm text-gray-600">{investment.units}</td>
                      <td className="py-3 text-right text-sm text-gray-600">
                        ₫ {formatNumber(investment.navAtPurchase)}
                      </td>
                      <td className="py-3 text-right text-sm text-gray-600">
                        ₫ {formatNumber(investment.currentNav)}
                      </td>
                      <td className="py-3 text-right font-medium text-gray-900">
                        ₫ {formatNumber(investment.currentValue)}
                      </td>
                      <td className="py-3 text-right">
                        <span className={`font-medium ${investment.gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {investment.gain >= 0 ? '+' : ''}₫ {formatNumber(investment.gain)}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm">
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm">
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
        </TabsContent>

        <TabsContent value="savings" className="mt-6">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Savings & Other</h3>
                <p className="text-sm text-gray-500">Tiền tiết kiệm và gửi ngân hàng</p>
              </div>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Thêm Giao dịch
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Amount</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Units</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Interest Rate</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Gain/Loss</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase">Notes</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {goal.savings.map((saving) => (
                    <tr key={saving.id} className="hover:bg-gray-50">
                      <td className="py-3 text-sm text-gray-600">{saving.date}</td>
                      <td className="py-3">
                        <Badge className={
                          saving.type === 'Vàng' ? 'bg-amber-100 text-amber-700' : 
                          'bg-blue-100 text-blue-700'
                        }>
                          {saving.type}
                        </Badge>
                      </td>
                      <td className="py-3 text-right font-medium text-gray-900">
                        ₫ {formatNumber(saving.amount)}
                      </td>
                      <td className="py-3 text-right text-sm text-gray-600">
                        {saving.units || '—'}
                      </td>
                      <td className="py-3 text-right text-sm text-gray-600">
                        {saving.interestRate ? `${saving.interestRate}%` : '—'}
                      </td>
                      <td className="py-3 text-right">
                        <span className={`font-medium ${saving.gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {saving.gain >= 0 ? '+' : ''}₫ {formatNumber(saving.gain)}
                        </span>
                      </td>
                      <td className="py-3 text-sm text-gray-600">{saving.notes || '—'}</td>
                      <td className="py-3">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm">
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
