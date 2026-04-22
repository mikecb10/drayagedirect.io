import React from 'react';
import { Check, AlertCircle, Mail, Download, X, RefreshCw, FileText } from 'lucide-react';

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Bottom-fixed action bar for AR Pipeline bulk selection.
 * Mirrors the Dispatcher board's bottom-bar pattern. Hidden when count === 0.
 *
 * Leaves room in layout for future slots (Send Rate Con → 2a.4b,
 * Invoice [date] → 2a.5) without rendering disabled placeholders today.
 */
export default function BulkActionBar({
  count,
  totalCents,
  bulkAction,         // 'approve' | 'unapprove' | 'approve_invoice' | 'send_rate_con' | null
  onApprove,
  onUnapprove,
  onApproveAndInvoice,
  onSendRateCons,
  onExport,
  onClear,
}) {
  if (count === 0) return null;

  const busy = bulkAction != null;
  const btnBase = 'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const ghostBtn = `${btnBase} bg-slate-700 text-white hover:bg-slate-600`;
  const primaryBtn = `${btnBase} bg-blue-500 text-white hover:bg-blue-600 shadow-sm`;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-slate-950 border border-slate-700 dark:border-slate-800 shadow-xl text-white">
      <div className="inline-flex items-center gap-2 font-semibold text-sm">
        <span className="bg-blue-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full min-w-[24px] text-center">
          {count}
        </span>
        <span className="text-slate-100">selected · {formatCents(totalCents)}</span>
      </div>

      <div className="h-5 w-px bg-slate-700 dark:bg-slate-800" />

      <button type="button" onClick={onApprove} disabled={busy} className={ghostBtn}>
        {bulkAction === 'approve' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        Approve
      </button>

      <button type="button" onClick={onUnapprove} disabled={busy} className={ghostBtn}>
        {bulkAction === 'unapprove' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <AlertCircle className="w-3.5 h-3.5" />}
        Unapprove
      </button>

      <button type="button" onClick={onApproveAndInvoice} disabled={busy} className={primaryBtn}>
        {bulkAction === 'approve_invoice' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
        Approve & Invoice
      </button>

      <button type="button" onClick={onSendRateCons} disabled={busy} className={ghostBtn}>
        {bulkAction === 'send_rate_con' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
        Send Rate Cons
      </button>

      <button type="button" onClick={onExport} disabled={busy} className={ghostBtn}>
        <Download className="w-3.5 h-3.5" />
        Export CSV
      </button>

      <div className="w-px h-5 bg-slate-700 dark:bg-slate-800" />

      <button type="button" onClick={onClear} disabled={busy} className="text-xs text-slate-300 hover:text-white inline-flex items-center gap-0.5 disabled:opacity-50">
        <X className="w-3.5 h-3.5" />
        Clear
      </button>
    </div>
  );
}
