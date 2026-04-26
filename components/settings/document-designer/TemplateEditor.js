import { useEffect, useState } from 'react';
import { Save, RotateCcw, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { getSectionsForDocumentType } from '../../../lib/constants/document-sections';
import DocumentPreview from './preview/DocumentPreview';

/**
 * Editor for a single document_templates row. Renders each section as a
 * collapsible card with a master toggle + 2-col grid of child field toggles.
 *
 * State shape:
 *   visibility: { [sectionId]: boolean }   — master toggle per section
 *   fields:     { [sectionId]: { [fieldId]: boolean } }  — field toggles
 *
 * Save serializes back to:
 *   { visibility: {...}, perSection: { [id]: { fields: {...} } } }
 *
 * Default-true for any unspecified field (handled both at compute and render).
 */
function buildInitialState(sections, sectionConfig) {
  const visibility = {};
  const fields = {};
  for (const s of sections) {
    if (!s.toggleable) {
      visibility[s.id] = true;
    } else {
      const v = sectionConfig?.visibility?.[s.id];
      visibility[s.id] = v === undefined ? s.defaultVisible : v;
    }
    if (s.fields) {
      const overrides = sectionConfig?.perSection?.[s.id]?.fields || {};
      const resolved = {};
      for (const f of s.fields) {
        const v = overrides[f.id];
        resolved[f.id] = v === undefined ? f.defaultVisible : v;
      }
      fields[s.id] = resolved;
    }
  }
  return { visibility, fields };
}

export default function TemplateEditor({
  template,
  onSaved,
  onDeleted,
  showDelete = false,
  onError,
}) {
  const sections = getSectionsForDocumentType(template.document_type);

  const [{ visibility, fields }, setState] = useState(() =>
    buildInitialState(sections, template.section_config)
  );
  const [savedState, setSavedState] = useState(() =>
    buildInitialState(sections, template.section_config)
  );
  const [collapsed, setCollapsed] = useState({}); // { [sectionId]: true } when collapsed
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const initial = buildInitialState(sections, template.section_config);
    setState(initial);
    setSavedState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.section_config, template.id]);

  const isDirty =
    JSON.stringify({ visibility, fields }) !== JSON.stringify(savedState);

  function toggleMaster(sectionId) {
    setState((prev) => ({
      ...prev,
      visibility: { ...prev.visibility, [sectionId]: !prev.visibility[sectionId] },
    }));
  }

  function toggleField(sectionId, fieldId) {
    setState((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        [sectionId]: {
          ...prev.fields[sectionId],
          [fieldId]: !prev.fields[sectionId]?.[fieldId],
        },
      },
    }));
  }

  function toggleCollapsed(sectionId) {
    setCollapsed((c) => ({ ...c, [sectionId]: !c[sectionId] }));
  }

  function reset() {
    setState(savedState);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    onError?.(null);
    try {
      const visibilityToSend = Object.fromEntries(
        sections
          .filter((s) => s.toggleable)
          .map((s) => [s.id, visibility[s.id]])
      );
      const perSectionToSend = {};
      for (const s of sections) {
        if (s.fields) {
          perSectionToSend[s.id] = {
            fields: Object.fromEntries(
              s.fields.map((f) => [f.id, fields[s.id]?.[f.id] ?? f.defaultVisible])
            ),
          };
        }
      }
      const sectionConfigToSend = {
        visibility: visibilityToSend,
        perSection: perSectionToSend,
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
      setSavedState({ visibility, fields });
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
    ) return;
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
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Editor side */}
      <div className="lg:w-2/5 space-y-3">
        <div className="space-y-2">
          {sections.map((s) => (
            <SectionCard
              key={s.id}
              section={s}
              masterChecked={visibility[s.id]}
              fieldsState={fields[s.id] || {}}
              collapsed={!!collapsed[s.id]}
              busy={busy}
              onToggleMaster={() => toggleMaster(s.id)}
              onToggleField={(fid) => toggleField(s.id, fid)}
              onToggleCollapsed={() => toggleCollapsed(s.id)}
            />
          ))}
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

      {/* Preview side */}
      <div className="lg:w-3/5 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <DocumentPreview
          visibility={visibility}
          fields={fields}
          sections={sections}
        />
      </div>
    </div>
  );
}

function SectionCard({
  section,
  masterChecked,
  fieldsState,
  collapsed,
  busy,
  onToggleMaster,
  onToggleField,
  onToggleCollapsed,
}) {
  const hasFields = Array.isArray(section.fields) && section.fields.length > 0;
  const masterDisabled = busy || !section.toggleable;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50/60 dark:bg-slate-800/40">
        {section.toggleable ? (
          <input
            type="checkbox"
            checked={!!masterChecked}
            onChange={onToggleMaster}
            disabled={masterDisabled}
            className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
          />
        ) : (
          <span className="w-4 h-4 inline-block rounded border-2 border-gray-400 dark:border-slate-500 bg-gray-200 dark:bg-slate-700" />
        )}
        <span className="text-sm font-medium text-gray-900 dark:text-slate-100 flex-1">
          {section.label}
        </span>
        {!section.toggleable ? (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 bg-gray-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">
            Always on
          </span>
        ) : null}
        {hasFields ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        ) : null}
      </div>
      {hasFields && !collapsed ? (
        <div
          className={`grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 border-t border-gray-200 dark:border-slate-800 ${
            !masterChecked ? 'opacity-50' : ''
          }`}
        >
          {section.fields.map((f) => (
            <label
              key={f.id}
              className={`flex items-center gap-2 text-sm ${
                !masterChecked || busy ? 'cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                checked={!!fieldsState[f.id]}
                onChange={() => onToggleField(f.id)}
                disabled={!masterChecked || busy}
                className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-gray-900 dark:text-slate-100">{f.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
