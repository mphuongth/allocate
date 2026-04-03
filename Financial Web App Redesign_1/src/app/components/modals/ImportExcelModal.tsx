import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Upload, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '../ui/badge';

interface ImportExcelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (data: any[]) => void;
}

interface ParsedRow {
  id: string;
  date: string;
  asset: string;
  amount: string;
  units?: string;
  nav?: string;
  interestRate?: string;
  goal: string;
  notes: string;
  status: 'valid' | 'warning' | 'error';
  message?: string;
}

export function ImportExcelModal({ open, onOpenChange, onImport }: ImportExcelModalProps) {
  const [step, setStep] = useState<'paste' | 'preview'>('paste');
  const [pastedData, setPastedData] = useState('');
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);

  const handleParse = () => {
    // Mock parsing logic - in real app, this would parse the Excel data
    const mockParsedData: ParsedRow[] = [
      {
        id: '1',
        date: '26/3/2026',
        asset: 'Bank',
        amount: '14074601',
        interestRate: '4.73',
        goal: 'Unassigned',
        notes: 'PVcomBank',
        status: 'valid'
      },
      {
        id: '2',
        date: '21/3/2026',
        asset: 'Gold',
        amount: '17100000',
        units: '1',
        goal: 'Unassigned',
        notes: '',
        status: 'valid'
      },
      {
        id: '3',
        date: '11/3/2026',
        asset: 'Fund',
        amount: '1000000',
        units: '22.55',
        nav: '44272.64',
        goal: 'Emergency',
        notes: '',
        status: 'warning',
        message: 'Goal "Emergency" not found'
      },
      {
        id: '4',
        date: 'invalid',
        asset: 'Bank',
        amount: '86303265',
        interestRate: '7.49',
        goal: 'Unassigned',
        notes: '',
        status: 'error',
        message: 'Invalid date format'
      },
    ];

    setParsedData(mockParsedData);
    setStep('preview');
  };

  const handleImport = () => {
    const validData = parsedData.filter(row => row.status === 'valid' || row.status === 'warning');
    onImport(validData);
    onOpenChange(false);
    // Reset state
    setPastedData('');
    setParsedData([]);
    setStep('paste');
  };

  const handleBack = () => {
    setStep('paste');
  };

  const validCount = parsedData.filter(r => r.status === 'valid').length;
  const warningCount = parsedData.filter(r => r.status === 'warning').length;
  const errorCount = parsedData.filter(r => r.status === 'error').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Import from Excel</DialogTitle>
        </DialogHeader>

        {step === 'paste' ? (
          <div className="space-y-5 py-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white flex-shrink-0">
                  <Upload className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <h4 className="font-medium text-blue-900 mb-1">How to import</h4>
                  <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                    <li>Open your Excel file with transaction data</li>
                    <li>Select and copy the data (Ctrl+C or Cmd+C)</li>
                    <li>Paste the data in the text area below</li>
                    <li>Click "Parse Data" to preview and validate</li>
                  </ol>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900">
                Paste Excel Data <span className="text-red-500">*</span>
              </label>
              <Textarea
                placeholder="Paste your Excel data here...&#10;&#10;Example format:&#10;Date    Asset    Amount    Units    NAV    Goal    Notes&#10;26/3/2026    Bank    14074601    -    -    Unassigned    PVcomBank"
                rows={10}
                value={pastedData}
                onChange={(e) => setPastedData(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-gray-500">
                Expected columns: Date, Asset, Amount, Units, NAV, Interest Rate, Goal, Notes
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
                onClick={handleParse}
                disabled={!pastedData.trim()}
                className="flex-1 bg-violet-600 hover:bg-violet-700"
              >
                Parse Data
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 py-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-2xl font-bold text-green-900">{validCount}</span>
                </div>
                <p className="text-xs text-green-700">Valid</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span className="text-2xl font-bold text-amber-900">{warningCount}</span>
                </div>
                <p className="text-xs text-amber-700">Warnings</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span className="text-2xl font-bold text-red-900">{errorCount}</span>
                </div>
                <p className="text-xs text-red-700">Errors</p>
              </div>
            </div>

            {/* Preview Table */}
            <div className="border rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Asset</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Goal</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parsedData.map((row) => (
                    <tr key={row.id} className={
                      row.status === 'error' ? 'bg-red-50' :
                      row.status === 'warning' ? 'bg-amber-50' :
                      'bg-white'
                    }>
                      <td className="px-3 py-2">
                        {row.status === 'valid' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        {row.status === 'warning' && <AlertCircle className="h-4 w-4 text-amber-600" />}
                        {row.status === 'error' && <XCircle className="h-4 w-4 text-red-600" />}
                      </td>
                      <td className="px-3 py-2 text-gray-900">{row.date}</td>
                      <td className="px-3 py-2">
                        <Badge className={
                          row.asset === 'Bank' ? 'bg-blue-100 text-blue-700' :
                          row.asset === 'Gold' ? 'bg-amber-100 text-amber-700' :
                          'bg-purple-100 text-purple-700'
                        }>
                          {row.asset}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        ₫ {new Intl.NumberFormat('vi-VN').format(Number(row.amount))}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{row.goal}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{row.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {errorCount > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-800">
                  <strong>Note:</strong> Rows with errors will be skipped during import.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleBack}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={validCount === 0 && warningCount === 0}
                className="flex-1 bg-violet-600 hover:bg-violet-700"
              >
                Import {validCount + warningCount} Transaction{validCount + warningCount !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
