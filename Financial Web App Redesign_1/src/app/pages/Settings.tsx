import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { SavingsGoals } from '../components/settings/SavingsGoals';
import { InvestmentTransactions } from '../components/settings/InvestmentTransactions';
import { FixedExpenses } from '../components/settings/FixedExpenses';
import { InsuranceMembers } from '../components/settings/InsuranceMembers';
import { GoalDetail } from '../components/settings/GoalDetail';

export function Settings() {
  const { goalId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('goals');

  // If we have a goalId, show the detail view
  if (goalId) {
    return <GoalDetail goalId={goalId} onBack={() => navigate('/settings')} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage savings goals, investments, expenses and insurance</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 lg:w-auto">
          <TabsTrigger value="goals">Savings Goals</TabsTrigger>
          <TabsTrigger value="transactions">Investment Transactions</TabsTrigger>
          <TabsTrigger value="expenses">Fixed Expenses</TabsTrigger>
          <TabsTrigger value="insurance">Insurance Members</TabsTrigger>
        </TabsList>

        <TabsContent value="goals" className="mt-6">
          <SavingsGoals />
        </TabsContent>

        <TabsContent value="transactions" className="mt-6">
          <InvestmentTransactions />
        </TabsContent>

        <TabsContent value="expenses" className="mt-6">
          <FixedExpenses />
        </TabsContent>

        <TabsContent value="insurance" className="mt-6">
          <InsuranceMembers />
        </TabsContent>
      </Tabs>
    </div>
  );
}
