import { useState } from 'react';
import { ArrowUpRight, ArrowDownRight, TrendingUp, RefreshCw, Plus, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Input } from '../components/ui/input';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';

// Mock data
const goldPriceData = {
  current: 117190689,
  change: 76849,
  changePercent: 0.07 // Daily change percentage
};

const totalAssets = {
  current: 788893636,
  invested: 756183736,
  gain: 32709900,
  gainPercent: 4.37,
  cash: 178171343,
  investment: 732279245,
  history: [
    { month: 'Oct', value: 720000000 },
    { month: 'Nov', value: 740000000 },
    { month: 'Dec', value: 755000000 },
    { month: 'Jan', value: 770000000 },
    { month: 'Feb', value: 780000000 },
    { month: 'Mar', value: 788893636 },
  ]
};

const goals = [
  { 
    id: '1', 
    name: 'Y Tế', 
    current: 30126831, 
    target: 50000000,
    gain: 58431,
    gainPercent: 0.42,
    color: '#8b5cf6'
  },
  { 
    id: '2', 
    name: 'Phát sinh', 
    current: 20069570, 
    target: null,
    gain: 78775,
    gainPercent: 0.18,
    color: '#06b6d4'
  },
  { 
    id: '3', 
    name: 'Khẩn cấp', 
    current: 178171343,
    target: null,
    gain: 238202,
    gainPercent: 0.14,
    color: '#10b981'
  },
  { 
    id: '4', 
    name: 'Đại học của Trùng', 
    current: 109999327,
    target: null,
    gain: 1400327,
    gainPercent: 1.29,
    color: '#f59e0b'
  },
  { 
    id: '5', 
    name: 'Đường già', 
    current: 80639577,
    target: null,
    gain: 1143897,
    gainPercent: 1.43,
    color: '#ef4444'
  }
];

// Unallocated investments now include all types: fund, bank, gold, stock
const unallocatedInvestments = [
  { id: 1, type: 'fund', name: 'Quỹ VF4LF', nav: 65865055, units: 424.22, value: 27933886, gain: 49861, gainPercent: 0.18 },
  { id: 2, type: 'fund', name: 'Quỹ BYSPS', nav: 0, units: 0, value: 17533374, gain: -523, gainPercent: -0.003 },
  { id: 3, type: 'fund', name: 'Quỹ SNISCA', nav: 43975.61, units: 443.61, value: 15976858, gain: -23148, gainPercent: -0.14 },
  { id: 4, type: 'fund', name: 'Quỹ VCBF-MGF', nav: 14138.91, units: 114.19, value: 11061953, gain: -38034, gainPercent: -0.34 },
  { id: 5, type: 'bank', name: 'Vietcombank - Tiết kiệm', nav: null, units: null, value: 50000000, gain: 250000, gainPercent: 0.5, interestRate: 5.6 },
  { id: 6, type: 'gold', name: 'Vàng SJC', nav: 117190689, units: 2, value: 234381378, gain: 153698, gainPercent: 0.07 },
  { id: 7, type: 'stock', name: 'VNM - Vinamilk', nav: 85000, units: 100, value: 8500000, gain: -500000, gainPercent: -5.56 },
];

const insuranceMembers = [
  { 
    id: 1,
    name: 'Phương', 
    relationship: 'Self', 
    annual: 23580000, 
    monthly: 1965000, 
    nextPaymentDate: 'December 27, 2026',
    saved: 11790000, // Amount saved so far
    color: '#8b5cf6'
  },
  { 
    id: 2,
    name: 'Minh', 
    relationship: 'Husband', 
    annual: 27840000, 
    monthly: 2320000, 
    nextPaymentDate: 'December 15, 2026',
    saved: 18560000,
    color: '#06b6d4'
  },
  { 
    id: 3,
    name: 'Trùng', 
    relationship: 'Child', 
    annual: 19855000, 
    monthly: 1662917, 
    nextPaymentDate: 'May 31, 2026',
    saved: 4988750,
    color: '#10b981'
  },
];

