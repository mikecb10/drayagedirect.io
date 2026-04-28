import { useState, useEffect } from 'react';
import { X, FileText, Download } from 'lucide-react';

/**
 * Modal that lets the user pick an as-of-date and download a Statement PDF
 * for a customer. Renders nothing when isOpen=false.
 *
 * Props:
 *   - isOpen: boolean
 *   - onClose: () => void
 *   - customerId: uuid
 *   - customerName: string (for the modal title)
 */
export default function GenerateStatementModal({ isOpen, onClose, customerId, customerName }) {
  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  const [asOfDate, setAsOfDate] = useState(today);

  // Reset on open
  useEffect(() => {
    if (isOpen) setAsOfDate(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const downloadUrl = `/api/tenant/pdf/statement/${customerId}?asOfDate=${asOfDate}`;

  function handleDownload() {
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" strokeWidth={1.75} />
            <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">
              Generate Statement
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
          Generate a Statement of Account for <strong>{customerName}</strong> showing all
          outstanding invoices as of the chosen date.
        </p>

        <label className="block mb-4">
          <span className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1 uppercase tracking-wider">
            As of Date
          </span>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            max={today}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            <Download className="w-4 h-4" strokeWidth={2} />
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
