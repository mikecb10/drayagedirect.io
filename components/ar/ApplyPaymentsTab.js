import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import OrgPicker from '../ui/OrgPicker';
import { formatCents } from '../../lib/ar-utils';

/**
 * Apply Payments & Credits tab.
 *
 * Two modes:
 *  - Global overview (no customer picked): shows every unapplied payment
 *    across the tenant grouped by customer, so operators can see what's
 *    outstanding at a glance. Clicking a customer card drills into the
 *    allocation UI for that customer.
 *  - Customer mode: left panel = that customer's unapplied payments,
 *    right panel = their open invoices, inline allocation inputs.
 *
 * A customer-scoped saved filter (filters.customer_ids with one id)
 * auto-populates the picker so the user doesn't have to click twice.
 */
export default function ApplyPaymentsTab({ filters = {} }) {
  const [customerId, setCustomerId] = useState(null);
  const [customerLabel, setCustomerLabel] = useState('');
  const [payments, setPayments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [globalPayments, setGlobalPayments] = useState([]); // all unapplied across tenant (overview mode)
  const [allocations, setAllocations] = useState({}); // { paymentId: { invoiceId: amountCents } }
  // Raw typed string per input, decoupled from cents. Without this, the
  // input's value={.toFixed(2)} snaps back on every keystroke (React
  // controlled-input round-trip) and typing a multi-digit amount is
  // impossible — "500" ends up locked at "5.00".
  const [inputs, setInputs] = useState({}); // { paymentId: { invoiceId: "5.00" } }
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

  // Overview-mode fetch: every unapplied payment across the tenant.
  // No customer_id param → the payments endpoint returns all tenant rows.
  // Reused to render the per-customer summary cards that drill into
  // allocation mode on click.
  async function loadGlobalOverview() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/ar/payments');
      if (res.ok) {
        const d = await res.json();
        setGlobalPayments((d.payments || []).filter((p) => p.unapplied_cents > 0));
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadData(); }, [customerId]);

  // Load the global overview whenever we're in no-customer mode so operators
  // can see what's outstanding across the tenant. Skipped when a customer is
  // active (customer-scoped fetch already covers it).
  useEffect(() => {
    if (!customerId) loadGlobalOverview();
  }, [customerId]);

  // Auto-populate the customer picker when a saved filter scopes to exactly
  // one customer. Empty filters ("All") leaves the picker as-is so operators
  // can still drill in manually from the overview cards. Multi-customer
  // filters don't auto-populate — ambiguous and the overview is more useful.
  useEffect(() => {
    const ids = filters?.customer_ids;
    if (!Array.isArray(ids) || ids.length !== 1) return;
    if (customerId === ids[0]) return;
    setCustomerId(ids[0]);
    setCustomerLabel(''); // OrgPicker will resolve the name lazily
    setAllocations({});
    setInputs({});
  }, [filters]);

  function setAllocation(paymentId, invoiceId, amountStr) {
    const cents = Math.round((parseFloat(amountStr) || 0) * 100);
    setInputs((prev) => ({
      ...prev,
      [paymentId]: { ...(prev[paymentId] || {}), [invoiceId]: amountStr },
    }));
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
      setInputs({});
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
          setInputs({});
        }}
      />

      {!customerId && (
        <GlobalOverview
          payments={globalPayments}
          loading={loading}
          onPick={(cId, cName) => {
            setCustomerId(cId);
            setCustomerLabel(cName);
            setAllocations({});
            setInputs({});
          }}
        />
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
                          value={inputs[p.id]?.[inv.id] ?? ''}
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

/**
 * Tenant-wide overview shown when no customer is picked. Groups unapplied
 * payments by customer so operators can see total outstanding allocation
 * work at a glance. Clicking a card drills into that customer's
 * allocation UI.
 */
function GlobalOverview({ payments, loading, onPick }) {
  if (loading && payments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 p-10 text-center text-sm text-gray-400 dark:text-slate-500">
        Loading unapplied payments…
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 p-10 text-center text-sm text-gray-400 dark:text-slate-500">
        No unapplied payments across any customers. Pick a customer above to start a new allocation.
      </div>
    );
  }

  // Group by customer_id. Payments from the list endpoint include a joined
  // `customer:{id,name}` object; fall back to payment.customer_id when the
  // join missed (orphaned rows shouldn't happen but guard anyway).
  const byCustomer = new Map();
  for (const p of payments) {
    const cid = p.customer?.id ?? p.customer_id;
    if (!cid) continue;
    if (!byCustomer.has(cid)) {
      byCustomer.set(cid, {
        id: cid,
        name: p.customer?.name ?? '(unknown customer)',
        count: 0,
        total_unapplied_cents: 0,
      });
    }
    const c = byCustomer.get(cid);
    c.count += 1;
    c.total_unapplied_cents += (p.unapplied_cents || 0);
  }
  const customers = Array.from(byCustomer.values())
    .sort((a, b) => b.total_unapplied_cents - a.total_unapplied_cents);

  const totalUnapplied = customers.reduce((s, c) => s + c.total_unapplied_cents, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/20 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-blue-900 dark:text-blue-200">
            {customers.length} customer{customers.length !== 1 ? 's' : ''} with unapplied payments
          </div>
          <div className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
            Total unapplied: {formatCents(totalUnapplied)}
          </div>
        </div>
        <div className="text-[11px] text-blue-600 dark:text-blue-400">
          Click a card to allocate, or pick a customer above.
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {customers.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c.id, c.name)}
            className="text-left rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-colors"
          >
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">{c.name}</div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {c.count} payment{c.count !== 1 ? 's' : ''} unapplied
            </div>
            <div className="text-lg font-bold text-amber-600 dark:text-amber-400 mt-2">
              {formatCents(c.total_unapplied_cents)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
