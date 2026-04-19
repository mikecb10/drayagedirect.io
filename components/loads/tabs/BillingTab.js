import { useEffect, useRef, useState } from 'react';
import { Plus, Receipt, Trash2, Check, FileText, DollarSign, RefreshCw, ExternalLink, Tag, Link2 } from 'lucide-react';
import { CHARGE_NAMES, UNITS_OF_MEASURE } from '../../../lib/charge-profile-constants';
import { useOverlay } from '../../../contexts/OverlayContext';
import { formatInvoiceNumber } from '../../../lib/invoice-utils';
import Alert from '../../ui/Alert';
import Button from '../../ui/Button';
import OrgPicker from '../../ui/OrgPicker';
import CurrencyInput from '../../ui/CurrencyInput';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import EmailComposeSlideOver from '../../ar/EmailComposeSlideOver';
import { useEmailCompose } from '../../../hooks/useEmailCompose';

const STATUS_STYLES = {
  draft: 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200',
  rate_con_sent: 'bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300',
  unapproved: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  approved: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
  invoiced: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
  billed: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
  rebilling: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300',
  void: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300',
};

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Find a base line item matching a charge code (e.g. 'LINE_HAUL').
 * Matches against the line item's name, description, and source_profile_id
 * via multiple code conventions (raw code, spaced, display label).
 */
function findBaseLineItem(lineItems, basedOn) {
  if (!basedOn || !lineItems) return null;
  const label = CHARGE_NAMES.find((c) => c.value === basedOn)?.label || '';
  const labelUp = label.toUpperCase();
  const codeUp = basedOn.toUpperCase(); // e.g. 'LINE_HAUL'
  const codeSpacedUp = basedOn.replace(/_/g, ' ').toUpperCase(); // e.g. 'LINE HAUL'

  return lineItems.find((li) => {
    const name = (li.name || '').toUpperCase();
    const desc = (li.description || '').toUpperCase();
    return (
      (label && (name === labelUp || name.includes(labelUp) || desc.includes(labelUp))) ||
      name.includes(codeUp) ||
      desc.includes(codeUp) ||
      name.includes(codeSpacedUp) ||
      desc.includes(codeSpacedUp)
    );
  }) || null;
}

function computePercentageAmount(lineItems, basedOn, pctValue) {
  const baseItem = findBaseLineItem(lineItems, basedOn);
  if (!baseItem) return 0;
  const baseCents = baseItem.total_cents || baseItem.per_unit_price_cents || 0;
  const pct = parseFloat(pctValue) || 0;
  return Math.round((baseCents * pct) / 100);
}

