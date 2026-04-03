import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface AddFundInvestmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  funds: Array<{ id: string; name: string; code: string }>;
  goals: Array<{ id: string; name: string }>;
  onSave: (data: any) => void;
}

export function AddFundInvestmentModal({
  open,
  onOpenChange,
  funds,
  goals,
  onSave
}: AddFundInvestmentModalProps) {
  const [formData, setFormData] = useState({
    fundId: '',
    date: '',
    goalId: 'unassigned',
    amount: '',
    units: '',
    nav: ''
  });

  const handleSave = () => {
    onSave(formData);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Fund Investment</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="fund">
              Fund <span className="text-red-500">*</span>
            </Label>
            <Select value={formData.fundId} onValueChange={(value) => setFormData({...formData, fundId: value})}>
              <SelectTrigger id="fund">
                <SelectValue placeholder="Select fund..." />
              </SelectTrigger>
              <SelectContent>
                {funds.map(fund => (
                  <SelectItem key={fund.id} value={fund.id}>
                    {fund.name} ({fund.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">
              Investment Date <span className="text-red-500">*</span>
            </Label>
            <Input
              id="date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({...formData, date: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="goal">Goal (optional)</Label>
            <Select value={formData.goalId} onValueChange={(value) => setFormData({...formData, goalId: value})}>
              <SelectTrigger id="goal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {goals.map(goal => (
                  <SelectItem key={goal.id} value={goal.id}>
                    {goal.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">
              Amount (VND) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="amount"
              type="number"
              placeholder="e.g., 10000000"
              value={formData.amount}
              onChange={(e) => setFormData({...formData, amount: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="units">
                Units Purchased <span className="text-red-500">*</span>
              </Label>
              <Input
                id="units"
                type="number"
                step="0.01"
                placeholder="e.g., 450.25"
                value={formData.units}
                onChange={(e) => setFormData({...formData, units: e.target.value})}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nav">
                NAV at Purchase <span className="text-red-500">*</span>
              </Label>
              <Input
                id="nav"
                type="number"
                step="0.01"
                placeholder="e.g., 22215.12"
                value={formData.nav}
                onChange={(e) => setFormData({...formData, nav: e.target.value})}
              />
            </div>
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
            className="flex-1 bg-violet-600 hover:bg-violet-700"
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
