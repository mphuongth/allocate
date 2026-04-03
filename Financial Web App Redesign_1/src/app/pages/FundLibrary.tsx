import { useState } from 'react';
import { Plus, Edit, Trash2, RefreshCw, ArrowUpDown } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';

// Mock data
const funds = [
  { id: 1, name: 'Quỹ DCDE', code: 'DCDE', type: 'Equity', nav: 29773.45, lastUpdate: '6d ago', color: 'bg-green-100 text-green-700' },
  { id: 2, name: 'Quỹ DCDS', code: 'DCDS', type: 'Fairly', nav: 97923.63, lastUpdate: '6d ago', color: 'bg-blue-100 text-blue-700' },
  { id: 3, name: 'Quỹ SSISCA', code: 'SSISCA', type: 'Equity', nav: 43975.61, lastUpdate: '5d ago', color: 'bg-green-100 text-green-700' },
  { id: 4, name: 'Quỹ VCBF-FIF', code: 'VCBF-FIF', type: 'Bond', nav: 15647.60, lastUpdate: '5d ago', color: 'bg-indigo-100 text-indigo-700' },
  { id: 5, name: 'Quỹ VCBF-MGF', code: 'VCBF-MGF', type: 'Fairly', nav: 14138.91, lastUpdate: '6d ago', color: 'bg-blue-100 text-blue-700' },
  { id: 6, name: 'Quỹ VCBF-TBF', code: 'VCBF-TBF', type: 'Balanced', nav: 37557.25, lastUpdate: '6d ago', color: 'bg-purple-100 text-purple-700' },
  { id: 7, name: 'Quỹ VESAF', code: 'VESAF', type: 'Equity', nav: 34434.22, lastUpdate: '5d ago', color: 'bg-green-100 text-green-700' },
  { id: 8, name: 'Quỹ VFF', code: 'VFF', type: 'Rơvl', nav: 25883.87, lastUpdate: '6d ago', color: 'bg-cyan-100 text-cyan-700' },
  { id: 9, name: 'Quỹ VIBF', code: 'VIBF', type: 'Balanced', nav: 19527.11, lastUpdate: '5d ago', color: 'bg-purple-100 text-purple-700' },
  { id: 10, name: 'Quỹ VMEEF', code: 'VMEEF', type: 'Equity', nav: 16856.18, lastUpdate: '6d ago', color: 'bg-green-100 text-green-700' },
];

export function FundLibrary() {
  const [sortBy, setSortBy] = useState<'name' | 'nav' | 'type'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('vi-VN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const handleRefreshNAV = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1500);
  };

  const handleSort = (field: 'name' | 'nav' | 'type') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const filteredFunds = funds.filter(fund =>
    fund.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    fund.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedFunds = [...filteredFunds].sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else if (sortBy === 'nav') {
      comparison = a.nav - b.nav;
    } else if (sortBy === 'type') {
      comparison = a.type.localeCompare(b.type);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Fund Library</h1>
          <p className="text-sm text-gray-500 mt-1">Manage investment funds</p>
        </div>
        <div className="flex gap-3">
          <Button 
            variant="outline" 
            className="gap-2"
            onClick={handleRefreshNAV}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh NAV
          </Button>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Add Fund
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Input
              type="text"
              placeholder="Search by fund name or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-md"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{filteredFunds.length} funds</span>
          </div>
        </div>
      </Card>

      {/* Funds Table */}
      <Card className="p-6">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="pb-4 text-left">
                  <button
                    onClick={() => handleSort('name')}
                    className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase hover:text-gray-700"
                  >
                    Name <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="pb-4 text-left">
                  <span className="text-xs font-medium text-gray-500 uppercase">Code</span>
                </th>
                <th className="pb-4 text-left">
                  <button
                    onClick={() => handleSort('type')}
                    className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase hover:text-gray-700"
                  >
                    Type <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="pb-4 text-right">
                  <button
                    onClick={() => handleSort('nav')}
                    className="flex items-center justify-end gap-2 text-xs font-medium text-gray-500 uppercase hover:text-gray-700 ml-auto"
                  >
                    NAV <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="pb-4 text-right">
                  <span className="text-xs font-medium text-gray-500 uppercase">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sortedFunds.map((fund) => (
                <tr key={fund.id} className="hover:bg-gray-50">
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-600 font-semibold">
                        {fund.code.substring(0, 2)}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{fund.name}</p>
                        <p className="text-xs text-gray-500">Last updated: {fund.lastUpdate}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4">
                    <code className="text-sm font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">
                      {fund.code}
                    </code>
                  </td>
                  <td className="py-4">
                    <Badge className={fund.color}>
                      {fund.type}
                    </Badge>
                  </td>
                  <td className="py-4 text-right">
                    <div>
                      <p className="font-semibold text-gray-900">{formatNumber(fund.nav)}</p>
                      <p className="text-xs text-gray-500">{fund.lastUpdate}</p>
                    </div>
                  </td>
                  <td className="py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm">
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sortedFunds.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-gray-500">No funds found matching your search.</p>
          </div>
        )}
      </Card>

      {/* Info Card */}
      <Card className="p-6 bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white flex-shrink-0">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-blue-900 mb-1">About NAV Updates</h4>
            <p className="text-sm text-blue-800">
              NAV (Net Asset Value) is updated daily by fund providers. Click "Refresh NAV" to fetch the latest prices for all funds.
              Prices are typically updated after market close.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
