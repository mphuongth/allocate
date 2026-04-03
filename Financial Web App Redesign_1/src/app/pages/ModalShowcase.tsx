import { useState } from 'react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
  AssignToGoalModal,
  AddFundInvestmentModal,
  AddSavingsModal,
  AddExpenseModal,
  DeleteSalaryModal,
  DeleteInvestmentModal,
  AddFundModal,
  CreateTransactionModal,
  ImportExcelModal,
  CreateFixedExpenseModal,
  AddInsuranceMemberModal
} from '../components/modals';

// Mock data
const mockGoals = [
  { id: '1', name: 'Y Tế', target: 50000000, current: 30000000, progress: 60 },
  { id: '2', name: 'Phát sinh', target: 20000000, current: 20000000, progress: 100 },
  { id: '3', name: 'Khẩn cấp', target: 288000000, current: 178560000, progress: 62 },
  { id: '4', name: 'Đường già', target: 0, current: 0, progress: 0 },
  { id: '5', name: 'Đại học của Trùng', target: 0, current: 0, progress: 0 },
];

const mockFunds = [
  { id: '1', name: 'Quỹ VCBF-TBF', code: 'VCBFTBF' },
  { id: '2', name: 'Quỹ VCBF-FIF', code: 'VCBFFIF' },
  { id: '3', name: 'Quỹ VFF', code: 'VFF' },
  { id: '4', name: 'Quỹ VIBF', code: 'VIBF' },
  { id: '5', name: 'Quỹ VESAF', code: 'VESAF' },
];

export function ModalShowcase() {
  const [openModal, setOpenModal] = useState<string | null>(null);

  const modals = [
    { id: 'assignGoal', name: '1. Assign to Goal' },
    { id: 'addFundInvestment', name: '2. Add Fund Investment' },
    { id: 'addSavings', name: '3. Add Savings' },
    { id: 'addExpense', name: '4. Add Expense' },
    { id: 'deleteSalary', name: '5. Delete Salary Record' },
    { id: 'deleteInvestment', name: '6. Delete Investment' },
    { id: 'addFund', name: '7. Add Fund' },
    { id: 'createTransactionFund', name: '8. Create Transaction (Fund)' },
    { id: 'createTransactionBank', name: '9. Create Transaction (Bank)' },
    { id: 'createTransactionGold', name: '10. Create Transaction (Gold)' },
    { id: 'importExcel', name: '11. Import from Excel' },
    { id: 'createFixedExpense', name: '12. Create Fixed Expense' },
    { id: 'addInsuranceMember', name: '13. Add Insurance Member' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Modal Showcase</h1>
        <p className="text-gray-500 mt-2">Click any button to preview the redesigned modals</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {modals.map((modal) => (
          <Card key={modal.id} className="p-6">
            <Button
              onClick={() => setOpenModal(modal.id)}
              className="w-full bg-violet-600 hover:bg-violet-700"
            >
              {modal.name}
            </Button>
          </Card>
        ))}
      </div>

      {/* All Modals */}
      <AssignToGoalModal
        open={openModal === 'assignGoal'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        goals={mockGoals}
        onAssign={(goalId) => console.log('Assigned to goal:', goalId)}
      />

      <AddFundInvestmentModal
        open={openModal === 'addFundInvestment'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        funds={mockFunds}
        goals={mockGoals}
        onSave={(data) => console.log('Fund investment saved:', data)}
      />

      <AddSavingsModal
        open={openModal === 'addSavings'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        goals={mockGoals}
        onSave={(data) => console.log('Savings saved:', data)}
      />

      <AddExpenseModal
        open={openModal === 'addExpense'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        onSave={(data) => console.log('Expense saved:', data)}
      />

      <DeleteSalaryModal
        open={openModal === 'deleteSalary'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        month="March 2026"
        onConfirm={() => console.log('Salary deleted')}
      />

      <DeleteInvestmentModal
        open={openModal === 'deleteInvestment'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        onConfirm={() => console.log('Investment deleted')}
      />

      <AddFundModal
        open={openModal === 'addFund'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        onSave={(data) => console.log('Fund saved:', data)}
      />

      <CreateTransactionModal
        open={openModal === 'createTransactionFund' || openModal === 'createTransactionBank' || openModal === 'createTransactionGold'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        funds={mockFunds}
        goals={mockGoals}
        onSave={(data) => console.log('Transaction saved:', data)}
      />

      <ImportExcelModal
        open={openModal === 'importExcel'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        onImport={(data) => console.log('Excel data imported:', data)}
      />

      <CreateFixedExpenseModal
        open={openModal === 'createFixedExpense'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        onSave={(data) => console.log('Fixed expense created:', data)}
      />

      <AddInsuranceMemberModal
        open={openModal === 'addInsuranceMember'}
        onOpenChange={(open) => !open && setOpenModal(null)}
        onSave={(data) => console.log('Insurance member added:', data)}
      />
    </div>
  );
}
