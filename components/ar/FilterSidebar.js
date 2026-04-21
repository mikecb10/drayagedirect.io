import React, { useEffect, useState } from 'react';
import { X, Search, RotateCcw } from 'lucide-react';
import { filterKeysForSection } from '../../lib/ar-filter-schema';

const LOAD_TYPE_OPTIONS = [
  { value: 'import',    label: 'Import' },
  { value: 'inbound',   label: 'Inbound' },
  { value: 'export',    label: 'Export' },
  { value: 'outbound',  label: 'Outbound' },
  { value: 'road',      label: 'Road' },
  { value: 'bill_only', label: 'Bill Only' },
];

const FLAG_OPTIONS = [
  { key: 'hazmat',      label: 'Hazmat' },
  { key: 'overweight',  label: 'Overweight' },
  { key: 'overheight',  label: 'Overheight' },
  { key: 'hot',         label: 'Hot' },
  { key: 'genset',      label: 'Genset' },
  { key: 'scale',       label: 'Scale' },
  { key: 'ev',          label: 'EV' },
  { key: 'street_turn', label: 'Street Turn' },
  { key: 'oog',         label: 'OOG' },
  { key: 'bonded',      label: 'Bonded' },
  { key: 'double',      label: 'Double' },
  { key: 'tanker',      label: 'Tanker' },
  { key: 'liquor',      label: 'Liquor' },
];

const EMPTY = {
  customer_ids: [], branch_ids: [], from: '', to: '',
  reference_number: '',
  load_types: [], container_types: [], container_sizes: [], flags: [], ssl_codes: [], driver_ids: [],
  customer_ids_exclude: [], branch_ids_exclude: [], load_types_exclude: [],
  container_types_exclude: [], container_sizes_exclude: [],
  flags_exclude: [], ssl_codes_exclude: [], driver_ids_exclude: [],
  invoiced_from: '', invoiced_to: '',
  pickup_location_ids: [], delivery_location_ids: [], return_location_ids: [],
};

