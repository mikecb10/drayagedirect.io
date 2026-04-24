import { useState, useEffect } from 'react';
import { X, RotateCcw, Filter as FilterIcon } from 'lucide-react';
import Button from '../ui/Button';
import Select from '../ui/Select';
import { useAuth } from '../../contexts/AuthContext';
import { DISPATCHER_BOARD_LOAD_TYPES } from '../../lib/constants/load-types.js';

const FLAG_CHECKBOXES = [
  { key: 'hazmat', label: 'Hazmat' },
  { key: 'overweight', label: 'Overweight' },
  { key: 'overheight', label: 'Overheight' },
  { key: 'reefer', label: 'Reefer' },
  { key: 'hot', label: 'Hot' },
  { key: 'genset', label: 'Genset' },
  { key: 'scale', label: 'Scale' },
  { key: 'ev', label: 'EV' },
  { key: 'street_turn', label: 'Street Turn' },
  { key: 'oog', label: 'OOG' },
  { key: 'bonded', label: 'Bonded' },
  { key: 'double', label: 'Double' },
  { key: 'tanker', label: 'Tanker' },
  { key: 'liquor', label: 'Liquor' },
];

// Dispatcher board filter — excludes 'bill_only' (per showsOnDispatcherBoard=false
// in the central load-types definition). Previous hardcoded list included bill_only;
// removal is intentional per Task 2 code reviewer + Plan G1 spec.
const LOAD_TYPE_OPTIONS = DISPATCHER_BOARD_LOAD_TYPES.map((t) => ({
  value: t.value,
  label: t.label,
}));

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Fallback while the dynamic fetch loads
const DEFAULT_CONTAINER_SIZE_OPTIONS = [
  { value: '20', label: "20'" },
  { value: '40', label: "40'" },
  { value: '40HC', label: "40' HC" },
  { value: '45', label: "45'" },
  { value: '48', label: "48'" },
  { value: '53', label: "53'" },
];

const EMPTY_FILTERS = {
  branch_id: '',
  load_type: '',
  status: '',
  container_size: '',
  container_type: '',
  from: '',
  to: '',
};

export default function FilterSidebar({ isOpen, onClose, filters, onApply }) {
  const { branches: userBranches } = useAuth();
  const [draft, setDraft] = useState(filters || EMPTY_FILTERS);
  const [containerSizeOptions, setContainerSizeOptions] = useState(DEFAULT_CONTAINER_SIZE_OPTIONS);
  const [branchOptions, setBranchOptions] = useState([]);

  // Fetch enabled container sizes + branches dynamically on mount
  useEffect(() => {
    fetch('/api/tenant/container-sizes?enabled=true')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.items?.length > 0) {
          setContainerSizeOptions(data.items.map((s) => ({ value: s.code, label: s.label })));
        }
      })
      .catch(() => {});

    fetch('/api/tenant/branches?status=active')
      .then((r) => r.ok ? r.json() : { branches: [] })
      .then((data) => {
        setBranchOptions(
          (data.branches || []).map((b) => ({
            value: b.id,
            label: b.code ? `${b.name} (${b.code})` : b.name,
          }))
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setDraft(filters || EMPTY_FILTERS);
  }, [filters, isOpen]);

  function toggleFlag(key) {
    setDraft((d) => ({ ...d, [key]: d[key] === 'true' ? '' : 'true' }));
  }

  function updateField(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleApply() {
    // Strip empty values
    const cleaned = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v !== '' && v != null) cleaned[k] = v;
    }
    onApply?.(cleaned);
    onClose?.();
  }

  function handleReset() {
    setDraft(EMPTY_FILTERS);
    onApply?.({});
    onClose?.();
  }

  const activeCount = Object.values(draft).filter((v) => v !== '' && v != null).length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 w-full sm:max-w-md h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <FilterIcon className="w-5 h-5 text-gray-500 dark:text-slate-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Filters</h3>
            {activeCount > 0 && (
              <span className="text-[10px] uppercase tracking-wide font-semibold bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                {activeCount} active
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Flags */}
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">
              Flags
            </div>
            <div className="grid grid-cols-2 gap-2">
              {FLAG_CHECKBOXES.map((f) => {
                const active = draft[f.key] === 'true';
                return (
                  <label
                    key={f.key}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 cursor-pointer text-sm transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300'
                        : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 hover:border-gray-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleFlag(f.key)}
                      className="w-4 h-4 rounded text-blue-600 border-gray-300 dark:border-slate-600"
                    />
                    {f.label}
                  </label>
                );
              })}
            </div>
          </section>

          {/* Branch filter (only show if branches exist) */}
          {branchOptions.length > 0 && (
            <section>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">
                Branch
              </div>
              <Select
                label="Branch"
                value={draft.branch_id || ''}
                onChange={(e) => updateField('branch_id', e.target.value)}
                placeholder="All Branches" options={branchOptions}
              />
            </section>
          )}

          {/* Dropdown filters */}
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">
              Properties
            </div>
            <div className="space-y-3">
              <Select
                label="Load Type"
                value={draft.load_type || ''}
                onChange={(e) => updateField('load_type', e.target.value)}
                options={LOAD_TYPE_OPTIONS}
              />
              <Select
                label="Load Status"
                value={draft.status || ''}
                onChange={(e) => updateField('status', e.target.value)}
                options={STATUS_OPTIONS}
              />
              <Select
                label="Container Size"
                value={draft.container_size || ''}
                onChange={(e) => updateField('container_size', e.target.value)}
                options={containerSizeOptions}
              />
            </div>
          </section>

          {/* Date range */}
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">
              Pickup Date Range
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">From</label>
                <input
                  type="date"
                  value={draft.from || ''}
                  onChange={(e) => updateField('from', e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">To</label>
                <input
                  type="date"
                  value={draft.to || ''}
                  onChange={(e) => updateField('to', e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-slate-800 px-5 py-3 flex items-center gap-2">
          <Button variant="secondary" onClick={handleReset} className="flex-shrink-0">
            <RotateCcw className="w-4 h-4 inline -mt-0.5 mr-1" />
            Reset
          </Button>
          <Button onClick={handleApply} className="flex-1">
            Apply Filters
          </Button>
        </div>
      </div>
    </div>
  );
}