// Asset allocation by type: fund, bank, gold, stock
const allocationData = [
  { name: 'Fund', value: 72505071, color: '#8b5cf6' },
  { name: 'Bank', value: 228171343, color: '#06b6d4' },
  { name: 'Gold', value: 234381378, color: '#f59e0b' },
  { name: 'Stock', value: 8500000, color: '#10b981' },
  { name: 'Cash', value: 245335844, color: '#e5e7eb' },
];

export function AssetOverview() {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('6m');
  const [insuranceSavings, setInsuranceSavings] = useState<Record<number, string>>({});

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

  const handleAddInsuranceSaving = (memberId: number) => {
    const amount = parseFloat(insuranceSavings[memberId] || '0');
    if (amount > 0) {
      // Here you would typically make an API call to save the amount
      console.log(`Adding ${amount} to insurance savings for member ${memberId}`);
      setInsuranceSavings({ ...insuranceSavings, [memberId]: '' });
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'fund': return 'bg-purple-100 text-purple-700';
      case 'bank': return 'bg-blue-100 text-blue-700';
      case 'gold': return 'bg-amber-100 text-amber-700';
      case 'stock': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Gold Price Banner */}
      <div className="rounded-lg bg-gradient-to-r from-amber-50 to-amber-100 border border-amber-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-white">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-amber-800 font-medium">Giá vàng Price</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-lg font-semibold text-amber-900">
                  ₫ {formatNumber(goldPriceData.current)}
                </span>
                <span className="text-xs text-amber-700">/ All / tạp lại</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className={`inline-flex items-center gap-1 text-sm font-medium ${
              goldPriceData.changePercent >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {goldPriceData.changePercent >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              {goldPriceData.changePercent.toFixed(2)}%
            </span>
            <p className="text-xs text-amber-700 mt-0.5">Daily change</p>
          </div>
        </div>
      </div>

      {/* Total Assets Overview */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-sm text-gray-500 mb-1">TOTAL ASSETS</p>
              <h2 className="text-4xl font-bold text-gray-900">
                ₫ {formatNumber(totalAssets.current)}
              </h2>
              <div className="flex items-center gap-4 mt-3">
                <div>
                  <p className="text-xs text-gray-500">GAIN/LOSS (All)</p>
                  <p className={`text-sm font-semibold ${totalAssets.gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ₫ {formatNumber(totalAssets.gain)} (+{totalAssets.gainPercent}%)
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">P/L %</p>
                  <p className="text-sm font-semibold text-gray-900">{totalAssets.gainPercent}%</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">INVESTMENT ASSETS ₫</p>
                  <p className="text-sm font-semibold text-gray-900">₫ {formatNumber(totalAssets.investment)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">TOTAL CASH</p>
                  <p className="text-sm font-semibold text-gray-900">₫ {formatNumber(totalAssets.cash)}</p>
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              {['6m', '1y', '3y', 'All'].map((range) => (
                <Button
                  key={range}
                  variant={timeRange === range ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setTimeRange(range)}
                  className="h-8"
                >
                  {range}
                </Button>
              ))}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={totalAssets.history}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`} />
              <Tooltip 
                formatter={(value: number) => formatCurrency(value)}
                contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
              />
              <Area type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="text-sm font-medium text-gray-900 mb-4">Asset Allocation by Type</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={allocationData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
              >
                {allocationData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-4">
            {allocationData.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-gray-600">{item.name}</span>
                </div>
                <span className="font-medium text-gray-900">
                  {((item.value / totalAssets.current) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Goals */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Goals</h3>
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Goal
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => (
            <Card 
              key={goal.id} 
              className="p-5 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/settings/goals/${goal.id}`)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div 
                    className="h-10 w-10 rounded-lg flex items-center justify-center text-white font-semibold"
                    style={{ backgroundColor: goal.color }}
                  >
                    {goal.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">{goal.name}</h4>
                    {goal.target && (
                      <p className="text-xs text-gray-500">Target: {formatCurrency(goal.target)}</p>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold text-gray-900">
                    ₫ {formatNumber(goal.current)}
                  </span>
                  <span className={`text-sm font-medium ${goal.gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    +{goal.gainPercent}%
                  </span>
                </div>
                
                {goal.target && (
                  <>
                    <Progress 
                      value={(goal.current / goal.target) * 100} 
                      className="h-2"
                      style={{ 
                        // @ts-ignore
                        '--progress-background': goal.color 
                      }}
                    />
                    <p className="text-xs text-gray-500">
                      {((goal.current / goal.target) * 100).toFixed(0)}% complete
                    </p>
                  </>
                )}
                
                <p className="text-xs text-gray-500">
                  Gain/Loss: <span className={goal.gain >= 0 ? 'text-green-600' : 'text-red-600'}>
                    ₫ {formatNumber(goal.gain)}
                  </span>
                </p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Unallocated Investments - Now includes all types */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Unallocated Investments</h3>
            <p className="text-sm text-gray-500">Total: ₫ {formatNumber(unallocatedInvestments.reduce((sum, inv) => sum + inv.value, 0))}</p>
          </div>
          <Button variant="outline" size="sm" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh NAV (Unallocated Only)
          </Button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="pb-3 text-xs font-medium text-gray-500 uppercase">Asset</th>
                <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">NAV / Interest</th>
                <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Units</th>
                <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Current Value</th>
                <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Gain/Loss</th>
                <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {unallocatedInvestments.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="py-3">
                    <Badge className={getTypeColor(inv.type)}>
                      {inv.type.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="py-3">
                    <p className="font-medium text-gray-900">{inv.name}</p>
                  </td>
                  <td className="py-3 text-right text-sm text-gray-600">
                    {inv.type === 'bank' 
                      ? `${(inv as any).interestRate}%` 
                      : inv.nav 
                        ? formatNumber(inv.nav) 
                        : '—'
                    }
                  </td>
                  <td className="py-3 text-right text-sm text-gray-600">
                    {inv.units || '—'}
                  </td>
                  <td className="py-3 text-right font-medium text-gray-900">
                    ₫ {formatNumber(inv.value)}
                  </td>
                  <td className="py-3 text-right">
                    <div className={`text-sm font-medium ${inv.gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {inv.gain >= 0 ? '+' : ''}{formatNumber(inv.gain)}
                    </div>
                    <div className={`text-xs ${inv.gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {inv.gainPercent >= 0 ? '+' : ''}{inv.gainPercent.toFixed(2)}%
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <Button variant="outline" size="sm">Assign to Goal</Button>
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
          <h3 className="text-lg font-semibold text-gray-900">Insurance</h3>
          <Button variant="outline" size="sm" onClick={() => navigate('/settings?tab=insurance')}>
            Manage
          </Button>
        </div>
        
        <div className="grid gap-4 md:grid-cols-3">
          {insuranceMembers.map((member) => {
            const progress = (member.saved / member.annual) * 100;
            return (
              <Card key={member.id} className="p-4 bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900">{member.name}</h4>
                    <Badge variant="secondary" className="mt-1 text-xs">
                      {member.relationship}
                    </Badge>
                  </div>
                  <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                    Đang áp hiện
                  </Badge>
                </div>
                
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Annual:</span>
                    <span className="font-medium text-gray-900">₫ {formatNumber(member.annual)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Monthly:</span>
                    <span className="font-medium text-gray-900">₫ {formatNumber(member.monthly)}</span>
                  </div>
                  
                  <div className="pt-2 border-t space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-600">Saved:</span>
                      <span className="font-semibold text-violet-600">₫ {formatNumber(member.saved)}</span>
                    </div>
                    <Progress 
                      value={progress} 
                      className="h-2"
                      style={{ 
                        // @ts-ignore
                        '--progress-background': member.color 
                      }}
                    />
                    <p className="text-xs text-gray-500">{progress.toFixed(0)}% of annual fee</p>
                  </div>

                  <div className="pt-2 border-t">
                    <p className="text-xs text-gray-500 mb-2">Hạn tiếp theo: {member.nextPaymentDate}</p>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Amount"
                        value={insuranceSavings[member.id] || ''}
                        onChange={(e) => setInsuranceSavings({ ...insuranceSavings, [member.id]: e.target.value })}
                        className="h-8 text-sm"
                      />
                      <Button 
                        size="sm" 
                        className="h-8 px-2"
                        onClick={() => handleAddInsuranceSaving(member.id)}
                      >
                        <Wallet className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </Card>
    </div>
  );
}