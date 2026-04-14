import { useEffect, useState } from 'react';
import { FileCheck, Save, Info } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import { REQUIRED_DOCUMENT_TYPES } from '../../lib/org-form-config';

/**
 * Settings → Operations → Document Validation
 *
 * Lets each tenant configure which document types require dispatcher
 * approval before being finalized. Documents of types NOT in this list
 * are auto-approved on upload (skip the "received" queue entirely).
 *
 * Common setup: POD and BOL require validation, everything else
 * auto-approves.
 */

// Merge the common load-level types with the full org-form-config list
// so dispatchers can pick from every known type.
const COMMON_TYPES = [
  { value: 'pod', label: 'Proof of Delivery (POD)', group: 'Common' },
  { value: 'bol', label: 'Bill of Lading (BOL)', group: 'Common' },
  { value: 'weight_ticket', label: 'Weight Ticket', group: 'Common' },
  { value: 'rate_confirmation', label: 'Rate Confirmation', group: 'Common' },
  { value: 'invoice', label: 'Invoice', group: 'Common' },
  { value: 'receipt', label: 'Receipt', group: 'Common' },
  { value: 'photo', label: 'Photo', group: 'Common' },
];

// Group the org-form types by their comment sections
const EXTENDED_TYPES = REQUIRED_DOCUMENT_TYPES.map((t) => ({
  value: t.value,
  label: t.label,
  group: 'Extended',
}));

// Combine and dedupe by value
const ALL_TYPES = (() => {
  const seen = new Set();
  const result = [];
  for (const t of [...COMMON_TYPES, ...EXTENDED_TYPES]) {
    const key = t.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  return result;
})();

export default function DocumentValidationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/tenant/settings');
        if (!res.ok) throw new Error('Failed to load settings');
        const data = await res.json();
        const types = data.settings?.validation_required_doc_types || [];
        setSelected(new Set(Array.isArray(types) ? types : []));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggleType(value) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    setSuccess(null);
  }

  function selectAll() {
    setSelected(new Set(ALL_TYPES.map((t) => t.value)));
    setSuccess(null);
  }

  function clearAll() {
    setSelected(new Set());
    setSuccess(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/tenant/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          validation_required_doc_types: Array.from(selected),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Save failed');
      }
      setSuccess('Document validation settings saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const commonTypes = ALL_TYPES.filter((t) => t.group === 'Common');
  const extendedTypes = ALL_TYPES.filter((t) => t.group === 'Extended');

  return (
    <SettingsLayout title="Document Validation">
      <div className="max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <FileCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Document Validation
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Choose which document types require dispatcher approval before being finalized. Documents of types <strong>not</strong> in this list are auto-approved on upload.
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 p-3 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">
            When a driver uploads a document type that&apos;s checked below, it goes to the <strong>Received</strong> queue for dispatcher review. Unchecked types skip the queue and are approved instantly.
          </div>
        </div>

        {error && <Alert type="error" message={error} className="mb-4" />}
        {success && <Alert type="success" message={success} className="mb-4" />}

        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <>
            {/* Quick actions */}
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Select all
              </button>
              <span className="text-gray-300 dark:text-slate-600">|</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear all
              </button>
              <span className="ml-auto text-xs text-gray-500 dark:text-slate-400">
                <strong className="text-gray-900 dark:text-slate-100">{selected.size}</strong> of {ALL_TYPES.length} types require validation
              </span>
            </div>

            {/* Common types */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">
                Common Document Types
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {commonTypes.map((t) => (
                  <TypeCheckbox
                    key={t.value}
                    type={t}
                    checked={selected.has(t.value)}
                    onToggle={() => toggleType(t.value)}
                  />
                ))}
              </div>
            </div>

            {/* Extended types */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">
                Extended Document Types
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {extendedTypes.map((t) => (
                  <TypeCheckbox
                    key={t.value}
                    type={t}
                    checked={selected.has(t.value)}
                    onToggle={() => toggleType(t.value)}
                  />
                ))}
              </div>
            </div>

            {/* Save bar */}
            <div className="sticky bottom-0 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 bg-white/95 dark:bg-slate-950/95 border-t border-gray-200 dark:border-slate-800 backdrop-blur flex items-center justify-end gap-3">
              <Button onClick={handleSave} loading={saving}>
                <Save className="w-3.5 h-3.5 mr-1.5" />
                Save
              </Button>
            </div>
          </>
        )}
      </div>
    </SettingsLayout>
  );
}

function TypeCheckbox({ type, checked, onToggle }) {
  return (
    <label
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
        checked
          ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40'
          : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-700'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-950"
      />
      <span
        className={`text-xs font-medium ${
          checked
            ? 'text-blue-700 dark:text-blue-300'
            : 'text-gray-700 dark:text-slate-300'
        }`}
      >
        {type.label}
      </span>
    </label>
  );
}
