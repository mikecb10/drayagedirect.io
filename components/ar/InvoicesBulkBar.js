import React from 'react';
import { Mail, X, RefreshCw } from 'lucide-react';

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Focused bulk bar for the Invoices tab. Offers a single action: bulk resend
 * already-sent invoices. Kept separate from the Pipeline tab's BulkActionBar
 * (which carries 5 actions for its multi-status pipeline) so neither caller
 * has to deal with irrelevant buttons or status-based visibility flags.
 *
 * Visual parity with BulkActionBar: same fixed bottom slide-up, same button
 * styling tokens.
 */
export default function InvoicesBulkBar({
  count,
  totalCents,
  bulkAction,      // 'resend' | null
  onResend,
  onClear,
}) {
  if (count === 0) return null;

  const busy = bulkAction != null;
  const btnBase = 'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
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

      <button type="button" onClick={onResend} disabled={busy} className={primaryBtn}>
        {bulkAction === 'resend' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
        Resend
      </button>

      <div className="w-px h-5 bg-slate-700 dark:bg-slate-800" />

      <button type="button" onClick={onClear} disabled={busy} className="text-xs text-slate-300 hover:text-white inline-flex items-center gap-0.5 disabled:opacity-50">
        <X className="w-3.5 h-3.5" />
        Clear
      </button>
    </div>
  );
}
