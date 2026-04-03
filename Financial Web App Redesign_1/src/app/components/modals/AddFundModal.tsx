import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface AddFundModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: any) => void;
}

export function AddFundModal({
  open,
  onOpenChange,
  onSave
}: AddFundModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    type: '',
    nav: '',
    navSourceUrl: ''
  });

  const handleSave = () => {
    onSave(formData);
    onOpenChange(false);
    setFormData({ name: '', code: '', type: '', nav: '', navSourceUrl: '' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Fund</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              Fund Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              placeholder="e.g., Vanguard S&P 500 ETF"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="code">
                Code <span className="text-red-500">*</span>
              </Label>
              <Input
                id="code"
                placeholder="e.g., VOO"
                value={formData.code}
                onChange={(e) => setFormData({...formData, code: e.target.value})}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">
                Type <span className="text-red-500">*</span>
              </Label>
              <Select value={formData.type} onValueChange={(value) => setFormData({...formData, type: value})}>
                <SelectTrigger id="type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="equity">Equity Fund</SelectItem>
                  <SelectItem value="bond">Bond Fund</SelectItem>
                  <SelectItem value="balanced">Balanced Fund</SelectItem>
                  <SelectItem value="index">Index Fund</SelectItem>
                  <SelectItem value="etf">ETF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nav">
              NAV <span className="text-red-500">*</span>
            </Label>
            <Input
              id="nav"
              type="number"
              step="0.01"
              placeholder="e.g., 450.25"
              value={formData.nav}
              onChange={(e) => setFormData({...formData, nav: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="navSourceUrl">NAV Source URL (optional)</Label>
            <Input
              id="navSourceUrl"
              type="url"
              placeholder="e.g., https://www.vcbf.com/quy-trai-phieu"
              value={formData.navSourceUrl}
              onChange={(e) => setFormData({...formData, navSourceUrl: e.target.value})}
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
            Save Fund
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
