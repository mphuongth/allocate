import { useState } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

// Mock data
const expenses = [
  { 
    id: 1, 
    name: 'Tiền điện nước mạng', 
    category: 'Housing',
    amount: 2000000,
    dateCreated: '23/3/2026'
  },
  { 
    id: 2, 
    name: 'Tiền đưa ba mẹ 2 bên', 
    category: 'Parents',
    amount: 7000000,
    dateCreated: '16/3/2026'
  },
];

const categories = ['All', 'Housing', 'Parents', 'Transportation', 'Food', 'Utilities', 'Other'];

export function FixedExpenses() {
  const [selectedCategory, setSelectedCategory] = useState('All');

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

  const totalMonthly = expenses.reduce((sum, exp) => sum + exp.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Fixed Expenses</h2>
          <p className="text-sm text-gray-500 mt-1">Total: ₫ {formatNumber(totalMonthly)} / month</p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Create Expense
        </Button>
      </div>

      {/* Category Filter */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <label className="text-sm text-gray-600">Category:</label>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Expenses Table */}
      <Card className="p-6">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[250px]">Name</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[150px]">Category</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[160px]">Amount / Month</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[120px]">Date Created</th>
                <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-center w-[130px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {expenses
                .filter(exp => selectedCategory === 'All' || exp.category === selectedCategory)
                .map((expense) => (
                <tr key={expense.id} className="hover:bg-gray-50">
                  <td className="py-4 pr-4 font-medium text-gray-900 truncate">{expense.name}</td>
                  <td className="py-4 pr-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 whitespace-nowrap">
                      {expense.category}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-right">
                    <span className="font-semibold text-gray-900">₫ {formatNumber(expense.amount)}</span>
                  </td>
                  <td className="py-4 pr-4 text-sm text-gray-600">{expense.dateCreated}</td>
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

        {expenses.filter(exp => selectedCategory === 'All' || exp.category === selectedCategory).length === 0 && (
          <div className="py-12 text-center">
            <p className="text-gray-500">No expenses found in this category.</p>
          </div>
        )}
      </Card>

      {/* Info Card */}
      <Card className="p-6 bg-amber-50 border-amber-200">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-white flex-shrink-0">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-amber-900 mb-1">About Fixed Expenses</h4>
            <p className="text-sm text-amber-800">
              Fixed expenses are automatically added to your Monthly Plan each month. You can override the amount for any specific month when planning.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
