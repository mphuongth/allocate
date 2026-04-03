import { useState } from 'react';
import { Plus, Edit, Trash2, Download, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';

// Mock data
const transactions = [
  { id: 1, date: '26/3/2026', asset: 'Ngân hàng', amount: 14074601, units: null, transactionType: null, interestRate: 4.73, expiry: null, goal: 'Unassigned', notes: 'PVcomBank' },
  { id: 2, date: '21/3/2026', asset: 'Vàng', amount: 17100000, units: 1, transactionType: null, interestRate: null, expiry: null, goal: 'Unassigned', notes: '' },
  { id: 3, date: '11/3/2026', asset: 'Quỹ', amount: 1000000, units: 22.55, transactionType: null, interestRate: 44272.64, expiry: null, goal: 'Unassigned', notes: '' },
  { id: 4, date: '9/3/2026', asset: 'Ngân hàng', amount: 86303265, units: null, transactionType: null, interestRate: 7.49, expiry: null, goal: 'VIBM', notes: '' },
  { id: 5, date: '5/3/2026', asset: 'Quỹ', amount: 600000, units: 23.24, transactionType: null, interestRate: 25816.84, expiry: null, goal: 'Đại học của Trùng', notes: '' },
  { id: 6, date: '5/3/2026', asset: 'Quỹ', amount: 3000000, units: 192.04, transactionType: null, interestRate: 15620.86, expiry: null, goal: 'Đường già', notes: '' },
  { id: 7, date: '4/3/2026', asset: 'Ngân hàng', amount: 30200000, units: null, transactionType: null, interestRate: 5.6, expiry: null, goal: 'Y Tế', notes: '' },
  { id: 8, date: '4/3/2026', asset: 'Quỹ', amount: 1000000, units: 64.12, transactionType: null, interestRate: 15994.54, expiry: null, goal: 'Unassigned', notes: '' },
];

const assets = ['All', 'Ngân hàng', 'Vàng', 'Quỹ'];
const goals = ['All', 'Unassigned', 'Y Tế', 'Đại học của Trùng', 'Đường già', 'VIBM'];

export function InvestmentTransactions() {
  const [selectedAsset, setSelectedAsset] = useState('All');
  const [selectedGoal, setSelectedGoal] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

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

  const totalPages = Math.ceil(transactions.length / itemsPerPage);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Investment Transactions</h2>
          <p className="text-sm text-gray-500 mt-1">137 giao dịch total</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            ↑ Nhập từ Excel
          </Button>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            + Create Transaction
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="text-sm text-gray-600 mb-2 block">Asset type</label>
            <Select value={selectedAsset} onValueChange={setSelectedAsset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assets.map(asset => (
                  <SelectItem key={asset} value={asset}>{asset}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm text-gray-600 mb-2 block">Goal</label>
            <Select value={selectedGoal} onValueChange={setSelectedGoal}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {goals.map(goal => (
                  <SelectItem key={goal} value={goal}>{goal}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm text-gray-600 mb-2 block">From date</label>
            <Input 
              type="date" 
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="dd/mm/yyyy"
            />
          </div>

          <div>
            <label className="text-sm text-gray-600 mb-2 block">To date</label>
            <Input 
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="dd/mm/yyyy"
            />
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <Button variant="outline" size="sm">Đặt lại</Button>
        </div>
      </Card>

      {/* Transactions Table */}
      <Card className="p-6">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[100px]">Date</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[120px]">Fund / Asset</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[120px]">Amount</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[100px]">Transaction</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[110px]">Interest Rate</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase text-right w-[100px]">Expiry</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[140px]">Goal</th>
                <th className="pb-3 pr-4 text-xs font-medium text-gray-500 uppercase w-[120px]">Notes</th>
                <th className="pb-3 text-xs font-medium text-gray-500 uppercase text-center w-[100px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {transactions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((transaction) => (
                <tr key={transaction.id} className="hover:bg-gray-50">
                  <td className="py-3 pr-4 text-sm text-gray-600">{transaction.date}</td>
                  <td className="py-3 pr-4">
                    <Badge className={
                      transaction.asset === 'Ngân hàng' ? 'bg-blue-100 text-blue-700' :
                      transaction.asset === 'Vàng' ? 'bg-amber-100 text-amber-700' :
                      'bg-purple-100 text-purple-700'
                    }>
                      {transaction.asset}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 text-right font-medium text-gray-900">
                    ₫ {formatNumber(transaction.amount)}
                  </td>
                  <td className="py-3 pr-4 text-right text-sm text-gray-600">
                    {transaction.units || '—'}
                  </td>
                  <td className="py-3 pr-4 text-right text-sm text-gray-600">
                    {transaction.interestRate ? `${transaction.interestRate}%` : '—'}
                  </td>
                  <td className="py-3 pr-4 text-right text-sm text-gray-600 truncate">
                    {transaction.expiry ? `₫ ${formatNumber(transaction.expiry)}` : '—'}
                  </td>
                  <td className="py-3 pr-4">
                    <Badge variant={transaction.goal === 'Unassigned' ? 'secondary' : 'default'} className="whitespace-nowrap">
                      {transaction.goal}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 text-sm text-gray-600 truncate">
                    {transaction.notes || '—'}
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

        {/* Pagination */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <p className="text-sm text-gray-600">
            Page {currentPage} / {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
