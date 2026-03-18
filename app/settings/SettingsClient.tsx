'use client'

import { useState } from 'react'
import SavingsGoalsTab from './tabs/SavingsGoalsTab'
import InvestmentTransactionsTab from './tabs/InvestmentTransactionsTab'
import UnassignedInvestmentsTab from './tabs/UnassignedInvestmentsTab'
import FixedExpensesTab from './tabs/FixedExpensesTab'
import InsuranceMembersTab from './tabs/InsuranceMembersTab'

const TABS = [
  { id: 'goals', label: 'Savings Goals' },
  { id: 'transactions', label: 'Investment Transactions' },
  { id: 'unassigned', label: 'Unassigned Investments' },
  { id: 'expenses', label: 'Fixed Expenses' },
  { id: 'insurance', label: 'Insurance Members' },
] as const

type TabId = typeof TABS[number]['id']

export default function SettingsClient() {
  const [activeTab, setActiveTab] = useState<TabId>('goals')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your savings goals, investments, expenses, and insurance.</p>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {activeTab === 'goals' && <SavingsGoalsTab />}
        {activeTab === 'transactions' && <InvestmentTransactionsTab />}
        {activeTab === 'unassigned' && <UnassignedInvestmentsTab />}
        {activeTab === 'expenses' && <FixedExpensesTab />}
        {activeTab === 'insurance' && <InsuranceMembersTab />}
      </div>
    </div>
  )
}
