import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import OrgPicker from '../ui/OrgPicker';
import { formatCents } from '../../lib/ar-utils';

/**
 * Apply Payments & Credits tab.
 * Customer picker → left: unapplied payments/credits → right: open invoices
 * User allocates amounts from payments to invoices.
 */
export default function ApplyPaymentsTab() {
  const [customerId, setCustomerId] = useState(null);
  const [customerLabel, setCustomerLabel] = useState('');
  const [payments, setPayments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [allocations, setAllocations] = useState({}); // { paymentId: { invoiceId: amountCents } }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [applying, setApplying] = useState(false);

  async function loadData() {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const [payRes, invRes] = await Promise.all([
        fetch(`/api/tenant/ar/payments?customer_id=${customerId}`),
        fetch(`/api/tenant/ar/invoices?customer_id=${customerId}&status=sent`),
      ]);
      if (payRes.ok) {
        const d = await payRes.json();
        setPayments((d.payments || []).filter((p) => p.unapplied_cents > 0));
      }
      if (invRes.ok) {
        const d = await invRes.json();
        setInvoices((d.invoices || []).filter((i) => i.balance_due_cents > 0));
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadData(); }, [customerId]);

  function setAllocation(paymentId, invoiceId, amountStr) {
    const cents = Math.round((parseFloat(amountStr) || 0) * 100);
    setAllocations((prev) => ({
      ...prev,
      [paymentId]: { ...(prev[paymentId] || {}), [invoiceId]: cents },
    }));
  }

  function getTotalAllocated(paymentId) {
    return Object.values(allocations[paymentId] || {}).reduce((s, v) => s + v, 0);
  }

  async function handleApply() {
    setApplying(true);
    setError(null);
    try {
      for (const [paymentId, invoiceAllocs] of Object.entries(allocations)) {
        const applications = Object.entries(invoiceAllocs)
          .filter(([, cents]) => cents > 0)
          .map(([invoice_id, amount_cents]) => ({ invoice_id, amount_cents }));
        if (applications.length === 0) continue;

        const res = await fetch(`/api/tenant/ar/payments/${paymentId}/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applications }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || 'Failed to apply');
        }
      }
      setAllocations({});
      loadData();
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  }

  const hasAllocations = Object.values(allocations).some((a) =>
    Object.values(a).some((v) => v > 0)
  );

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      <OrgPicker
        label="Select Customer"
        type="customer"
        value={customerId}
        valueLabel={customerLabel}
        onChange={(org) => {
          setCustomerId(org?.id || null);
          setCustomerLabel(org?.name || '');
          setAllocations({});
        }}
      />

      {!customerId && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 p-10 text-center text-sm text-gray-400 dark:text-slate-500">
          Select a customer to see unapplied payments and open invoices.
        </div>
      )}

      {customerId && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left: Unapplied Payments */}
          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Unapplied Payments</div>
            </div>
            {payments.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400 dark:text-slate-500">No unapplied payments</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {payments.map((p) => (
                  <div key={p.id} className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="text-xs font-medium text-gray-900 dark:text-slate-100">
                          {p.reference_number || 'No Ref'} — {(p.payment_method || '').replace('_', ' ')}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-slate-400">
                          {new Date(p.payment_date).toLocaleDateString()} · Unapplied: {formatCents(p.unapplied_cents)}
                        </div>
                      </div>
                      <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{formatCents(p.amount_cents)}</div>
                    </div>
                    {/* Allocation inputs per invoice */}
                    {invoices.map((inv) => (
                      <div key={inv.id} className="flex items-center gap-2 mt-1">
                        <ArrowRight className="w-3 h-3 text-gray-300 dark:text-slate-600 shrink-0" />
                        <span className="text-[11px] text-gray-600 dark:text-slate-400 flex-1 truncate">{inv.invoice_number}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          className="w-24 text-right text-xs px-2 py-1 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100"
                          value={allocations[p.id]?.[inv.id] ? (allocations[p.id][inv.id] / 100).toFixed(2) : ''}
                          onChange={(e) => setAllocation(p.id, inv.id, e.target.value)}
                        />
                      </div>
                    ))}
                    {invoices.length > 0 && (
                      <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 text-right">
                        Allocated: {formatCents(getTotalAllocated(p.id))} / {formatCents(p.unapplied_cents)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Open Invoices */}
          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Open Invoices</div>
            </div>
            {invoices.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400 dark:text-slate-500">No open invoices</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {invoices.map((inv) => (
                  <div key={inv.id} className="p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-mono font-medium text-blue-600 dark:text-blue-400">{inv.invoice_number}</div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400">
                        Due: {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{formatCents(inv.total_amount_cents)}</div>
                      <div className="text-[11px] text-amber-600 dark:text-amber-400">Balance: {formatCents(inv.balance_due_cents)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {hasAllocations && (
        <div className="flex justify-end">
          <Button onClick={handleApply} loading={applying}>Apply Payments</Button>
        </div>
      )}
    </div>
  );
}
