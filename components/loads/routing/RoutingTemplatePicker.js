import { useEffect, useState } from 'react';

/**
 * RoutingTemplatePicker — dropdown at the top of the Routing tab.
 *
 * Fetches system + tenant templates once. Calls onSelect(templateId, templateName)
 * when the user chooses a template. Does NOT seed events — the parent handles
 * that so it can warn when events already exist.
 */
export default function RoutingTemplatePicker({ value, onSelect, disabled }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/tenant/routing-templates');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setTemplates(data.templates || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1">
        Routing Template
      </label>
      <select
        disabled={disabled || loading}
        value={value || ''}
        onChange={(e) => {
          const id = e.target.value || null;
          const tpl = templates.find((t) => t.id === id);
          onSelect(id, tpl?.name || null);
        }}
        className="block w-64 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:bg-gray-50 dark:disabled:bg-slate-900 disabled:text-gray-400 dark:disabled:text-slate-500"
      >
        <option value="">— Select template —</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
