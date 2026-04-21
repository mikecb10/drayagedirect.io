import React, { useEffect, useState } from 'react';
import { X, Search, RotateCcw } from 'lucide-react';

const EMPTY = { customer_ids: [], branch_ids: [], from: '', to: '' };

export default function FilterSidebar({ isOpen, onClose, filters, onApply }) {
  const [draft, setDraft] = useState(() => ({ ...EMPTY, ...filters }));
  const [customers, setCustomers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [branchQuery, setBranchQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setDraft({ ...EMPTY, ...filters });
  }, [isOpen, filters]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const [custRes, brRes] = await Promise.all([
          fetch('/api/tenant/customers').then((r) => (r.ok ? r.json() : { customers: [] })),
          fetch('/api/tenant/branches').then((r) => (r.ok ? r.json() : { branches: [] })),
        ]);
        setCustomers(custRes.customers ?? custRes ?? []);
        setBranches(brRes.branches ?? brRes ?? []);
      } catch (_) { /* swallow — user sees empty list, can still type dates */ }
    })();
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleArray = (key, value) => {
    setDraft((prev) => {
      const set = new Set(prev[key]);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...prev, [key]: Array.from(set) };
    });
  };

  const activeCount =
    (draft.customer_ids?.length || 0) +
    (draft.branch_ids?.length || 0) +
    (draft.from ? 1 : 0) +
    (draft.to ? 1 : 0);

  const filteredCustomers = customerQuery
    ? customers.filter((c) => c.name?.toLowerCase().includes(customerQuery.toLowerCase()))
    : customers;
  const filteredBranches = branchQuery
    ? branches.filter((b) => b.name?.toLowerCase().includes(branchQuery.toLowerCase()))
    : branches;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 dark:bg-slate-950/60" onClick={onClose}>
      <div
        className="w-full max-w-sm h-full bg-white dark:bg-slate-900 shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Filters</h2>
            {activeCount > 0 && (
              <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                {activeCount} active
              </span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {/* Customers */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Customers</label>
              {(draft.customer_ids?.length ?? 0) > 0 && (
                <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.customer_ids.length} selected</span>
              )}
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
              <input
                type="text"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Search customers"
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="max-h-48 overflow-y-auto border border-gray-100 dark:border-slate-800 rounded-md">
              {filteredCustomers.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</div>
              ) : (
                filteredCustomers.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.customer_ids?.includes(c.id) ?? false}
                      onChange={() => toggleArray('customer_ids', c.id)}
                      className="rounded"
                    />
                    <span className="text-gray-700 dark:text-slate-300 truncate">{c.name}</span>
                  </label>
                ))
              )}
            </div>
          </section>

          {/* Branches */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Branches</label>
              {(draft.branch_ids?.length ?? 0) > 0 && (
                <span className="text-[10px] text-gray-500 dark:text-slate-400">{draft.branch_ids.length} selected</span>
              )}
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
              <input
                type="text"
                value={branchQuery}
                onChange={(e) => setBranchQuery(e.target.value)}
                placeholder="Search branches"
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="max-h-40 overflow-y-auto border border-gray-100 dark:border-slate-800 rounded-md">
              {filteredBranches.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</div>
              ) : (
                filteredBranches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.branch_ids?.includes(b.id) ?? false}
                      onChange={() => toggleArray('branch_ids', b.id)}
                      className="rounded"
                    />
                    <span className="text-gray-700 dark:text-slate-300 truncate">{b.name}</span>
                  </label>
                ))
              )}
            </div>
          </section>

          {/* Date range */}
          <section>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Created between</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={draft.from ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
              />
              <input
                type="date"
                value={draft.to ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                className="px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
              />
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/60">
          <button
            onClick={() => setDraft(EMPTY)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                // Strip empty arrays / blank dates before handing back.
                const cleaned = {};
                if (draft.customer_ids?.length) cleaned.customer_ids = draft.customer_ids;
                if (draft.branch_ids?.length)   cleaned.branch_ids   = draft.branch_ids;
                if (draft.from)                 cleaned.from         = draft.from;
                if (draft.to)                   cleaned.to           = draft.to;
                onApply(cleaned);
                onClose();
              }}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
