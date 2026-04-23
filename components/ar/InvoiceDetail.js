import { useEffect, useState } from 'react';
import { Download, Mail, RefreshCw, XCircle, ExternalLink, X } from 'lucide-react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import EmailComposeSlideOver from './EmailComposeSlideOver';
import { formatInvoiceNumber } from '../../lib/invoice-utils';
import { useOverlay } from '../../contexts/OverlayContext';

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const STATUS_BADGES = {
  draft: { variant: 'gray', label: 'Draft' },
  sent: { variant: 'blue', label: 'Sent' },
  paid: { variant: 'green', label: 'Paid' },
  overdue: { variant: 'red', label: 'Overdue' },
  void: { variant: 'red', label: 'Void' },
};

/**
 * Invoice detail overlay. Opens via
 *   openOverlay('invoice', { invoiceId: UUID, onClose?: () => void })
 *
 * Shows invoice metadata (Bill To, dates, totals, balance), line items
 * grouped by originating charge set, and actions (Download PDF, Resend,
 * Rebill, Void, Close). Charge set numbers in the grouping header are
 * clickable — clicking opens the source load's Billing tab overlay so
 * operators can drill into the originating charge set from here.
 */
export default function InvoiceDetail({ invoiceId, onClose }) {
  const { openOverlay } = useOverlay();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // 'void' | 'rebill' | null
  const [composeOpen, setComposeOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tenant/ar/invoices/${invoiceId}`);
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;
        setInvoice(data.invoice || null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [invoiceId, reloadTick]);

  async function handleVoid() {
    if (!invoice) return;
    if (!confirm(`Void invoice ${invoice.invoice_number}? This returns its charge sets to "approved" so they can be re-invoiced.`)) return;
    setActionLoading('void');
    setError(null);
    try {
      const res = await fetch(`/api/tenant/ar/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'void' }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to void invoice');
      }
      setReloadTick((t) => t + 1);
    } catch (e) { setError(e.message); }
    finally { setActionLoading(null); }
  }

  async function handleRebill() {
    if (!invoice) return;
    const setCount = invoice.charge_sets?.length ?? 0;
    if (setCount === 0) { setError('No charge sets to rebill'); return; }
    if (!confirm(`Rebill ${setCount} charge set${setCount !== 1 ? 's' : ''} on this invoice? Each will transition to "rebilling" status and can be re-invoiced from the Billing Pipeline.`)) return;
    setActionLoading('rebill');
    setError(null);
    try {
      // Stamp the invoice-level rebill pivot (rebilled_at + rebilled_by)
      // BEFORE transitioning charge sets. If the PUT fails we haven't
      // touched anything downstream yet; if charge-set transitions fail
      // later, the invoice at least records that a rebill was attempted.
      // 409 "already marked" is non-fatal — idempotent behavior on
      // accidental double-clicks.
      const pivotRes = await fetch(`/api/tenant/ar/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_rebilled: true }),
      });
      if (!pivotRes.ok && pivotRes.status !== 409) {
        const b = await pivotRes.json().catch(() => ({}));
        throw new Error(`Failed to mark invoice as rebilled: ${b.error || pivotRes.status}`);
      }

      let failed = 0;
      let firstError = null;
      for (const jc of invoice.charge_sets) {
        const cs = jc.charge_set;
        if (!cs) continue;
        const r = await fetch(`/api/tenant/loads/${cs.order_id}/charge-sets/${cs.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'rebilling' }),
        });
        if (!r.ok) {
          failed++;
          if (!firstError) {
            const b = await r.json().catch(() => ({}));
            firstError = b.error || `HTTP ${r.status}`;
          }
        }
      }
      if (failed > 0) {
        throw new Error(`${failed} charge set${failed !== 1 ? 's' : ''} failed to rebill${firstError ? ` — ${firstError}` : ''}`);
      }
      setReloadTick((t) => t + 1);
    } catch (e) { setError(e.message); }
    finally { setActionLoading(null); }
  }

  function handleDownload() {
    window.open(`/api/tenant/pdf/invoice/${invoiceId}?redirect=1`, '_blank', 'noopener,noreferrer');
  }

  function handleOpenLoad(orderId) {
    if (!orderId) return;
    openOverlay('load', { loadId: orderId, tab: 'billing' });
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400 dark:text-slate-500" />
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <Alert type="error" message={error} />
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => setReloadTick((t) => t + 1)}>Retry</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  if (!invoice) return null;

  const badge = STATUS_BADGES[invoice.status] || STATUS_BADGES.draft;
  const displayNumber = invoice.invoice_number_base && invoice.rebill_count
    ? formatInvoiceNumber(invoice.invoice_number_base, invoice.rebill_count)
    : invoice.invoice_number;

  // Group line items by originating order so each charge set block shows
  // the loads it came from. Line items only carry order_id (not
  // charge_set_id) so orders with multiple charge sets on the same invoice
  // show every set in the header for that group.
  const setsByOrder = new Map();
  for (const jc of invoice.charge_sets || []) {
    const cs = jc.charge_set;
    if (!cs) continue;
    const oid = cs.order_id;
    if (!setsByOrder.has(oid)) setsByOrder.set(oid, []);
    setsByOrder.get(oid).push(cs);
  }
  const itemsByOrder = new Map();
  for (const li of invoice.line_items || []) {
    const oid = li.order_id || '__unassigned__';
    if (!itemsByOrder.has(oid)) itemsByOrder.set(oid, []);
    itemsByOrder.get(oid).push(li);
  }
  // Stable ordering: iterate by sort_order within each group
  for (const arr of itemsByOrder.values()) {
    arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  const balanceDue = invoice.balance_due_cents ?? invoice.total_amount_cents ?? 0;
  const paidCents = (invoice.total_amount_cents ?? 0) - balanceDue;
  const isInvoiced = invoice.status === 'sent' || invoice.status === 'overdue';
  // Lock rule: an invoice with any applied credit memo or any payment
  // application is settled — the GL has moved. Rebill/void would leave
  // books inconsistent. Accountant has to reverse the payment or void
  // the credit memo first before the invoice can be touched.
  const hasAppliedCredit = (invoice.credits || []).some((c) => c.status === 'applied');
  const hasPaymentApplied = (invoice.payments || []).length > 0;
  const invoiceLocked = hasAppliedCredit || hasPaymentApplied;
  const lockReason = hasAppliedCredit && hasPaymentApplied
    ? 'a payment and a credit memo have been applied'
    : hasAppliedCredit
    ? 'a credit memo has been applied'
    : hasPaymentApplied
    ? 'a payment has been applied'
    : null;
  // Buttons render even when locked so the user can see they exist — but
  // disabled, with a tooltip explaining why. Hiding the buttons entirely
  // made the lock invisible; showing them explains the constraint.
  const couldVoid = ['draft', 'sent', 'overdue'].includes(invoice.status);
  const couldRebill = isInvoiced && (invoice.charge_sets?.length ?? 0) > 0;
  const canVoid = couldVoid && !invoiceLocked;
  const canRebill = couldRebill && !invoiceLocked;

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-slate-950">
      {error && (
        <div className="px-6 pt-4">
          <Alert type="error" message={error} onClose={() => setError(null)} />
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-5 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">
                Invoice #{displayNumber}
              </h1>
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {invoice.is_consolidated && (
                <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300">
                  Consolidated
                </span>
              )}
              {invoice.rebill_count > 0 && (
                <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300">
                  Rebill #{invoice.rebill_count}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              {(invoice.charge_sets || []).length} charge set
              {(invoice.charge_sets || []).length !== 1 ? 's' : ''} on this invoice
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              onClick={handleDownload}
              className="!text-xs !py-1.5"
              title="Download invoice PDF"
            >
              <Download className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
              Download
            </Button>
            <Button
              onClick={() => setComposeOpen(true)}
              className="!text-xs !py-1.5"
              title={isInvoiced ? 'Resend invoice email' : 'Send invoice email'}
            >
              <Mail className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
              {isInvoiced ? 'Resend' : 'Send'}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100 dark:border-slate-800">
          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">Bill To</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-0.5">
              {invoice.customer?.name || '—'}
            </div>
            {invoice.customer?.billing_email && (
              <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                {invoice.customer.billing_email}
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">Invoice Date</div>
            <div className="text-sm text-gray-900 dark:text-slate-100 mt-0.5">
              {invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : '—'}
            </div>
            {invoice.rebilled_at && (
              <div
                className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 font-medium"
                title={`Rebill pivot: invoice was marked for rebill by ${invoice.rebilled_by?.name || 'a user'} on ${new Date(invoice.rebilled_at).toLocaleString()}. Charge sets transitioned to 'rebilling' status and are re-invoiceable from the Billing Pipeline.`}
              >
                ⟳ Rebilled {new Date(invoice.rebilled_at).toLocaleDateString()}
                {invoice.rebilled_by?.name ? ` by ${invoice.rebilled_by.name}` : ''}
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">Due Date</div>
            <div className="text-sm text-gray-900 dark:text-slate-100 mt-0.5">
              {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">Terms</div>
            <div className="text-sm text-gray-900 dark:text-slate-100 mt-0.5">
              {invoice.payment_terms || 'Net 30'}
            </div>
          </div>
        </div>

        {/* Totals strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100 dark:border-slate-800">
          <Metric label="Invoice Total" value={formatCents(invoice.total_amount_cents)} />
          <Metric
            label="Payment Applied"
            value={formatCents(paidCents)}
            color={paidCents > 0 ? 'emerald' : 'gray'}
          />
          <Metric
            label="Credit Applied"
            value={formatCents((invoice.credits || []).reduce((s, c) => s + (c.amount_cents || 0), 0))}
            color="blue"
          />
          <Metric
            label="Balance Due"
            value={formatCents(balanceDue)}
            color={balanceDue > 0 ? 'amber' : 'emerald'}
          />
        </div>
      </div>

      {/* Line items body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {Array.from(setsByOrder.entries()).map(([orderId, sets]) => {
          const items = itemsByOrder.get(orderId) || [];
          const orderNumber = sets[0]?.order?.order_number;
          return (
            <div key={orderId} className="mb-5 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 dark:bg-slate-800/40 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleOpenLoad(orderId)}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 inline-flex items-center gap-1"
                >
                  Load {orderNumber || orderId?.slice(0, 8)}
                  <ExternalLink className="w-3 h-3" />
                </button>
                <span className="text-[10px] text-gray-400 dark:text-slate-600">·</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400 font-semibold">
                    Charge Set{sets.length > 1 ? 's' : ''}
                  </span>
                  {sets.map((cs) => (
                    <button
                      key={cs.id}
                      type="button"
                      onClick={() => handleOpenLoad(cs.order_id)}
                      className="font-mono text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      title="Open load's Billing tab"
                    >
                      {cs.charge_set_number}
                    </button>
                  ))}
                </div>
              </div>
              {items.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-slate-500">
                  No line items for this charge set.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-slate-800 text-gray-500 dark:text-slate-400">
                        <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wide font-semibold">Charge Code / Description</th>
                        <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wide font-semibold">Units</th>
                        <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wide font-semibold">Rate</th>
                        <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wide font-semibold">Charges</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {items.map((li) => (
                        <tr key={li.id}>
                          <td className="px-4 py-2 text-gray-900 dark:text-slate-100">
                            <div className="text-xs font-medium">{li.description}</div>
                            {li.charge_type && li.charge_type !== 'linehaul' && (
                              <div className="text-[10px] text-gray-500 dark:text-slate-400 uppercase tracking-wide mt-0.5">
                                {li.charge_type}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-gray-700 dark:text-slate-300">
                            {li.quantity ?? 1}
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-gray-700 dark:text-slate-300">
                            {formatCents(li.unit_amount_cents)}
                          </td>
                          <td className="px-4 py-2 text-right text-xs font-semibold text-gray-900 dark:text-slate-100">
                            {formatCents(li.total_amount_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

        {invoice.notes && (
          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1">
              Internal Notes
            </div>
            <div className="text-xs text-gray-700 dark:text-slate-300 whitespace-pre-wrap">
              {invoice.notes}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-6 py-3 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {couldVoid && (
            <Button
              variant="secondary"
              onClick={handleVoid}
              loading={actionLoading === 'void'}
              disabled={actionLoading != null || !canVoid}
              title={!canVoid && invoiceLocked ? `Cannot void — ${lockReason} to this invoice.` : undefined}
              className="!text-xs !py-1.5 !text-red-500 dark:!text-red-400 !border-red-200 dark:!border-red-800 hover:!bg-red-50 dark:hover:!bg-red-950/40"
            >
              <XCircle className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
              Void
            </Button>
          )}
          {couldRebill && (
            <Button
              variant="secondary"
              onClick={handleRebill}
              loading={actionLoading === 'rebill'}
              disabled={actionLoading != null || !canRebill}
              title={!canRebill && invoiceLocked ? `Cannot rebill — ${lockReason} to this invoice.` : undefined}
              className="!text-xs !py-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
              Rebill
            </Button>
          )}
          {invoiceLocked && (
            <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium inline-flex items-center gap-1">
              <span aria-hidden>🔒</span>
              Locked — {lockReason}
            </span>
          )}
        </div>
        <Button variant="secondary" onClick={onClose} className="!text-xs !py-1.5">Close</Button>
      </div>

      {/* Email compose — reuses the existing AR invoice email flow. */}
      <EmailComposeSlideOver
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        docType="invoice"
        contextId={invoiceId}
        onSent={() => { setComposeOpen(false); setReloadTick((t) => t + 1); }}
        onSkipped={() => setComposeOpen(false)}
      />
    </div>
  );
}

function Metric({ label, value, color = 'gray' }) {
  const colorMap = {
    gray:    'text-gray-900 dark:text-slate-100',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber:   'text-amber-600 dark:text-amber-400',
    blue:    'text-blue-600 dark:text-blue-400',
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`text-base font-bold mt-0.5 ${colorMap[color] || colorMap.gray}`}>
        {value}
      </div>
    </div>
  );
}
