import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface CreateFixedExpenseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { name: string; category: string; amount: number }) => void;
}

const categories = [
  { value: 'housing', label: 'Housing' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'transportation', label: 'Transportation' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'parents', label: 'Parents' },
  { value: 'education', label: 'Education' },
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'other', label: 'Other' },
];

export function CreateFixedExpenseModal({ open, onOpenChange, onSave }: CreateFixedExpenseModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    amount: ''
  });

  const handleSave = () => {
    if (formData.name && formData.category && formData.amount) {
      onSave({
        name: formData.name,
        category: formData.category,
        amount: Number(formData.amount)
      });
      onOpenChange(false);
      // Reset form
      setFormData({ name: '', category: '', amount: '' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create Fixed Expense</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="expenseName">
              Expense Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="expenseName"
              placeholder="e.g., Rent, Electricity, Internet..."
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">
              Category <span className="text-red-500">*</span>
            </Label>
            <Select value={formData.category} onValueChange={(value) => setFormData({...formData, category: value})}>
              <SelectTrigger id="category">
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">
              Monthly Amount (VND) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="amount"
              type="number"
              placeholder="e.g., 5000000"
              value={formData.amount}
              onChange={(e) => setFormData({...formData, amount: e.target.value})}
            />
            <p className="text-xs text-gray-500">
              This amount will be automatically added to your monthly plan
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!formData.name || !formData.category || !formData.amount}
            className="flex-1 bg-violet-600 hover:bg-violet-700"
          >
            Save Expense
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
