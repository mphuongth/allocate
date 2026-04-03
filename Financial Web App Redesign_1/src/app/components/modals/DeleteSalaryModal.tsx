import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';

interface DeleteSalaryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  onConfirm: () => void;
}

export function DeleteSalaryModal({
  open,
  onOpenChange,
  month,
  onConfirm
}: DeleteSalaryModalProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            Delete salary record?
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            This will permanently delete the salary record for <span className="font-semibold text-gray-900">{month}</span> and all related allocations. This action cannot be undone.
          </p>
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
            onClick={handleConfirm}
            className="flex-1 bg-red-600 hover:bg-red-700"
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
