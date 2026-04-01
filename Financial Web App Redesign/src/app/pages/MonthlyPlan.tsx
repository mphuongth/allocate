import { useState } from 'react';
import { Plus, Edit, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';

// Mock data
const currentMonth = 'March 2026';

const monthlyData = {
  salary: 63709000,
  fundInvestments: [
    { id: 1, fund: 'Quỹ VFF', date: '2026-03-05', amount: 600000, units: 23.24, goal: 'Đại học của Trùng' },
    { id: 2, fund: 'Quỹ VCBF-TBF', date: '2026-03-04', amount: 7000000, units: 175.53, goal: 'Đường già' },
    { id: 3, fund: 'Quỹ VCBF-FIF', date: '2026-03-05', amount: 3000000, units: 192.04, goal: 'Đường già' },
    { id: 4, fund: 'Quỹ VIBF', date: '2026-03-04', amount: 1400000, units: 68.96, goal: 'Đại học của Trùng' },
    { id: 5, fund: 'Quỹ VESAF', date: '2026-03-04', amount: 1000000, units: 28.86, goal: 'Unassigned' },
  ],
  directSavings: [
    { id: 1, date: '3/3/2026', amount: 12000000, interestRate: 5.6, expiryDate: '3/9/2026', goal: 'Khẩn cấp' },
  ],
  fixedExpenses: [
    { id: 1, name: 'Tiền đưa ba mẹ 2 bên', category: 'Parents', default: 7000000, thisMonth: 7000000 },
    { id: 2, name: 'Tiền điện nước mạng', category: 'Housing', default: 2000000, thisMonth: 1833389 },
  ],
  insurance: [
    { id: 1, member: 'Phương', relationship: 'Self', default: 1965000, thisMonth: 1965000 },
    { id: 2, member: 'Minh', relationship: 'Husband', default: 2320000, thisMonth: 2320000 },
    { id: 3, member: 'Trùng', relationship: 'Child', default: 1662917, thisMonth: 1662917 },
  ],
  otherExpenses: [
    { id: 1, description: 'Tập gym', amount: 3100000 },
  ],
};

const allocationSummary = {
  living: 181700000,
  goals: {
    'Đại học của Trùng': { amount: 2000000, percent: 3 },
    'Đường già': { amount: 10000000, percent: 16 },
    'Khẩn cấp': { amount: 12000000, percent: 19 },
    'Unassigned': { amount: 4000000, percent: 6 },
  },
  fixedExpenses: { amount: 6833389, percent: 14 },
  insurance: { amount: 5947917, percent: 9 },
  otherExpenses: { amount: 3100000, percent: 9 },
  totalAllocated: 45881306,
  remainingSalary: 17827694,
  remainingPercent: 28,
};

export function MonthlyPlan() {
  const [salary, setSalary] = useState(monthlyData.salary.toString());

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
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-semibold text-gray-900">{currentMonth}</h2>
          <Button variant="outline" size="icon">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Input Forms */}
        <div className="lg:col-span-2 space-y-6">
          {/* Monthly Salary */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <label className="text-sm font-medium text-gray-900">Monthly Salary (VND)</label>
              <Button variant="destructive" size="sm">Delete</Button>
            </div>
            <Input
              type="number"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              className="text-lg font-medium"
            />
          </Card>

          {/* Fund Investments */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Fund Investments</h3>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Fund Investment
              </Button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[140px]">Fund</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[110px]">Date</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[110px]">Amount</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[80px]">Units</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[180px]">Goal</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-center w-[100px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {monthlyData.fundInvestments.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="py-3 pr-4 font-medium text-gray-900 truncate">{item.fund}</td>
                      <td className="py-3 pr-4 text-sm text-gray-600">{item.date}</td>
                      <td className="py-3 pr-4 text-right text-sm font-medium text-gray-900">
                        ₫ {formatNumber(item.amount)}
                      </td>
                      <td className="py-3 pr-4 text-right text-sm text-gray-600">{item.units}</td>
                      <td className="py-3 pr-4">
                        <Badge variant={item.goal === 'Unassigned' ? 'secondary' : 'default'} className="whitespace-nowrap">
                          {item.goal}
                        </Badge>
                      </td>
                      <td className="py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
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

          {/* Direct Savings */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Direct Savings</h3>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Savings
              </Button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[110px]">Date</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[130px]">Amount</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[110px]">Interest Rate</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[110px]">Expiry Date</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[140px]">Goal</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-center w-[100px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {monthlyData.directSavings.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="py-3 pr-4 text-sm text-gray-600">{item.date}</td>
                      <td className="py-3 pr-4 text-right text-sm font-medium text-gray-900">
                        ₫ {formatNumber(item.amount)}
                      </td>
                      <td className="py-3 pr-4 text-right text-sm text-gray-600">{item.interestRate}%</td>
                      <td className="py-3 pr-4 text-sm text-gray-600">{item.expiryDate}</td>
                      <td className="py-3 pr-4">
                        <Badge className="whitespace-nowrap">{item.goal}</Badge>
                      </td>
                      <td className="py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
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

          {/* Fixed Expenses */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Fixed Expenses</h3>
                <p className="text-sm text-gray-500">Monthly amounts from Settings. Override or skip for this month.</p>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[200px]">Expense</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[130px]">Default / Month</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[170px]">This Month</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-center w-[120px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {monthlyData.fixedExpenses.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-900 truncate">{item.name}</p>
                        <p className="text-xs text-gray-500">{item.category}</p>
                      </td>
                      <td className="py-3 pr-4 text-right text-sm text-gray-600">
                        ₫ {formatNumber(item.default)}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className={`text-sm font-medium ${
                          item.thisMonth !== item.default ? 'text-amber-600' : 'text-gray-900'
                        }`}>
                          <div>₫ {formatNumber(item.thisMonth)}</div>
                          {item.thisMonth !== item.default && (
                            <div className="text-xs">(overridden)</div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">Skip</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Insurance */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Insurance</h3>
                <p className="text-sm text-gray-500">Monthly fees (annual / 12). Override or skip for this month.</p>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[120px]">Member</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[120px]">Relationship</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[140px]">Default / Month</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[130px]">This Month</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-center w-[120px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {monthlyData.insurance.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="py-3 pr-4 font-medium text-gray-900">{item.member}</td>
                      <td className="py-3 pr-4 text-sm text-gray-600">{item.relationship}</td>
                      <td className="py-3 pr-4 text-right text-sm text-gray-600">
                        ₫ {formatNumber(item.default)}
                      </td>
                      <td className="py-3 pr-4 text-right text-sm font-medium text-gray-900">
                        ₫ {formatNumber(item.thisMonth)}
                      </td>
                      <td className="py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">Skip</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="mt-4 flex items-center justify-between border-t pt-4">
              <span className="font-medium text-gray-900">Total Month</span>
              <span className="text-lg font-semibold text-gray-900">
                ₫ {formatNumber(monthlyData.insurance.reduce((sum, item) => sum + item.thisMonth, 0))}
              </span>
            </div>
          </Card>

          {/* Other Expenses */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Other Expenses</h3>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Expense
              </Button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[150px]">Amount</th>
                    <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-center w-[120px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {monthlyData.otherExpenses.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="py-3 pr-4 font-medium text-gray-900">{item.description}</td>
                      <td className="py-3 pr-4 text-right text-sm font-medium text-gray-900">
                        ₫ {formatNumber(item.amount)}
                      </td>
                      <td className="py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
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
        </div>

        {/* Right Column - Allocation Summary */}
        <div className="space-y-6">
          <Card className="p-6 sticky top-24">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Allocation Summary</h3>
            
            <div className="space-y-4">
              <div className="pb-4 border-b">
                <p className="text-sm text-gray-500 mb-1">Living</p>
                <p className="text-2xl font-bold text-gray-900">
                  ₫ {formatNumber(allocationSummary.living)}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-900 mb-2">GOAL</p>
                  <div className="space-y-2">
                    {Object.entries(allocationSummary.goals).map(([goal, data]) => (
                      <div key={goal} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">{goal}</span>
                        <div className="text-right">
                          <span className="font-medium text-gray-900">₫ {formatNumber(data.amount)}</span>
                          <span className="text-gray-500 ml-2">{data.percent}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 pt-3 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Unassigned</span>
                    <div className="text-right">
                      <span className="font-medium text-gray-900">₫ {formatNumber(allocationSummary.goals.Unassigned.amount)}</span>
                      <span className="text-gray-500 ml-2">{allocationSummary.goals.Unassigned.percent}%</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Fixed Expenses</span>
                    <div className="text-right">
                      <span className="font-medium text-gray-900">₫ {formatNumber(allocationSummary.fixedExpenses.amount)}</span>
                      <span className="text-gray-500 ml-2">{allocationSummary.fixedExpenses.percent}%</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Insurance</span>
                    <div className="text-right">
                      <span className="font-medium text-gray-900">₫ {formatNumber(allocationSummary.insurance.amount)}</span>
                      <span className="text-gray-500 ml-2">{allocationSummary.insurance.percent}%</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Other Expenses</span>
                    <div className="text-right">
                      <span className="font-medium text-gray-900">₫ {formatNumber(allocationSummary.otherExpenses.amount)}</span>
                      <span className="text-gray-500 ml-2">{allocationSummary.otherExpenses.percent}%</span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-900">Total Allocated</span>
                    <div className="text-right">
                      <span className="font-semibold text-gray-900">₫ {formatNumber(allocationSummary.totalAllocated)}</span>
                      <span className="text-gray-500 ml-2">72%</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 rounded-lg bg-green-50">
                    <span className="font-semibold text-green-900">Remaining Salary</span>
                    <div className="text-right">
                      <span className="font-bold text-green-900">₫ {formatNumber(allocationSummary.remainingSalary)}</span>
                      <span className="text-green-700 ml-2">{allocationSummary.remainingPercent}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}