export default function FilterSidebar({ isOpen, onClose, filters, onApply, section = 'billing' }) {
  const visibleKeys = filterKeysForSection(section);
  const showKey = (key) => visibleKeys.includes(key);
  const [draft, setDraft] = useState(() => ({ ...EMPTY, ...filters }));
  const [customers, setCustomers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [containerTypes, setContainerTypes] = useState([]);
  const [containerSizes, setContainerSizes] = useState([]);
  const [sslCodes, setSslCodes] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [driverQuery, setDriverQuery] = useState('');
  const [branchQuery, setBranchQuery] = useState('');
  const [modes, setModes] = useState({
    customer:       'include',
    branch:         'include',
    load_type:      'include',
    container_type: 'include',
    container_size: 'include',
    flag:           'include',
    ssl:            'include',
    driver:         'include',
  });
  const setMode = (key, mode) => setModes((m) => ({ ...m, [key]: mode }));

  useEffect(() => {
    if (!isOpen) return;
    setDraft({ ...EMPTY, ...filters });
  }, [isOpen, filters]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const [custRes, brRes, ctRes, csRes, sslRes, drvRes] = await Promise.all([
          fetch('/api/tenant/organizations?type=customer').then((r) => (r.ok ? r.json() : { organizations: [] })),
          fetch('/api/tenant/branches').then((r) => (r.ok ? r.json() : { branches: [] })),
          fetch('/api/tenant/container-types?enabled=true').then((r) => (r.ok ? r.json() : { items: [] })),
          fetch('/api/tenant/container-sizes?enabled=true').then((r) => (r.ok ? r.json() : { items: [] })),
          fetch('/api/tenant/ar/ssl-codes').then((r) => (r.ok ? r.json() : { codes: [] })),
          fetch('/api/tenant/drivers').then((r) => (r.ok ? r.json() : { drivers: [] })),
        ]);
        setCustomers(custRes.organizations ?? custRes.customers ?? custRes ?? []);
        setBranches(brRes.branches ?? brRes ?? []);
        setContainerTypes(ctRes.items ?? []);
        setContainerSizes(csRes.items ?? []);
        setSslCodes(sslRes.codes ?? []);
        setDrivers(drvRes.drivers ?? []);
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
    (draft.customer_ids?.length    || 0) +
    (draft.branch_ids?.length      || 0) +
    (draft.load_types?.length      || 0) +
    (draft.container_types?.length || 0) +
    (draft.container_sizes?.length || 0) +
    (draft.flags?.length           || 0) +
    (draft.ssl_codes?.length       || 0) +
    (draft.driver_ids?.length      || 0) +
    (draft.customer_ids_exclude?.length    || 0) +
    (draft.branch_ids_exclude?.length      || 0) +
    (draft.load_types_exclude?.length      || 0) +
    (draft.container_types_exclude?.length || 0) +
    (draft.container_sizes_exclude?.length || 0) +
    (draft.flags_exclude?.length           || 0) +
    (draft.ssl_codes_exclude?.length       || 0) +
    (draft.driver_ids_exclude?.length      || 0) +
    (draft.pickup_location_ids?.length   || 0) +
    (draft.delivery_location_ids?.length || 0) +
    (draft.return_location_ids?.length   || 0) +
    (draft.from ? 1 : 0) +
    (draft.to ? 1 : 0) +
    (draft.invoiced_from ? 1 : 0) +
    (draft.invoiced_to ? 1 : 0) +
    (draft.reference_number && draft.reference_number.trim() ? 1 : 0);

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
          {visibleKeys.length === 0 && (
            <div className="text-xs text-gray-500 dark:text-slate-400 italic px-1">
              No filters available for this section yet.
            </div>
          )}

          {/* Reference number — text search on orders.customer_reference */}
          {showKey('reference_number') && (
            <section>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">
                Reference number
              </label>
              <input
                type="text"
                value={draft.reference_number ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, reference_number: e.target.value }))}
                placeholder="e.g. PO-12345"
                className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </section>
          )}

          {/* Load type — multi-select on orders.load_type */}
          {showKey('load_types') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Load type</label>
                <div className="flex items-center gap-2">
                  {((draft.load_types?.length ?? 0) + (draft.load_types_exclude?.length ?? 0)) > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">
                      {(modes.load_type === 'exclude' ? (draft.load_types_exclude?.length ?? 0) : (draft.load_types?.length ?? 0))} selected
                    </span>
                  )}
                  <ExcludeToggle mode={modes.load_type} onChange={(m) => setMode('load_type', m)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 border border-gray-100 dark:border-slate-800 rounded-md p-1">
                {LOAD_TYPE_OPTIONS.map((opt) => {
                  const activeKey = modes.load_type === 'exclude' ? 'load_types_exclude' : 'load_types';
                  const selected = (draft[activeKey] ?? []).includes(opt.value);
                  return (
                    <label key={opt.value} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer rounded">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => setDraft((d) => {
                          const set = new Set(d[activeKey] ?? []);
                          if (set.has(opt.value)) set.delete(opt.value); else set.add(opt.value);
                          return { ...d, [activeKey]: Array.from(set) };
                        })}
                        className="rounded"
                      />
                      <span className="text-gray-700 dark:text-slate-300">{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {/* Container type */}
          {showKey('container_types') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Container type</label>
                <div className="flex items-center gap-2">
                  {((draft.container_types?.length ?? 0) + (draft.container_types_exclude?.length ?? 0)) > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">
                      {(modes.container_type === 'exclude' ? (draft.container_types_exclude?.length ?? 0) : (draft.container_types?.length ?? 0))} selected
                    </span>
                  )}
                  <ExcludeToggle mode={modes.container_type} onChange={(m) => setMode('container_type', m)} />
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto border border-gray-100 dark:border-slate-800 rounded-md">
                {containerTypes.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No types available</div>
                ) : (
                  containerTypes.map((t) => {
                    const activeKey = modes.container_type === 'exclude' ? 'container_types_exclude' : 'container_types';
                    const selected = (draft[activeKey] ?? []).includes(t.code);
                    return (
                      <label key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setDraft((d) => {
                            const set = new Set(d[activeKey] ?? []);
                            if (set.has(t.code)) set.delete(t.code); else set.add(t.code);
                            return { ...d, [activeKey]: Array.from(set) };
                          })}
                          className="rounded"
                        />
                        <span className="text-gray-700 dark:text-slate-300 truncate">{t.label || t.code}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {/* Container size */}
          {showKey('container_sizes') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Container size</label>
                <div className="flex items-center gap-2">
                  {((draft.container_sizes?.length ?? 0) + (draft.container_sizes_exclude?.length ?? 0)) > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">
                      {(modes.container_size === 'exclude' ? (draft.container_sizes_exclude?.length ?? 0) : (draft.container_sizes?.length ?? 0))} selected
                    </span>
                  )}
                  <ExcludeToggle mode={modes.container_size} onChange={(m) => setMode('container_size', m)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1 border border-gray-100 dark:border-slate-800 rounded-md p-1">
                {containerSizes.length === 0 ? (
                  <div className="col-span-3 px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No sizes available</div>
                ) : (
                  containerSizes.map((s) => {
                    const activeKey = modes.container_size === 'exclude' ? 'container_sizes_exclude' : 'container_sizes';
                    const selected = (draft[activeKey] ?? []).includes(s.code);
                    return (
                      <label key={s.id} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer rounded">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setDraft((d) => {
                            const set = new Set(d[activeKey] ?? []);
                            if (set.has(s.code)) set.delete(s.code); else set.add(s.code);
                            return { ...d, [activeKey]: Array.from(set) };
                          })}
                          className="rounded"
                        />
                        <span className="text-gray-700 dark:text-slate-300">{s.label || s.code}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {/* Load flags — AND semantics; row must have every selected flag set true */}
          {showKey('flags') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Flags</label>
                <div className="flex items-center gap-2">
                  {((draft.flags?.length ?? 0) + (draft.flags_exclude?.length ?? 0)) > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">
                      {(modes.flag === 'exclude' ? (draft.flags_exclude?.length ?? 0) : (draft.flags?.length ?? 0))} selected
                    </span>
                  )}
                  <ExcludeToggle mode={modes.flag} onChange={(m) => setMode('flag', m)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 border border-gray-100 dark:border-slate-800 rounded-md p-1">
                {FLAG_OPTIONS.map((opt) => {
                  const activeKey = modes.flag === 'exclude' ? 'flags_exclude' : 'flags';
                  const selected = (draft[activeKey] ?? []).includes(opt.key);
                  return (
                    <label key={opt.key} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer rounded">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => setDraft((d) => {
                          const set = new Set(d[activeKey] ?? []);
                          if (set.has(opt.key)) set.delete(opt.key); else set.add(opt.key);
                          return { ...d, [activeKey]: Array.from(set) };
                        })}
                        className="rounded"
                      />
                      <span className="text-gray-700 dark:text-slate-300">{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {/* SSL — steamship line SCAC multi-select */}
          {showKey('ssl_codes') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">SSL</label>
                <div className="flex items-center gap-2">
                  {((draft.ssl_codes?.length ?? 0) + (draft.ssl_codes_exclude?.length ?? 0)) > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">
                      {(modes.ssl === 'exclude' ? (draft.ssl_codes_exclude?.length ?? 0) : (draft.ssl_codes?.length ?? 0))} selected
                    </span>
                  )}
                  <ExcludeToggle mode={modes.ssl} onChange={(m) => setMode('ssl', m)} />
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto border border-gray-100 dark:border-slate-800 rounded-md">
                {sslCodes.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No SSL codes in orders</div>
                ) : (
                  sslCodes.map((code) => {
                    const activeKey = modes.ssl === 'exclude' ? 'ssl_codes_exclude' : 'ssl_codes';
                    const selected = (draft[activeKey] ?? []).includes(code);
                    return (
                      <label key={code} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setDraft((d) => {
                            const set = new Set(d[activeKey] ?? []);
                            if (set.has(code)) set.delete(code); else set.add(code);
                            return { ...d, [activeKey]: Array.from(set) };
                          })}
                          className="rounded"
                        />
                        <span className="text-gray-700 dark:text-slate-300 font-mono">{code}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {/* Driver — typeahead combobox with chips (mirrors Customers) */}
          {showKey('driver_ids') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Driver</label>
                <div className="flex items-center gap-2">
                  {((draft.driver_ids?.length ?? 0) + (draft.driver_ids_exclude?.length ?? 0)) > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">
                      {(modes.driver === 'exclude' ? (draft.driver_ids_exclude?.length ?? 0) : (draft.driver_ids?.length ?? 0))} selected
                    </span>
                  )}
                  <ExcludeToggle mode={modes.driver} onChange={(m) => setMode('driver', m)} />
                </div>
              </div>
              <CustomerCombobox
                options={drivers.map((d) => ({ id: d.id, name: d.name || `${d.first_name || ''} ${d.last_name || ''}`.trim() || 'Unnamed Driver' }))}
                selectedIds={modes.driver === 'exclude' ? (draft.driver_ids_exclude ?? []) : (draft.driver_ids ?? [])}
                onChange={(ids) => setDraft((d) => ({
                  ...d,
                  [modes.driver === 'exclude' ? 'driver_ids_exclude' : 'driver_ids']: ids,
                }))}
                query={driverQuery}
                onQueryChange={setDriverQuery}
              />
            </section>
          )}

          {/* Customers — typeahead combobox with chips */}
          {showKey('customer_ids') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Customers</label>
                <div className="flex items-center gap-2">
                  {((draft.customer_ids?.length ?? 0) + (draft.customer_ids_exclude?.length ?? 0)) > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">
                      {(modes.customer === 'exclude' ? (draft.customer_ids_exclude?.length ?? 0) : (draft.customer_ids?.length ?? 0))} selected
                    </span>
                  )}
                  <ExcludeToggle mode={modes.customer} onChange={(m) => setMode('customer', m)} />
                </div>
              </div>
              <CustomerCombobox
                options={customers}
                selectedIds={modes.customer === 'exclude' ? (draft.customer_ids_exclude ?? []) : (draft.customer_ids ?? [])}
                onChange={(ids) => setDraft((d) => ({
                  ...d,
                  [modes.customer === 'exclude' ? 'customer_ids_exclude' : 'customer_ids']: ids,
                }))}
                query={customerQuery}
                onQueryChange={setCustomerQuery}
              />
            </section>
          )}

          {/* Branches */}
          {showKey('branch_ids') && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Branches</label>
                <div className="flex items-center gap-2">
                  {((draft.branch_ids?.length ?? 0) + (draft.branch_ids_exclude?.length ?? 0)) > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">
                      {(modes.branch === 'exclude' ? (draft.branch_ids_exclude?.length ?? 0) : (draft.branch_ids?.length ?? 0))} selected
                    </span>
                  )}
                  <ExcludeToggle mode={modes.branch} onChange={(m) => setMode('branch', m)} />
                </div>
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
                  filteredBranches.map((b) => {
                    const activeKey = modes.branch === 'exclude' ? 'branch_ids_exclude' : 'branch_ids';
                    const selected = (draft[activeKey] ?? []).includes(b.id);
                    return (
                      <label key={b.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setDraft((d) => {
                            const set = new Set(d[activeKey] ?? []);
                            if (set.has(b.id)) set.delete(b.id); else set.add(b.id);
                            return { ...d, [activeKey]: Array.from(set) };
                          })}
                          className="rounded"
                        />
                        <span className="text-gray-700 dark:text-slate-300 truncate">{b.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {/* Date range */}
          {(showKey('from') || showKey('to')) && (
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
          )}
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
                if (draft.reference_number && draft.reference_number.trim().length > 0) {
                  cleaned.reference_number = draft.reference_number.trim();
                }
                if (draft.load_types?.length) cleaned.load_types = draft.load_types;
                if (draft.container_types?.length) cleaned.container_types = draft.container_types;
                if (draft.container_sizes?.length) cleaned.container_sizes = draft.container_sizes;
                if (draft.flags?.length) cleaned.flags = draft.flags;
                if (draft.ssl_codes?.length) cleaned.ssl_codes = draft.ssl_codes;
                if (draft.driver_ids?.length) cleaned.driver_ids = draft.driver_ids;
                if (draft.customer_ids_exclude?.length)    cleaned.customer_ids_exclude    = draft.customer_ids_exclude;
                if (draft.branch_ids_exclude?.length)      cleaned.branch_ids_exclude      = draft.branch_ids_exclude;
                if (draft.load_types_exclude?.length)      cleaned.load_types_exclude      = draft.load_types_exclude;
                if (draft.container_types_exclude?.length) cleaned.container_types_exclude = draft.container_types_exclude;
                if (draft.container_sizes_exclude?.length) cleaned.container_sizes_exclude = draft.container_sizes_exclude;
                if (draft.flags_exclude?.length)           cleaned.flags_exclude           = draft.flags_exclude;
                if (draft.ssl_codes_exclude?.length)       cleaned.ssl_codes_exclude       = draft.ssl_codes_exclude;
                if (draft.driver_ids_exclude?.length)      cleaned.driver_ids_exclude      = draft.driver_ids_exclude;
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

// ──────────────────────────────────────────────────────────────
// Small pill toggle for Include / Exclude mode on a multi-select
// section. Keeps include + exclude lists in the draft simultaneously;
// the UI only shows one mode's list at a time.
// ──────────────────────────────────────────────────────────────
function ExcludeToggle({ mode, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(mode === 'exclude' ? 'include' : 'exclude')}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border ${
        mode === 'exclude'
          ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
          : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
      }`}
      aria-pressed={mode === 'exclude'}
    >
      {mode === 'exclude' ? 'Excluding' : 'Include'}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────
// Customer typeahead combobox with chips.
// Kept inline because (a) it's only used here and (b) it closes
// over the parent's customers list / query state. If a second
// consumer appears (Phase B pickup/delivery location filters may),
// lift this to components/ui/.
// ──────────────────────────────────────────────────────────────
function CustomerCombobox({ options, selectedIds, onChange, query, onQueryChange }) {
  const [highlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef(null);

  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = React.useMemo(
    () => options.filter((o) => selectedSet.has(o.id)),
    [options, selectedSet]
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const unselected = options.filter((o) => !selectedSet.has(o.id));
    if (!q) return unselected.slice(0, 50);
    return unselected
      .filter((o) => o.name?.toLowerCase().includes(q))
      .slice(0, 50);
  }, [options, query, selectedSet]);

  // Clamp highlight when filtered list changes.
  React.useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlight]);

  const addId = (id) => {
    if (!id || selectedSet.has(id)) return;
    onChange([...selectedIds, id]);
    onQueryChange('');
    setHighlight(0);
    inputRef.current?.focus();
  };

  const removeId = (id) => {
    onChange(selectedIds.filter((x) => x !== id));
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      if (filtered[highlight]) {
        e.preventDefault();
        addId(filtered[highlight].id);
      }
    } else if (e.key === 'Backspace' && !query && selectedIds.length > 0) {
      // Backspace on empty input removes the last chip.
      removeId(selectedIds[selectedIds.length - 1]);
    }
  };

  return (
    <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1 min-h-[34px] px-1.5 py-1 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 focus-within:ring-1 focus-within:ring-blue-500 cursor-text"
      >
        {selectedItems.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 text-xs"
          >
            <span className="truncate max-w-[120px]">{c.name}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeId(c.id); }}
              aria-label={`Remove ${c.name}`}
              className="p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-900/60"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); setHighlight(0); }}
          onKeyDown={handleKeyDown}
          placeholder={selectedItems.length === 0 ? 'Search customers…' : ''}
          className="flex-1 min-w-[80px] text-xs bg-transparent outline-none text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500"
        />
      </div>
      {query.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => addId(c.id)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-1.5 text-xs truncate ${
                  i === highlight
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                }`}
              >
                {c.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
