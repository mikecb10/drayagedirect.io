import { useEffect, useState } from 'react';
import { Save, RotateCcw, Trash2 } from 'lucide-react';
import {
  getSectionsForDocumentType,
} from '../../../lib/constants/document-sections';

/**
 * Editor for a single document_templates row. Handles section
 * visibility toggles, save (POST or PUT), delete (DELETE), and
 * reset (revert local state to last-loaded value).
 *
 * Props:
 *   template   — { id?, customer_id, document_type, section_config }
 *                If id is missing, save uses POST to create the row.
 *   onSaved    — called with the server-returned template after save
 *   onDeleted  — called after a successful delete (only when template.id exists)
 *   showDelete — whether to render the Delete button (false for tenant default)
 *   onError    — surfaces an error string for the parent to display
 */
export default function TemplateEditor({
  template,
  onSaved,
  onDeleted,
  showDelete = false,
  onError,
}) {
  const sections = getSectionsForDocumentType(template.document_type);

  function buildInitialVisibility(cfg) {
    const incoming = cfg?.visibility || {};
    const out = {};
    for (const s of sections) {
      out[s.id] = s.toggleable
        ? incoming[s.id] === undefined
          ? s.defaultVisible
          : incoming[s.id]
        : true;
    }
    return out;
  }

  const [visibility, setVisibility] = useState(() =>
    buildInitialVisibility(template.section_config)
  );
  const [savedVisibility, setSavedVisibility] = useState(() =>
    buildInitialVisibility(template.section_config)
  );
  const [busy, setBusy] = useState(false);

  // Re-sync if the parent swaps the template prop (e.g., after another
  // panel's save changes the server state).
  useEffect(() => {
    const v = buildInitialVisibility(template.section_config);
    setVisibility(v);
    setSavedVisibility(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.section_config, template.id]);

  const isDirty =
    JSON.stringify(visibility) !== JSON.stringify(savedVisibility);

  function toggle(sectionId) {
    setVisibility((v) => ({ ...v, [sectionId]: !v[sectionId] }));
  }

  function reset() {
    setVisibility(savedVisibility);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    onError?.(null);
    try {
      const sectionConfigToSend = {
        visibility: Object.fromEntries(
          sections
            .filter((s) => s.toggleable)
            .map((s) => [s.id, visibility[s.id]])
        ),
      };
      const isNew = !template.id;
      const url = isNew
        ? '/api/tenant/document-templates'
        : `/api/tenant/document-templates/${template.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const body = isNew
        ? {
            customer_id: template.customer_id || null,
            document_type: template.document_type,
            section_config: sectionConfigToSend,
          }
        : { section_config: sectionConfigToSend };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSavedVisibility(visibility);
      onSaved?.(data.template);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate() {
    if (busy || !template.id) return;
    if (
      !confirm(
        'Delete this customer override? Loads for this customer will fall back to the tenant default.'
      )
    ) {
      return;
    }
    setBusy(true);
    onError?.(null);
    try {
      const res = await fetch(
        `/api/tenant/document-templates/${template.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      onDeleted?.();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {sections.map((s) => {
          const checked = visibility[s.id];
          if (!s.toggleable) {
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-slate-900/40 border border-gray-200 dark:border-slate-700/50 opacity-70"
              >
                <span className="w-4 h-4 inline-block rounded border-2 border-gray-400 dark:border-slate-500 bg-gray-200 dark:bg-slate-700" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
                    {s.label}
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 bg-gray-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                  Always on
                </span>
              </div>
            );
          }
          return (
            <label
              key={s.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-600 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(s.id)}
                disabled={busy}
                className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
                  {s.label}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">
                  Default: {s.defaultVisible ? 'visible' : 'hidden'}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-slate-700">
        <button
          type="button"
          onClick={save}
          disabled={!isDirty || busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
        >
          <Save className="w-4 h-4" />
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!isDirty || busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-slate-300 text-sm font-medium"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </button>
        {showDelete && template.id ? (
          <button
            type="button"
            onClick={deleteTemplate}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 text-red-600 dark:text-red-400 text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
