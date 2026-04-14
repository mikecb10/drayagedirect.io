import { useEffect, useState } from 'react';
import Select from './Select';

/**
 * BranchPicker — reusable branch selector.
 *
 * Single-select mode (default): renders a Select dropdown.
 * Fetches branches from /api/tenant/branches?status=active on mount.
 *
 * Props:
 *   value       — branch UUID (single) or array of UUIDs (multi)
 *   onChange     — (value) => void
 *   multiple     — if true, renders checkbox list instead of select
 *   label        — field label
 *   required     — if true, makes field required
 *   disabled     — if true, disables the field
 *   placeholder  — custom placeholder text
 *   showEmpty    — show "— No Branch —" option (default: true in single mode)
 */
export default function BranchPicker({
  value,
  onChange,
  multiple = false,
  label = 'Branch',
  required = false,
  disabled = false,
  placeholder,
  showEmpty = true,
}) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tenant/branches?status=active')
      .then((r) => (r.ok ? r.json() : { branches: [] }))
      .then((data) => setBranches(data.branches || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const options = branches.map((b) => ({
    value: b.id,
    label: b.code ? `${b.name} (${b.code})` : b.name,
  }));

  // Single-select mode
  if (!multiple) {
    const selectOptions = showEmpty
      ? [{ value: '', label: placeholder || '— No Branch —' }, ...options]
      : options;

    return (
      <Select
        label={label}
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        options={selectOptions}
        required={required}
        disabled={disabled || loading}
      />
    );
  }

  // Multi-select mode (checkbox list)
  const selected = new Set(Array.isArray(value) ? value : []);

  function toggle(branchId) {
    const next = new Set(selected);
    if (next.has(branchId)) next.delete(branchId);
    else next.add(branchId);
    onChange([...next]);
  }

  return (
    <div>
      {label && (
        <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
          {label}
        </label>
      )}
      <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800">
        {loading ? (
          <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">Loading...</div>
        ) : branches.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No branches available</div>
        ) : (
          branches.map((b) => (
            <label
              key={b.id}
              className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(b.id)}
                onChange={() => toggle(b.id)}
                disabled={disabled}
                className="rounded text-blue-600"
              />
              <span className="text-sm text-gray-900 dark:text-slate-100">
                {b.name}
              </span>
              {b.code && (
                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded">
                  {b.code}
                </span>
              )}
            </label>
          ))
        )}
      </div>
      <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">
        {selected.size} selected
      </div>
    </div>
  );
}
