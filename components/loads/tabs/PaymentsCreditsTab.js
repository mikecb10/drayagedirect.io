import { useEffect, useState } from 'react';
import { CreditCard, FileText, ExternalLink } from 'lucide-react';

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const METHOD_LABELS = {
  check: 'Check', ach: 'ACH', wire: 'Wire',
  credit_card: 'Credit Card', cash: 'Cash', other: 'Other',
};

/**
 * Payments & Credits tab on the load detail overlay.
 *
 * Walks the load → charge_sets → invoices → payment_applications chain
 * server-side (GET /api/tenant/loads/[id]/payments) and renders each
 * application as a row. Supporting document (if uploaded on the payment)
 * is surfaced as a clickable icon that opens the signed URL in a new tab.
 */
export default function PaymentsCreditsTab({ load }) {
  const [applications, setApplications] = useState([]);
  const [totalAppliedCents, setTotalAppliedCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!load?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tenant/loads/${load.id}/payments`);
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;
        setApplications(data.applications || []);
        setTotalAppliedCents(data.total_applied_cents || 0);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load?.id, reloadTick]);

  if (loading) {
    return (
      <div className="py-20 text-center text-gray-400 dark:text-slate-500 text-sm">Loading payments…</div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
        <span>{error}</span>
        <button
          type="button"
          onClick={() => setReloadTick((t) => t + 1)}
          className="shrink-0 text-xs font-semibold text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 px-2 py-1 rounded border border-red-300 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-950/40"
        >
          Retry
        </button>
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="py-16 text-center">
        <CreditCard className="w-10 h-10 text-gray-300 dark:text-slate-700 mx-auto mb-3" />
        <div className="text-sm text-gray-500 dark:text-slate-400">No payments applied to this load yet.</div>
        <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">
          Payments applied via AR → Apply Payments &amp; Credits will surface here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-semibold">
          Total Applied
        </div>
        <div className="text-2xl font-bold text-emerald-900 dark:text-emerald-200 mt-0.5">
          {formatCents(totalAppliedCents)}
        </div>
        {(() => {
          const invoiceCount = new Set(applications.map((a) => a.invoice_id)).size;
          return (
            <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
              {applications.length} application{applications.length !== 1 ? 's' : ''} across{' '}
              {invoiceCount} invoice{invoiceCount !== 1 ? 's' : ''}
            </div>
          );
        })()}
      </div>

      {/* Applications list */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-gray-100 dark:divide-slate-800">
        {applications.map((a) => {
          const p = a.payment;
          const method = p?.payment_method ? (METHOD_LABELS[p.payment_method] || p.payment_method) : '—';
          const paymentDate = p?.payment_date ? new Date(p.payment_date).toLocaleDateString() : '—';
          const appliedDate = a.applied_at ? new Date(a.applied_at).toLocaleDateString() : '—';
          // Split-billing: if this load's share of the invoice is less than
          // 100%, the display amount is proportional, not the full
          // application. Show both so the operator knows this is a shared
          // payment, not the literal applied total.
          const isSplit = a.share != null && a.share < 0.999;
          const sharePct = Math.round((a.share ?? 1) * 1000) / 10; // one decimal
          return (
            <div key={a.application_id} className="px-4 py-3 flex items-start gap-3">
              <div className="w-8 h-8 shrink-0 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                    {formatCents(a.amount_cents)}
                  </span>
                  {isSplit && (
                    <span
                      title={`This load's share: ${sharePct}% of invoice total. Full payment applied to invoice: ${formatCents(a.full_application_cents)}`}
                      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300"
                    >
                      {sharePct}% share
                    </span>
                  )}
                  <span className="text-xs text-gray-500 dark:text-slate-400">
                    applied to invoice
                  </span>
                  <span className="font-mono text-xs font-medium text-blue-600 dark:text-blue-400">
                    {a.invoice_number || '—'}
                  </span>
                  {p?.document_url && (
                    <a
                      href={`/api/tenant/ar/payments/${p.id}/document?redirect=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={p.document_filename || 'Supporting document'}
                      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40"
                    >
                      <FileText className="w-3 h-3" />
                      Doc
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400 flex items-center gap-3 flex-wrap">
                  <span>{method}{p?.reference_number ? ` · ${p.reference_number}` : ''}</span>
                  <span>Paid: {paymentDate}</span>
                  <span>Applied: {appliedDate}</span>
                  {p?.customer?.name && <span className="truncate">From: {p.customer.name}</span>}
                  {isSplit && (
                    <span className="text-purple-600 dark:text-purple-400">
                      Invoice spans multiple loads · Full applied: {formatCents(a.full_application_cents)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
