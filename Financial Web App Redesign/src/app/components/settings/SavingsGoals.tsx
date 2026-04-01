import { Plus, Edit, Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

const goals = [
  { 
    id: '1', 
    name: 'Y Tế',
    target: 50000000,
    current: 30000000,
    invested: 30000000,
    interest: 0,
    transactions: 1,
    lastUpdate: '2/5/2025'
  },
  { 
    id: '2', 
    name: 'Phát sinh',
    target: null,
    current: 20000000,
    invested: 20000000,
    interest: 0,
    transactions: 1,
    lastUpdate: '23/3/2026'
  },
  { 
    id: '3', 
    name: 'Khẩn cấp',
    target: null,
    current: 177798501,
    invested: 167747337,
    interest: 10075564,
    transactions: 2,
    lastUpdate: '10/3/2026'
  },
  { 
    id: '4', 
    name: 'Đại học của Trùng',
    target: null,
    current: 109999327,
    invested: 108509000,
    interest: 1490327,
    transactions: 18,
    lastUpdate: '18/3/2026'
  },
  { 
    id: '5', 
    name: 'Đường già',
    target: null,
    current: 80550217,
    invested: 79250787,
    interest: 1299430,
    transactions: 8,
    lastUpdate: '18/3/2026'
  },
];

export function SavingsGoals() {
  const navigate = useNavigate();

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Savings Goals</h2>
          <p className="text-sm text-gray-500 mt-1">Manage your financial goals and track progress</p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Create Goal
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {goals.map((goal) => (
          <Card 
            key={goal.id} 
            className="p-5 hover:shadow-lg transition-all cursor-pointer border-2 hover:border-violet-200"
            onClick={() => navigate(`/settings/goals/${goal.id}`)}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 text-lg mb-1">{goal.name}</h3>
                {goal.target && (
                  <p className="text-xs text-gray-500">
                    Progress: {formatCurrency(goal.target)}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-700 mb-1">CURRENT VALUE</p>
                <p className="text-2xl font-bold text-blue-900">
                  ₫ {formatNumber(goal.current)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="p-2 bg-gray-50 rounded">
                  <p className="text-xs text-gray-500 mb-1">Total Invested</p>
                  <p className="font-medium text-gray-900">₫ {formatNumber(goal.invested)}</p>
                </div>
                <div className="p-2 bg-gray-50 rounded">
                  <p className="text-xs text-gray-500 mb-1">Interest</p>
                  <p className={`font-medium ${goal.interest >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ₫ {formatNumber(goal.interest)}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t text-sm">
                <span className="text-gray-500">{goal.transactions} transactions</span>
                <span className="text-gray-500">{goal.lastUpdate}</span>
              </div>
            </div>

            <Button 
              variant="outline" 
              className="w-full mt-4"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/settings/goals/${goal.id}`);
              }}
            >
              View Details
            </Button>
          </Card>
        ))}
      </div>

      {/* Summary Card */}
      <Card className="p-6 bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-violet-900 mb-2">Total Across All Goals</h3>
            <div className="flex items-baseline gap-4">
              <div>
                <p className="text-xs text-violet-700">Current Value</p>
                <p className="text-3xl font-bold text-violet-900">
                  ₫ {formatNumber(goals.reduce((sum, g) => sum + g.current, 0))}
                </p>
              </div>
              <div>
                <p className="text-xs text-violet-700">Total Interest</p>
                <p className="text-xl font-semibold text-green-600">
                  +₫ {formatNumber(goals.reduce((sum, g) => sum + g.interest, 0))}
                </p>
              </div>
            </div>
          </div>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-500 text-white">
            <TrendingUp className="h-8 w-8" />
          </div>
        </div>
      </Card>
    </div>
  );
}
