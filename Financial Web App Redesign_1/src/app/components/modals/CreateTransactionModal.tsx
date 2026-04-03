import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';

type AssetType = 'Fund' | 'Bank' | 'Gold';

interface CreateTransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  funds: Array<{ id: string; name: string; code: string }>;
  goals: Array<{ id: string; name: string }>;
  onSave: (data: any) => void;
}

export function CreateTransactionModal({
  open,
  onOpenChange,
  funds,
  goals,
  onSave
}: CreateTransactionModalProps) {
  const [assetType, setAssetType] = useState<AssetType>('Fund');
  const [formData, setFormData] = useState({
    goalId: 'unassigned',
    fundId: '',
    date: new Date().toISOString().split('T')[0],
    amount: '',
    nav: '',
    units: '',
    interestRate: '',
    expiry: '',
    unitPrice: '',
    chi: '',
    notes: ''
  });

  // Reset form when modal opens
  useEffect(() => {
    if (!open) {
      setFormData({
        goalId: 'unassigned',
        fundId: '',
        date: new Date().toISOString().split('T')[0],
        amount: '',
        nav: '',
        units: '',
        interestRate: '',
        expiry: '',
        unitPrice: '',
        chi: '',
        notes: ''
      });
    }
  }, [open]);

  const handleSave = () => {
    onSave({ ...formData, assetType });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Create Transaction</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4 max-h-[500px] overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="assetType">Asset type</Label>
            <Select value={assetType} onValueChange={(value) => setAssetType(value as AssetType)}>
              <SelectTrigger id="assetType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Fund">Fund</SelectItem>
                <SelectItem value="Bank">Bank</SelectItem>
                <SelectItem value="Gold">Gold</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="goal">Goal</Label>
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

          {assetType === 'Fund' && (
            <div className="space-y-2">
              <Label htmlFor="fund">Fund</Label>
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
          )}

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({...formData, date: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              placeholder="VD: 10000000"
              value={formData.amount}
              onChange={(e) => setFormData({...formData, amount: e.target.value})}
            />
          </div>

          {assetType === 'Fund' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nav">NAV at Purchase</Label>
                <Input
                  id="nav"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 22215.12"
                  value={formData.nav}
                  onChange={(e) => setFormData({...formData, nav: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="units">Units</Label>
                <Input
                  id="units"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 450.25"
                  value={formData.units}
                  onChange={(e) => setFormData({...formData, units: e.target.value})}
                />
              </div>
            </div>
          )}

          {assetType === 'Bank' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="interestRate">Interest Rate</Label>
                <Input
                  id="interestRate"
                  type="number"
                  step="0.01"
                  placeholder="VD: 6.5"
                  value={formData.interestRate}
                  onChange={(e) => setFormData({...formData, interestRate: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiry">Expiry</Label>
                <Input
                  id="expiry"
                  type="date"
                  placeholder="dd/mm/yyyy"
                  value={formData.expiry}
                  onChange={(e) => setFormData({...formData, expiry: e.target.value})}
                />
              </div>
            </div>
          )}

          {assetType === 'Gold' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="unitPrice">Unit Price</Label>
                <Input
                  id="unitPrice"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 7500000"
                  value={formData.unitPrice}
                  onChange={(e) => setFormData({...formData, unitPrice: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chi">Chỉ</Label>
                <Input
                  id="chi"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 2.5"
                  value={formData.chi}
                  onChange={(e) => setFormData({...formData, chi: e.target.value})}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional notes..."
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
            />
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
