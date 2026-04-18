import { useEffect, useState } from 'react';

const INVOICE_TOKENS = [
  '{{invoice.number}}', '{{invoice.total}}', '{{invoice.subtotal}}',
  '{{invoice.due_date}}', '{{invoice.issue_date}}', '{{invoice.reference_number}}',
];
const RATE_CON_TOKENS = [
  '{{charge_set.number}}', '{{charge_set.total}}', '{{charge_set.reference_number}}',
];
const SHARED_TOKENS = [
  '{{customer.name}}', '{{customer.primary_contact_name}}',
  '{{load.order_number}}', '{{load.customer_reference}}',
  '{{container.number}}', '{{pickup.name}}', '{{delivery.name}}',
  '{{tenant.name}}',
];

export default function TemplateEditor({ systemSlug }) {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDirty(false);
    setRow(null);
    fetch('/api/tenant/ar/config/email-templates')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) { setError(d.error); return; }
        setRow(d[systemSlug] || null);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [systemSlug]);

  // Auto-dismiss toast after 3s; cleanup cancels the timer on unmount
  // or on a new toast arriving (so the window restarts, matching the
  // BillingPipelineTab pattern used elsewhere in the codebase).
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  function updateField(field, value) {
    setRow((r) => ({ ...r, [field]: value }));
    setDirty(true);
  }

  async function copyToken(tok) {
    try {
      await navigator.clipboard.writeText(tok);
      setToast({ type: 'success', message: `Copied ${tok}` });
    } catch {
      setToast({ type: 'error', message: 'Copy failed — paste manually' });
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/ar/config/email-templates/${systemSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: row.subject,
          body_text: row.body_text,
          body_html: row.body_html,
          body_format: row.body_format,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed');
      setRow(data);
      setDirty(false);
      setToast({ type: 'success', message: 'Template saved' });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    if (!window.confirm('Reset this template to the default subject and body? Your customizations will be overwritten.')) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/ar/config/email-templates/${systemSlug}/reset`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Reset failed');
      setRow(data);
      setDirty(false);
      setToast({ type: 'success', message: 'Template reset to default' });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-gray-500 dark:text-slate-400">Loading template…</div>;
  if (error && !row) return <div className="text-sm text-red-600 dark:text-red-400">Error: {error}</div>;
  if (!row) return <div className="text-sm text-gray-500 dark:text-slate-400">Template not found. Did migration 079 run?</div>;

  const tokens = systemSlug === 'invoice_send' ? INVOICE_TOKENS : RATE_CON_TOKENS;

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`text-sm px-3 py-2 rounded ${toast.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'}`}>
          {toast.message}
        </div>
      )}
      {error && (
        <div className="text-sm px-3 py-2 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div>
        <label htmlFor={`te-${systemSlug}-subject`} className="block text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">Subject</label>
        <input
          id={`te-${systemSlug}-subject`}
          type="text"
          value={row.subject}
          onChange={(e) => updateField('subject', e.target.value)}
          className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor={`te-${systemSlug}-body`} className="block text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Body</label>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => updateField('body_format', 'plain')}
              className={`px-2 py-0.5 rounded ${row.body_format === 'plain' ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-slate-400'}`}
            >Plain</button>
            <button
              type="button"
              onClick={() => updateField('body_format', 'html')}
              className={`px-2 py-0.5 rounded ${row.body_format === 'html' ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-slate-400'}`}
            >HTML</button>
          </div>
        </div>
        <textarea
          id={`te-${systemSlug}-body`}
          rows={10}
          value={row.body_format === 'html' ? row.body_html : row.body_text}
          onChange={(e) => {
            if (row.body_format === 'html') updateField('body_html', e.target.value);
            else updateField('body_text', e.target.value);
          }}
          className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm font-mono"
        />
      </div>

      <div className="bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded p-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Available variables (click to copy)</div>
        <div className="flex flex-wrap gap-1.5">
          {[...tokens, ...SHARED_TOKENS].map((tok) => (
            <button
              key={tok}
              type="button"
              onClick={() => copyToken(tok)}
              className="text-xs font-mono px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
            >{tok}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-slate-700">
        <button
          type="button"
          onClick={resetToDefault}
          disabled={saving}
          className="text-xs text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 disabled:opacity-50"
        >Reset to default</button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
      </div>
    </div>
  );
}
