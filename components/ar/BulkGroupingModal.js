import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Pure group computation. Exported for unit testing in Task 13 Gate 3.
 *
 * @param {Array} invoices
 * @param {'customer' | 'reference' | 'charge_set'} kind
 * @returns {Array<Group>}
 */
export function computeGroups(invoices, kind) {
  if (!Array.isArray(invoices) || invoices.length === 0) return [];

  const keyFn = (inv) => {
    switch (kind) {
      case 'customer':
        return inv.customer_id;
      case 'reference':
        // null/empty ref → customer-level key (fallback)
        return inv.reference_number
          ? `${inv.customer_id}::${inv.reference_number}`
          : inv.customer_id;
      case 'charge_set':
        return inv.charge_set_id ?? inv.invoice_id;
      default:
        throw new Error(`unknown grouping kind: ${kind}`);
    }
  };

  const labelFn = (group) => {
    const first = group.invoices[0];
    switch (kind) {
      case 'customer':
        return first.customer_name ?? '(unknown customer)';
      case 'reference':
        return first.reference_number
          ? `${first.customer_name} · ${first.reference_number}`
          : `${first.customer_name} (no ref)`;
      case 'charge_set':
        return `${first.customer_name} · ${first.invoice_number ?? first.invoice_id}`;
      default:
        return '';
    }
  };

  const map = new Map();
  for (const inv of invoices) {
    const k = keyFn(inv);
    if (!map.has(k)) map.set(k, { key: k, invoices: [] });
    map.get(k).invoices.push(inv);
  }

  const groups = [];
  for (const raw of map.values()) {
    const invoice_ids = raw.invoices.map((i) => i.invoice_id);
    const charge_set_ids = raw.invoices.map((i) => i.charge_set_id).filter(Boolean);
    const total_cents = raw.invoices.reduce((a, i) => a + (i.total_cents || 0), 0);
    const first = raw.invoices[0];
    groups.push({
      key: raw.key,
      kind,
      label: labelFn(raw),
      customer_id: first.customer_id,
      customer_name: first.customer_name,
      reference_number: first.reference_number ?? null,
      invoice_ids,
      charge_set_ids,
      total_cents,
    });
  }

  // Sanity invariant
  const totalInvoicesAcrossGroups = groups.reduce((a, g) => a + g.invoice_ids.length, 0);
  if (totalInvoicesAcrossGroups !== invoices.length) {
    throw new Error(
      `computeGroups invariant violation: ${totalInvoicesAcrossGroups} != ${invoices.length}`
    );
  }

  return groups;
}

const KINDS = [
  { key: 'customer',   label: '1 email per customer',      hint: 'All invoices for the same customer consolidated into one email with multiple PDFs attached.' },
  { key: 'reference',  label: '1 email per reference #',   hint: 'Bundle by PO / booking #. Invoices without a ref fall back into the customer grouping.' },
  { key: 'charge_set', label: 'Separate email per charge set', hint: 'One invoice per email. Like single-send, looped.' },
];

export default function BulkGroupingModal({ invoices, onCancel, onContinue }) {
  const [kind, setKind] = useState('customer');

  const groupsByKind = useMemo(() => ({
    customer: computeGroups(invoices, 'customer'),
    reference: computeGroups(invoices, 'reference'),
    charge_set: computeGroups(invoices, 'charge_set'),
  }), [invoices]);

  const selectedGroups = groupsByKind[kind];
  const totalCents = invoices.reduce((a, i) => a + (i.total_cents || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-slate-950/60" onClick={onCancel}>
      <div
        className="w-full max-w-xl rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div>
            <div className="text-base font-semibold text-gray-900 dark:text-slate-100">How should these be sent?</div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {invoices.length} invoice{invoices.length !== 1 ? 's' : ''} ready · {formatCents(totalCents)} total
            </div>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2">
          {KINDS.map((k) => {
            const groups = groupsByKind[k.key];
            const sample = groups.slice(0, 5).map((g) => `${g.label} (${g.invoice_ids.length})`).join(' · ');
            const more = groups.length > 5 ? ` · …+${groups.length - 5}` : '';
            const isSel = kind === k.key;
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                className={`w-full text-left rounded-lg border p-3 transition-all ${
                  isSel
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-600 ring-2 ring-blue-200 dark:ring-blue-900/50'
                    : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{k.label}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    isSel ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
                  }`}>
                    {groups.length} email{groups.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">{sample}{more}</div>
                <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 italic">{k.hint}</div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700">
            Cancel
          </button>
          <button
            onClick={() => onContinue({ kind, groups: selectedGroups })}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