export default function BillingTab({ load }) {
  const { openOverlay } = useOverlay();
  const [chargeSets, setChargeSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcSuccess, setRecalcSuccess] = useState(null);

  async function fetchChargeSets({ silent = false } = {}) {
    if (!load?.id) return;
    // silent=true skips the loading spinner so ChargeSetCard instances stay
    // mounted across the refetch. Callers that need to preserve per-card
    // hook state (e.g. the Approve & Invoice flow, which sets
    // emailCompose.isOpen=true after onChanged() returns) pass silent=true.
    // Without this, the loading spinner replaces the card tree, every
    // ChargeSetCard unmounts, and the subsequent emailCompose.open() call
    // lands on a dead hook instance — drawer never renders.
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/charge-sets`);
      if (!res.ok) throw new Error('Failed to load charge sets');
      const data = await res.json();
      setChargeSets(data.charge_sets || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchChargeSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load?.id]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/charge-sets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_to_customer_id: load.customer_id }),
      });
      if (!res.ok) throw new Error('Failed to create charge set');
      await fetchChargeSets();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRecalculate() {
    setRecalculating(true);
    setError(null);
    setRecalcSuccess(null);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/recalculate-charges`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to recalculate');
      }
      const data = await res.json();
      setRecalcSuccess(`Recalculated — ${data.applied || 0} charge${data.applied !== 1 ? 's' : ''} applied from matching tariffs.`);
      await fetchChargeSets();
    } catch (e) {
      setError(e.message);
    } finally {
      setRecalculating(false);
      setTimeout(() => setRecalcSuccess(null), 5000);
    }
  }

  const grandTotal = chargeSets.reduce((sum, cs) => sum + (cs.total_cents || 0), 0);

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} />}

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          label="Charge Sets"
          value={chargeSets.length}
          icon={Receipt}
          color="blue"
        />
        <SummaryCard
          label="Unapproved"
          value={chargeSets.filter((c) => c.status === 'unapproved' || c.status === 'draft').length}
          icon={FileText}
          color="gray"
        />
        <SummaryCard
          label="Approved"
          value={chargeSets.filter((c) => c.status === 'approved').length}
          icon={Check}
          color="blue"
        />
        <SummaryCard
          label="Invoiced"
          value={chargeSets.filter((c) => c.status === 'invoiced' || c.status === 'billed').length}
          icon={FileText}
          color="emerald"
        />
        <SummaryCard
          label="Grand Total"
          value={formatCents(grandTotal)}
          icon={DollarSign}
          color="purple"
        />
      </div>

      {/* Action buttons + tariff link */}
      {recalcSuccess && <Alert type="success" message={recalcSuccess} />}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={handleRecalculate} loading={recalculating}>
            <RefreshCw className={`w-4 h-4 inline -mt-0.5 mr-1 ${recalculating ? 'animate-spin' : ''}`} />
            Recalculate Rates
          </Button>
          {/* Show which tariff(s) were used */}
          {(() => {
            // Collect unique tariffs with their IDs from auto-applied line items
            const tariffs = new Map();
            for (const cs of chargeSets) {
              for (const li of cs.line_items || []) {
                if (li.is_auto && li.description) {
                  const match = li.description.match(/\(via (.+)\)/);
                  if (match) {
                    const name = match[1];
                    if (!tariffs.has(name)) {
                      tariffs.set(name, li.source_tariff_id || null);
                    }
                  }
                }
              }
            }
            if (tariffs.size === 0) return null;
            return [...tariffs.entries()].map(([name, tid]) => (
              <button key={name} type="button"
                onClick={() => tid && openOverlay('tariff', { tariffId: tid })}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer">
                <Tag className="w-3 h-3" />
                {name}
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            ));
          })()}
        </div>
        <Button onClick={handleCreate} loading={creating}>
          <Plus className="w-4 h-4 inline -mt-0.5 mr-1" />
          New Charge Set
        </Button>
      </div>

      {/* Charge sets */}
      {loading ? (
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
          Loading charge sets...
        </div>
      ) : chargeSets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 py-10 text-center">
          <Receipt className="w-8 h-8 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
          <div className="text-body font-medium text-muted">No charge sets yet</div>
          <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            Create a charge set to invoice this load.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {chargeSets.map((cs) => (
            <ChargeSetCard
              key={cs.id}
              loadId={load.id}
              chargeSet={cs}
              onChanged={fetchChargeSets}
              onError={setError}
              openOverlay={openOverlay}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, color }) {
  const colors = {
    blue: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400',
    gray: 'bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-300',
    purple: 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400',
  };
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="flex items-start gap-2">
        <div className={`rounded-lg p-1.5 ${colors[color]}`}>
          <Icon className="w-4 h-4" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
          <div className="text-lg font-semibold text-strong">{value}</div>
        </div>
      </div>
    </div>
  );
}

function ChargeSetCard({ loadId, chargeSet, onChanged, onError, openOverlay }) {
  const [adding, setAdding] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const emailCompose = useEmailCompose();
  const [newLine, setNewLine] = useState({
    name: '',
    charge_name: '',
    description: '',
    unit_of_measure: 'fixed',
    unit_count: 1,
    free_units: 0,
    per_unit_price_cents: null,
    percentage_value: '',
    percentage_based_on: '',
  });
  const [newLineSource, setNewLineSource] = useState(null);
  const [newLineEdited, setNewLineEdited] = useState(false);
  const abortRef = useRef(null);

  async function saveBillTo(newCustomerId) {
    try {
      const res = await fetch(
        `/api/tenant/loads/${loadId}/charge-sets/${chargeSet.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bill_to_customer_id: newCustomerId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to update Bill To');
      }
      // Refetch so the nested `bill_to` object refreshes alongside the id
      await onChanged();
    } catch (e) {
      onError(e.message);
    }
  }

  async function updateStatus(nextStatus) {
    setSavingStatus(true);
    try {
      // Transitioning to 'invoiced' goes through the AR module endpoint so
      // a proper `invoices` row + `invoice_charge_sets` junction get created
      // (not just an invoice_number_base on the charge set). A bare charge-set
      // PUT to { status: 'invoiced' } creates a "ghost invoice" the /ar module
      // can't see — downstream payments/credits have nothing to link to.
      //
      // If the charge set isn't approved yet, promote it first. The /ar/invoices
      // endpoint rejects non-approved/non-invoiced input.
      if (nextStatus === 'invoiced' && chargeSet.status !== 'invoiced') {
        if (chargeSet.status !== 'approved') {
          const approveRes = await fetch(
            `/api/tenant/loads/${loadId}/charge-sets/${chargeSet.id}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'approved' }),
            }
          );
          if (!approveRes.ok) {
            const body = await approveRes.json().catch(() => ({}));
            throw new Error(body.error || 'Failed to approve charge set');
          }
        }

        const invoiceRes = await fetch('/api/tenant/ar/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charge_set_ids: [chargeSet.id] }),
        });
        if (!invoiceRes.ok) {
          const body = await invoiceRes.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to create invoice');
        }
        const invoiceData = await invoiceRes.json();
        const newInvoiceId = invoiceData.invoice?.id;
        // silent refetch: keeps this ChargeSetCard mounted across the
        // refetch so the emailCompose hook state survives until we open
        // the drawer on the next line. Without silent, the parent's
        // loading spinner would replace the card tree mid-flow and the
        // open() call would land on a fresh, unmounted hook.
        await onChanged({ silent: true });
        if (newInvoiceId) {
          emailCompose.open('invoice', newInvoiceId);
        }
        return; // skip the generic onChanged() below — already called above
      } else {
        const res = await fetch(
          `/api/tenant/loads/${loadId}/charge-sets/${chargeSet.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to update status');
        }
      }
      await onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setSavingStatus(false);
    }
  }

  function updateNewLine(patch) {
    setNewLine((prev) => ({ ...prev, ...patch }));
    if (newLineSource && !newLineEdited) setNewLineEdited(true);
  }

  async function addLineItem() {
    if (!newLine.name.trim()) {
      onError('Line item name is required');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(
        `/api/tenant/loads/${loadId}/charge-sets/${chargeSet.id}/line-items`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...newLine,
            source_profile_id: newLineSource?.profileId || null,
          }),
        }
      );
      if (!res.ok) throw new Error('Failed to add line item');
      setNewLine({
        name: '',
        charge_name: '',
        description: '',
        unit_of_measure: 'fixed',
        unit_count: 1,
        free_units: 0,
        per_unit_price_cents: null,
        percentage_value: '',
        percentage_based_on: '',
      });
      setNewLineSource(null);
      setNewLineEdited(false);
      await onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function updateLineItem(lineId, patch) {
    try {
      const res = await fetch(
        `/api/tenant/loads/${loadId}/charge-sets/${chargeSet.id}/line-items`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ line_item_id: lineId, ...patch }),
        }
      );
      if (!res.ok) throw new Error('Failed to update line item');
      await onChanged();
    } catch (e) {
      onError(e.message);
    }
  }

  async function deleteLineItem(lineId) {
    if (!confirm('Delete this line item?')) return;
    try {
      const res = await fetch(
        `/api/tenant/loads/${loadId}/charge-sets/${chargeSet.id}/line-items?line_item_id=${lineId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Failed to delete line');
      await onChanged();
    } catch (e) {
      onError(e.message);
    }
  }

  async function deleteChargeSet() {
    if (!confirm(`Delete charge set ${chargeSet.charge_set_number}?`)) return;
    try {
      const res = await fetch(
        `/api/tenant/loads/${loadId}/charge-sets/${chargeSet.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Failed to delete charge set');
      await onChanged();
    } catch (e) {
      onError(e.message);
    }
  }

  const isEditable = chargeSet.status === 'draft' || chargeSet.status === 'unapproved';

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Bill To row — dispatcher can pick which customer this charge set is billed to */}
      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900">
        <OrgPicker
          label="Bill To"
          type="customer"
          value={chargeSet.bill_to_customer_id}
          valueLabel={chargeSet.bill_to?.name}
          onChange={(org) => saveBillTo(org?.id || null)}
          placeholder="Select customer..."
        />
      </div>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-strong">
              {chargeSet.charge_set_number}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${
                STATUS_STYLES[chargeSet.status] || STATUS_STYLES.draft
              }`}
            >
              {chargeSet.status}
            </span>
          </div>
          {/* QuickBooks-compatible invoice number (shown once assigned) */}
          {chargeSet.invoice_number_base && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] text-gray-500 dark:text-slate-400">Invoice #:</span>
              <span className="font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                {formatInvoiceNumber(chargeSet.invoice_number_base, chargeSet.rebill_count)}
              </span>
              {chargeSet.rebill_count > 0 && (
                <span className="text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300">
                  Rebill #{chargeSet.rebill_count}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[11px] text-gray-500 dark:text-slate-400">Total</div>
          <div className="text-sm font-semibold text-strong">
            {formatCents(chargeSet.total_cents)}
          </div>
        </div>
        <button
          onClick={deleteChargeSet}
          className="text-gray-300 dark:text-slate-600 hover:text-red-500 ml-2"
          title="Delete charge set"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Line items table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900 text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">
            <tr>
              <th className="text-center px-2 py-2 w-8">Src</th>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Description</th>
              <th className="text-left px-4 py-2">UOM</th>
              <th className="text-right px-4 py-2">Qty</th>
              <th className="text-right px-4 py-2">Free</th>
              <th className="text-right px-4 py-2">Rate</th>
              <th className="text-right px-4 py-2">Total</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {(chargeSet.line_items || []).length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-xs text-gray-400 dark:text-slate-500 italic">
                  No line items yet
                </td>
              </tr>
            )}
            {(chargeSet.line_items || []).map((li) => (
              <EditableLineRow
                key={li.id}
                li={li}
                isEditable={isEditable}
                onUpdate={(patch) => updateLineItem(li.id, patch)}
                onDelete={() => deleteLineItem(li.id)}
                formatCents={formatCents}
                openOverlay={openOverlay}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Add line form */}
      {isEditable && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 space-y-2">
          {newLineSource && (
            <div className="flex items-center gap-1.5 text-[11px] text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 rounded px-2 py-1 mb-2 border border-blue-200 dark:border-blue-900/60 w-fit">
              <Link2 className="w-3 h-3" />
              From <span className="font-semibold">{newLineSource.profileName}</span>
              {newLineEdited && <span className="text-amber-600 dark:text-amber-400">· edited</span>}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            {/* Charge Code dropdown */}
            <div className="sm:col-span-2">
              <label className="block text-field-label text-muted mb-[var(--space-field-label)]">Charge Code</label>
              <select
                value={newLine.charge_name}
                onChange={async (e) => {
                  const code = e.target.value;
                  const label = CHARGE_NAMES.find((c) => c.value === code)?.label || code;

                  // Picking a code is a full reset: any fields typed before the pick
                  // may be overwritten by prefill, and the badge clears optimistically.
                  abortRef.current?.abort();
                  setNewLineSource(null);
                  setNewLineEdited(false);
                  setNewLine((prev) => ({ ...prev, charge_name: code, name: label }));

                  if (!code) return;

                  const ac = new AbortController();
                  abortRef.current = ac;
                  try {
                    const res = await fetch(
                      `/api/tenant/loads/${loadId}/charge-profile-preview?charge_name=${encodeURIComponent(code)}`,
                      { signal: ac.signal }
                    );
                    if (res.ok) {
                      const p = await res.json();
                      setNewLine({
                        charge_name: p.charge_name,
                        name: p.name,
                        description: p.description || '',
                        unit_of_measure: p.unit_of_measure,
                        unit_count: p.unit_count ?? 1,
                        free_units: p.free_units ?? 0,
                        per_unit_price_cents: p.per_unit_price_cents ?? null,
                        percentage_value: p.percentage_value ?? '',
                        percentage_based_on: p.percentage_based_on ?? '',
                      });
                      setNewLineSource({
                        profileId: p.source_profile_id,
                        profileName: p.profile_name,
                      });
                    }
                    // On 404 or other non-200, leave newLine at the code+label only.
                  } catch (err) {
                    if (err.name !== 'AbortError') {
                      console.warn('[billing] charge-profile-preview fetch failed:', err.message);
                    }
                  }
                }}
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              >
                <option value="">Select charge code...</option>
                {CHARGE_NAMES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            {/* UOM */}
            <div>
              <label className="block text-field-label text-muted mb-[var(--space-field-label)]">UOM</label>
              <select
                value={newLine.unit_of_measure}
                onChange={(e) => updateNewLine({ unit_of_measure: e.target.value })}
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              >
                {UNITS_OF_MEASURE.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
            {/* Qty */}
            <Input
              label="Qty"
              type="number"
              value={newLine.unit_count}
              onChange={(e) => updateNewLine({ unit_count: parseFloat(e.target.value) || 0 })}
            />
            {/* Rate — or Percentage fields */}
            {newLine.unit_of_measure === 'percentage' ? (
              <>
                <div>
                  <label className="block text-field-label text-muted mb-[var(--space-field-label)]">% Value</label>
                  <input type="number" step="0.01" value={newLine.percentage_value}
                    onChange={(e) => {
                      const pctValue = e.target.value;
                      const calculatedCents = newLine.percentage_based_on
                        ? computePercentageAmount(chargeSet.line_items, newLine.percentage_based_on, pctValue)
                        : newLine.per_unit_price_cents;
                      updateNewLine({ percentage_value: pctValue, per_unit_price_cents: calculatedCents });
                    }}
                    placeholder="15"
                    className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40" />
                </div>
                <div className="flex items-end">
                  <Button type="button" onClick={addLineItem} loading={adding} className="w-full">
                    <Plus className="w-4 h-4 inline -mt-0.5" />
                  </Button>
                </div>
              </>
            ) : (
              <>
                <CurrencyInput
                  label="Rate"
                  valueCents={newLine.per_unit_price_cents}
                  onChangeCents={(v) => updateNewLine({ per_unit_price_cents: v })}
                />
                <div className="flex items-end">
                  <Button type="button" onClick={addLineItem} loading={adding} className="w-full">
                    <Plus className="w-4 h-4 inline -mt-0.5" />
                  </Button>
                </div>
              </>
            )}
          </div>
          {/* Description — optional, always visible */}
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            <div className="sm:col-span-6">
              <label className="block text-field-label text-muted mb-[var(--space-field-label)]">
                Description <span className="text-gray-400 dark:text-slate-500 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={newLine.description}
                onChange={(e) => updateNewLine({ description: e.target.value })}
                placeholder="Add a note for this charge (shown on the invoice)"
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              />
            </div>
          </div>
          {/* Percentage Based On — only when UOM is percentage */}
          {newLine.unit_of_measure === 'percentage' && (
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
              <div className="sm:col-span-3">
                <label className="block text-field-label text-muted mb-[var(--space-field-label)]">Percentage Based On</label>
                <select
                  value={newLine.percentage_based_on}
                  onChange={(e) => {
                    const basedOn = e.target.value;
                    const calculatedCents = computePercentageAmount(
                      chargeSet.line_items,
                      basedOn,
                      newLine.percentage_value
                    );
                    updateNewLine({ percentage_based_on: basedOn, per_unit_price_cents: calculatedCents });
                  }}
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                >
                  <option value="">Select charge to base on...</option>
                  {CHARGE_NAMES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              {newLine.per_unit_price_cents > 0 && (
                <div className="sm:col-span-3 flex items-end">
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300 w-full">
                    <strong>Calculated:</strong> {newLine.percentage_value}% = {formatCents(newLine.per_unit_price_cents)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Workflow buttons — AR billing flow */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800 flex flex-wrap gap-2 justify-between items-center">
        {/* Right: Status workflow buttons — always show core AR actions */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Pre-invoice statuses: show all progression buttons */}
          {['draft', 'rate_con_sent', 'unapproved', 'approved'].includes(chargeSet.status) && (
            <>
              {/* Rate Con Sent */}
              {chargeSet.status !== 'rate_con_sent' && (
                <Button variant="secondary" onClick={() => emailCompose.open('rate_con', chargeSet.id)} loading={savingStatus}
                  className="!text-xs !py-1.5 !text-cyan-600 dark:!text-cyan-400 !border-cyan-200 dark:!border-cyan-800 hover:!bg-cyan-50 dark:hover:!bg-cyan-950/40">
                  <FileText className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                  Send Rate Con
                </Button>
              )}
              {chargeSet.status === 'rate_con_sent' && (
                <span className="text-[10px] text-cyan-700 dark:text-cyan-300 font-semibold bg-cyan-100 dark:bg-cyan-950/40 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Rate Con Sent
                </span>
              )}

              {/* Unapproved */}
              {chargeSet.status !== 'unapproved' ? (
                <Button variant="secondary" onClick={() => updateStatus('unapproved')} loading={savingStatus}
                  className="!text-xs !py-1.5">
                  Unapproved
                </Button>
              ) : (
                <span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold bg-amber-100 dark:bg-amber-950/40 px-2.5 py-1 rounded-full">
                  Unapproved
                </span>
              )}

              {/* Approved */}
              {chargeSet.status !== 'approved' ? (
                <Button variant="secondary" onClick={() => updateStatus('approved')} loading={savingStatus}
                  className="!text-xs !py-1.5">
                  <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                  Approve
                </Button>
              ) : (
                <span className="text-[10px] text-blue-700 dark:text-blue-300 font-semibold bg-blue-100 dark:bg-blue-950/40 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" /> Approved
                </span>
              )}

              {/* Approve & Invoice */}
              <Button onClick={() => updateStatus('invoiced')} loading={savingStatus}
                className="!text-xs !py-1.5 !bg-emerald-600 hover:!bg-emerald-700">
                <FileText className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                Approve & Invoice
              </Button>
            </>
          )}

          {/* INVOICED */}
          {(chargeSet.status === 'invoiced' || chargeSet.status === 'billed') && (
            <>
              <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold bg-emerald-100 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full flex items-center gap-1">
                <Check className="w-3 h-3" /> Invoiced
              </span>
              <Button variant="secondary" onClick={() => updateStatus('rebilling')} loading={savingStatus}
                className="!text-xs !py-1.5">
                Rebill
              </Button>
              <Button variant="secondary" onClick={() => {
                if (confirm('Void this charge set? This will remove it from the invoice.')) updateStatus('void');
              }} loading={savingStatus}
                className="!text-xs !py-1.5 !text-red-500 dark:!text-red-400 !border-red-200 dark:!border-red-800 hover:!bg-red-50 dark:hover:!bg-red-950/40">
                Void
              </Button>
            </>
          )}

          {/* REBILLING */}
          {chargeSet.status === 'rebilling' && (
            <>
              <span className="text-[10px] text-purple-700 dark:text-purple-300 font-semibold bg-purple-100 dark:bg-purple-950/40 px-2.5 py-1 rounded-full">
                Rebilling
              </span>
              <Button variant="secondary" onClick={() => updateStatus('approved')} loading={savingStatus}
                className="!text-xs !py-1.5">
                Back to Approved
              </Button>
              <Button onClick={() => updateStatus('invoiced')} loading={savingStatus}
                className="!text-xs !py-1.5 !bg-emerald-600 hover:!bg-emerald-700">
                <FileText className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                Re-Invoice
              </Button>
            </>
          )}

          {/* VOID */}
          {chargeSet.status === 'void' && (
            <>
              <span className="text-[10px] text-red-700 dark:text-red-300 font-semibold bg-red-100 dark:bg-red-950/40 px-2.5 py-1 rounded-full">
                Voided
              </span>
              <Button variant="secondary" onClick={() => updateStatus('draft')} loading={savingStatus}
                className="!text-xs !py-1.5">
                Reopen as Draft
              </Button>
            </>
          )}
        </div>
      </div>

      <EmailComposeSlideOver
        open={emailCompose.isOpen}
        onClose={emailCompose.close}
        docType={emailCompose.docType}
        contextId={emailCompose.contextId}
        onSent={() => onChanged()}
        onSkipped={() => onChanged()}
      />
    </div>
  );
}

/**
 * EditableLineRow — click a cell to edit inline, save on blur.
 */
function EditableLineRow({ li, isEditable, onUpdate, onDelete, formatCents, openOverlay }) {
  const [editField, setEditField] = useState(null);
  const [editValue, setEditValue] = useState('');

  function startEdit(field, value) {
    if (!isEditable) return;
    setEditField(field);
    setEditValue(value ?? '');
  }

  function saveEdit(field) {
    setEditField(null);
    let newVal = editValue;

    if (field === 'per_unit_price_cents') {
      newVal = Math.round(parseFloat(newVal || 0) * 100);
      onUpdate({ [field]: newVal, unit_count: li.unit_count, free_units: li.free_units });
      return;
    }
    if (field === 'unit_count' || field === 'free_units') {
      newVal = parseFloat(newVal || 0);
      onUpdate({
        per_unit_price_cents: li.per_unit_price_cents,
        unit_count: field === 'unit_count' ? newVal : li.unit_count,
        free_units: field === 'free_units' ? newVal : li.free_units,
      });
      return;
    }
    onUpdate({ [field]: newVal });
  }

  function renderCell(field, value, display, align = 'left', cls = '') {
    if (editField === field) {
      return (
        <td className={`px-2 py-1 ${align === 'right' ? 'text-right' : ''}`}>
          <input
            type={['unit_count', 'free_units', 'per_unit_price_cents'].includes(field) ? 'number' : 'text'}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => saveEdit(field)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(field); if (e.key === 'Escape') setEditField(null); }}
            autoFocus
            step={field === 'per_unit_price_cents' ? '0.01' : undefined}
            className="w-full rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
          />
        </td>
      );
    }
    return (
      <td
        className={`px-4 py-2 ${align === 'right' ? 'text-right' : ''} ${cls} ${isEditable ? 'cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/40' : ''}`}
        onClick={() => startEdit(field, field === 'per_unit_price_cents' ? ((value || 0) / 100).toFixed(2) : value)}
      >
        {display}
      </td>
    );
  }

  // Parse tariff name from description like "LINE_HAUL (via All Customers Import Tariff)"
  const tariffMatch = (li.description || '').match(/\(via (.+)\)/);
  const tariffName = tariffMatch ? tariffMatch[1] : null;
  const profileId = li.source_profile_id;
  const tariffId = li.source_tariff_id;

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-slate-800 group">
      {/* Source badge: A = Auto, M = Manual */}
      <td className="px-2 py-2 text-center">
        {li.is_auto ? (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300" title="Automatically applied by tariff engine">
            A
          </span>
        ) : (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300" title="Manually added">
            M
          </span>
        )}
      </td>
      {/* Name — click to open charge profile overlay if auto-applied */}
      <td className="px-4 py-2 font-medium text-strong">
        {profileId ? (
          <button type="button" onClick={() => openOverlay('chargeProfile', { chargeProfileId: profileId })}
            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer">
            {li.name}
            <ExternalLink className="w-2.5 h-2.5 opacity-50" />
          </button>
        ) : isEditable ? (
          <span className="cursor-pointer hover:text-blue-600 dark:hover:text-blue-400" onClick={() => startEdit('name', li.name)}>{li.name}</span>
        ) : (
          li.name
        )}
      </td>
      {/* Description — click to open tariff overlay if auto-applied */}
      <td className="px-4 py-2 text-xs text-gray-600 dark:text-slate-300">
        {tariffName ? (
          <span>
            {li.description?.replace(` (via ${tariffName})`, '') || ''}
            <button type="button" onClick={() => tariffId && openOverlay('tariff', { tariffId })}
              className="ml-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:underline inline-flex items-center gap-0.5 cursor-pointer">
              via {tariffName} <ExternalLink className="w-2.5 h-2.5" />
            </button>
          </span>
        ) : (
          <span className={isEditable ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400' : ''} onClick={() => startEdit('description', li.description)}>
            {li.description || '—'}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-helper text-muted capitalize">
        {(li.unit_of_measure || 'fixed').replace(/_/g, ' ')}
      </td>
      {renderCell('unit_count', li.unit_count, li.unit_count, 'right', 'text-gray-700 dark:text-slate-200')}
      {renderCell('free_units', li.free_units, li.free_units, 'right', 'text-gray-500 dark:text-slate-400 text-xs')}
      {renderCell('per_unit_price_cents', li.per_unit_price_cents, formatCents(li.per_unit_price_cents), 'right', 'text-gray-700 dark:text-slate-200')}
      <td className="px-4 py-2 text-right font-semibold text-strong">
        {formatCents(li.total_cents)}
      </td>
      <td className="px-2 py-2">
        {isEditable && (
          <button
            onClick={onDelete}
            className="text-gray-300 dark:text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}
