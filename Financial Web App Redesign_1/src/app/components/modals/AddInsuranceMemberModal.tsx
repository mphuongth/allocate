import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface AddInsuranceMemberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { member: string; relationship: string; annualFee: number; paymentDate: string }) => void;
}

const relationships = [
  { value: 'self', label: 'Self' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'husband', label: 'Husband' },
  { value: 'wife', label: 'Wife' },
  { value: 'child', label: 'Child' },
  { value: 'parent', label: 'Parent' },
  { value: 'other', label: 'Other' },
];

export function AddInsuranceMemberModal({ open, onOpenChange, onSave }: AddInsuranceMemberModalProps) {
  const [formData, setFormData] = useState({
    member: '',
    relationship: '',
    annualFee: '',
    paymentDate: ''
  });

  const monthlyFee = formData.annualFee ? (Number(formData.annualFee) / 12).toFixed(0) : '0';

  const handleSave = () => {
    if (formData.member && formData.relationship && formData.annualFee && formData.paymentDate) {
      onSave({
        member: formData.member,
        relationship: formData.relationship,
        annualFee: Number(formData.annualFee),
        paymentDate: formData.paymentDate
      });
      onOpenChange(false);
      // Reset form
      setFormData({ member: '', relationship: '', annualFee: '', paymentDate: '' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Insurance Member</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="memberName">
              Member Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="memberName"
              placeholder="e.g., John Doe"
              value={formData.member}
              onChange={(e) => setFormData({...formData, member: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="relationship">
              Relationship <span className="text-red-500">*</span>
            </Label>
            <Select value={formData.relationship} onValueChange={(value) => setFormData({...formData, relationship: value})}>
              <SelectTrigger id="relationship">
                <SelectValue placeholder="Select relationship..." />
              </SelectTrigger>
              <SelectContent>
                {relationships.map(rel => (
                  <SelectItem key={rel.value} value={rel.value}>
                    {rel.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="annualFee">
              Annual Fee (VND) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="annualFee"
              type="number"
              placeholder="e.g., 23580000"
              value={formData.annualFee}
              onChange={(e) => setFormData({...formData, annualFee: e.target.value})}
            />
            {formData.annualFee && (
              <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
                <p className="text-sm text-violet-900">
                  <span className="font-medium">Monthly Fee:</span> ₫ {new Intl.NumberFormat('vi-VN').format(Number(monthlyFee))}
                </p>
                <p className="text-xs text-violet-700 mt-1">
                  This will be automatically added to your monthly plan
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentDate">
              Annual Payment Date <span className="text-red-500">*</span>
            </Label>
            <Input
              id="paymentDate"
              type="date"
              value={formData.paymentDate}
              onChange={(e) => setFormData({...formData, paymentDate: e.target.value})}
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
            disabled={!formData.member || !formData.relationship || !formData.annualFee || !formData.paymentDate}
            className="flex-1 bg-violet-600 hover:bg-violet-700"
          >
            Add Member
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
