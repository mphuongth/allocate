import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';

interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
  progress: number;
}

interface AssignToGoalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionInfo?: string;
  goals: Goal[];
  onAssign: (goalId: string) => void;
}

export function AssignToGoalModal({
  open,
  onOpenChange,
  transactionInfo = "Bank • 26/3/2026",
  goals,
  onAssign
}: AssignToGoalModalProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0
    }).format(value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Assign to Goal</DialogTitle>
          <p className="text-sm text-gray-500 mt-1">{transactionInfo}</p>
        </DialogHeader>

        <div className="space-y-3 max-h-[400px] overflow-y-auto py-2">
          {goals.map((goal) => (
            <button
              key={goal.id}
              onClick={() => onAssign(goal.id)}
              className="w-full text-left p-4 rounded-lg border border-gray-200 hover:border-violet-300 hover:bg-violet-50 transition-colors"
            >
              <div className="mb-3">
                <h4 className="font-medium text-gray-900 mb-1">{goal.name}</h4>
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>Target: {formatCurrency(goal.target)}</span>
                  <span className="font-medium text-violet-600">{goal.progress}% complete</span>
                </div>
              </div>
              <Progress value={goal.progress} className="h-2" />
            </button>
          ))}
        </div>

        <div className="flex gap-3 mt-6">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onOpenChange(false)}
            className="flex-1 bg-violet-600 hover:bg-violet-700"
          >
            Assign
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
