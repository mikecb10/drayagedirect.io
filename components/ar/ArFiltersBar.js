import React, { useState } from 'react';
import { Plus, X, Filter } from 'lucide-react';

/**
 * Global AR custom-tabs row. Renders once at the AR module parent
 * (pages/ar/index.js) and applies its filter selection across all
 * AR sub-tabs (Billing, Invoices, Apply Payments, etc.) that consume
 * the shared `filters` state.
 *
 * Props:
 *   customTabs       - full array from useArUserPreferences
 *   activeTabId      - currently-active tab id, or null for "All"
 *   currentFilters   - live filter set (drives Save-as-tab visibility)
 *   onSelectTab(id)  - id or null
 *   onSaveTab(tab)   - tab = { name, filters } — id + created_at filled server-side
 *   onDeleteTab(id)
 *   onOpenFilters    - opens the FilterSidebar
 */
export default function ArFiltersBar({
  customTabs,
  activeTabId,
  currentFilters,
  onSelectTab,
  onSaveTab,
  onDeleteTab,
  onOpenFilters,
}) {
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  const filtersAreEmpty =
    !currentFilters ||
    (
      (currentFilters.customer_ids?.length    ?? 0) === 0 &&
      (currentFilters.branch_ids?.length      ?? 0) === 0 &&
      (currentFilters.load_types?.length      ?? 0) === 0 &&
      (currentFilters.container_types?.length ?? 0) === 0 &&
      (currentFilters.container_sizes?.length ?? 0) === 0 &&
      (currentFilters.flags?.length           ?? 0) === 0 &&
      (currentFilters.ssl_codes?.length       ?? 0) === 0 &&
      (currentFilters.driver_ids?.length      ?? 0) === 0 &&
      !currentFilters.from &&
      !currentFilters.to &&
      !(currentFilters.reference_number && currentFilters.reference_number.trim().length > 0)
    );

  const matchesExistingTab = customTabs.some((t) => filtersMatch(t.filters, currentFilters));
  const canSave = !filtersAreEmpty && !matchesExistingTab;

  const handleSave = () => {
    const name = newName.trim();
    if (!name) return;
    onSaveTab({ name, filters: currentFilters });
    setNewName('');
    setSaving(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-gray-200 dark:border-slate-800">
      <button
        onClick={onOpenFilters}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-700"
      >
        <Filter className="w-3.5 h-3.5" /> Filters
      </button>

      <TabButton
        label="All"
        active={activeTabId == null}
        onClick={() => onSelectTab(null)}
      />

      {customTabs.map((t) => (
        <TabButton
          key={t.id}
          label={t.name}
          active={activeTabId === t.id}
          onClick={() => onSelectTab(t.id)}
          onDelete={() => {
            if (window.confirm(`Delete saved tab "${t.name}"?`)) onDeleteTab(t.id);
          }}
        />
      ))}

      {canSave && !saving && (
        <button
          onClick={() => setSaving(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-blue-200 dark:border-blue-900"
        >
          <Plus className="w-3.5 h-3.5" /> Save as tab
        </button>
      )}

      {canSave && saving && (
        <div className="inline-flex items-center gap-1">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') { setSaving(false); setNewName(''); }
            }}
            placeholder="Tab name"
            className="px-2 py-1 text-xs border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleSave}
            disabled={!newName.trim()}
            className="px-2 py-1 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => { setSaving(false); setNewName(''); }}
            className="px-2 py-1 rounded-md text-xs font-semibold text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function TabButton({ label, active, onClick, onDelete }) {
  return (
    <div className="group inline-flex items-center">
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold ${
          active
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
        }`}
      >
        {label}
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          aria-label={`Delete tab ${label}`}
          className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function filtersMatch(a, b) {
  a = a || {};
  b = b || {};
  const arrEq = (x, y) => {
    const xs = [...(x ?? [])].sort();
    const ys = [...(y ?? [])].sort();
    return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
  };
  const strEq = (x, y) => (x ?? '').trim().toLowerCase() === (y ?? '').trim().toLowerCase();

  return (
    arrEq(a.customer_ids,    b.customer_ids) &&
    arrEq(a.branch_ids,      b.branch_ids) &&
    arrEq(a.load_types,      b.load_types) &&
    arrEq(a.container_types, b.container_types) &&
    arrEq(a.container_sizes, b.container_sizes) &&
    arrEq(a.flags,           b.flags) &&
    arrEq(a.ssl_codes,       b.ssl_codes) &&
    arrEq(a.driver_ids,      b.driver_ids) &&
    (a.from ?? '') === (b.from ?? '') &&
    (a.to   ?? '') === (b.to   ?? '') &&
    strEq(a.reference_number, b.reference_number)
  );
}
