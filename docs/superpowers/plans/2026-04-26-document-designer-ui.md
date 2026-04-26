# FU-035-B: Document Designer Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the visual editor for document templates (per-tenant + per-customer) at `Settings → Document Designer`, consuming the FU-035-A foundation.

**Architecture:** Two pages — `index.js` (doc-type chooser) and `[type].js` (editor for one doc type). Shared `TemplateEditor.js` component handles section toggles + save/delete/reset for both the tenant default and each customer override. State is local per editor instance so multiple panels can have unsaved changes simultaneously.

**Tech Stack:** Next.js pages, React hooks, Tailwind, lucide-react, existing UI primitives (`SettingsLayout`, `Alert`, `Button`, `OrgPicker`).

**Spec reference:** [docs/superpowers/specs/2026-04-26-document-designer-ui-design.md](../specs/2026-04-26-document-designer-ui-design.md)

---

### Task 1: Build the shared `TemplateEditor` component

**Files:**
- Create: `components/settings/document-designer/TemplateEditor.js`

- [ ] **Step 1: Write the component**

```jsx
import { useEffect, useState } from 'react';
import { Save, RotateCcw, Trash2 } from 'lucide-react';
import {
  getSectionsForDocumentType,
  computeVisibility,
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

  // Initial visibility comes from server config; missing keys fall to defaults.
  function buildInitialVisibility(cfg) {
    const incoming = cfg?.visibility || {};
    const out = {};
    for (const s of sections) {
      out[s.id] = s.toggleable
        ? (incoming[s.id] === undefined ? s.defaultVisible : incoming[s.id])
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
    if (!confirm('Delete this customer override? Loads for this customer will fall back to the tenant default.')) return;
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
```

- [ ] **Step 2: Verify dev server compiles**

Use `preview_logs` for the running server and confirm a `✓ Compiled` line appears with no errors. The component isn't yet imported by anything that runs, so it just sits in the bundle.

---

### Task 2: Build the doc-type chooser page

**Files:**
- Create: `pages/settings/document-designer/index.js`

- [ ] **Step 1: Write the chooser page**

```jsx
import Link from 'next/link';
import { FileText } from 'lucide-react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import { DOCUMENT_TYPES } from '../../../lib/constants/document-types';

export default function DocumentDesignerIndex() {
  return (
    <SettingsLayout title="Document Designer">
      <div className="max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Document Designer
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Customize how your printed documents look. Each document type has a <strong>tenant default</strong> applied to every load, plus optional <strong>customer-specific overrides</strong> that take priority for loads with that bill-to customer.
            </p>
          </div>
        </div>

        {/* Doc type cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {DOCUMENT_TYPES.map((dt) => (
            <Link
              key={dt.value}
              href={`/settings/document-designer/${dt.value}`}
              className="block rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold text-gray-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-300">
                    {dt.label}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    {dt.description}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </SettingsLayout>
  );
}
```

- [ ] **Step 2: Verify dev server compiles**

`preview_logs` should show `✓ Compiled` after this file lands. Visit `/settings/document-designer` to confirm both cards render (will require an authenticated session).

---

### Task 3: Build the per-doc-type editor page

**Files:**
- Create: `pages/settings/document-designer/[type].js`

- [ ] **Step 1: Write the editor page**

```jsx
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, FileText, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Alert from '../../../components/ui/Alert';
import OrgPicker from '../../../components/ui/OrgPicker';
import TemplateEditor from '../../../components/settings/document-designer/TemplateEditor';
import {
  isValidDocumentType,
  getDocumentType,
} from '../../../lib/constants/document-types';

export default function DocumentTypeEditor() {
  const router = useRouter();
  const { type } = router.query;
  const docType = typeof type === 'string' ? type : '';
  const docTypeMeta = getDocumentType(docType);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tenantDefault, setTenantDefault] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [pendingCustomer, setPendingCustomer] = useState(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    if (!docType) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tenant/document-templates?document_type=${encodeURIComponent(docType)}`
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const td = (data.templates || []).find((t) => t.customer_id === null) || null;
      const ov = (data.templates || []).filter((t) => t.customer_id !== null);
      setTenantDefault(td);
      setOverrides(ov);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (router.isReady) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, docType]);

  if (!router.isReady) return null;

  if (!isValidDocumentType(docType)) {
    return (
      <SettingsLayout title="Document Designer">
        <div className="max-w-4xl">
          <Alert type="error" message={`Unknown document type: ${docType}`} />
          <Link
            href="/settings/document-designer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 mt-3 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Document Designer
          </Link>
        </div>
      </SettingsLayout>
    );
  }

  async function createOverride() {
    if (!pendingCustomer || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/document-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: pendingCustomer.id,
          document_type: docType,
          section_config: { visibility: {} }, // start with all-defaults
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      // Stamp the customer name onto the row so the accordion can label it
      const stamped = { ...data.template, _customer_name: pendingCustomer.name };
      setOverrides((arr) => [...arr, stamped]);
      setExpandedId(data.template.id);
      setAdding(false);
      setPendingCustomer(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <SettingsLayout title="Document Designer">
      <div className="max-w-4xl">
        {/* Breadcrumb */}
        <Link
          href="/settings/document-designer"
          className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Document Designer
        </Link>

        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              {docTypeMeta?.label || docType}
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              {docTypeMeta?.description}
            </p>
          </div>
        </div>

        {error && <Alert type="error" message={error} className="mb-4" />}

        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <>
            {/* Tenant Default panel */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
                Tenant Default
              </h2>
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
                Applied to every load that doesn't have a customer-specific override below.
              </p>
              <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <TemplateEditor
                  template={
                    tenantDefault || {
                      customer_id: null,
                      document_type: docType,
                      section_config: {},
                    }
                  }
                  showDelete={false}
                  onSaved={(t) => setTenantDefault(t)}
                  onError={setError}
                />
              </div>
            </section>

            {/* Customer Overrides */}
            <section>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
                  Customer Overrides
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(true);
                    setPendingCustomer(null);
                  }}
                  disabled={adding}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add Customer Override
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
                Customer-specific templates take priority over the tenant default for loads with that bill-to customer.
              </p>

              {/* New override inline form */}
              {adding && (
                <div className="rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-4 mb-3">
                  <div className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">
                    Pick a customer:
                  </div>
                  <OrgPicker
                    value={pendingCustomer}
                    onChange={setPendingCustomer}
                    orgType="customer"
                  />
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={createOverride}
                      disabled={!pendingCustomer || creating}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium"
                    >
                      {creating ? 'Adding…' : 'Add'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setPendingCustomer(null);
                      }}
                      disabled={creating}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-slate-300 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Existing overrides */}
              {overrides.length === 0 && !adding ? (
                <div className="py-12 text-center rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40">
                  <FileText className="w-8 h-8 mx-auto text-gray-400 dark:text-slate-600 mb-2" />
                  <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                    No customer overrides yet
                  </div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                    Click "Add Customer Override" to create one.
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {overrides.map((ov) => {
                    const isExpanded = expandedId === ov.id;
                    return (
                      <div
                        key={ov.id}
                        className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : ov.id)}
                          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 text-left"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0" />
                          )}
                          <span className="text-sm font-medium text-gray-900 dark:text-slate-100">
                            {ov._customer_name || `Customer ${ov.customer_id?.slice(0, 8)}…`}
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 border-t border-gray-200 dark:border-slate-700">
                            <TemplateEditor
                              template={ov}
                              showDelete
                              onSaved={(t) =>
                                setOverrides((arr) =>
                                  arr.map((x) =>
                                    x.id === t.id ? { ...t, _customer_name: ov._customer_name } : x
                                  )
                                )
                              }
                              onDeleted={() => {
                                setOverrides((arr) =>
                                  arr.filter((x) => x.id !== ov.id)
                                );
                                setExpandedId(null);
                              }}
                              onError={setError}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </SettingsLayout>
  );
}
```

- [ ] **Step 2: Verify dev server compiles**

`preview_logs` should show `✓ Compiled` for the new dynamic route. The page will be reachable at `/settings/document-designer/delivery_order_full` and `/settings/document-designer/delivery_order_next_move`.

---

### Task 4: Add Settings nav entry + index description

**Files:**
- Modify: `lib/settings-nav.js` (add entry under "Operations" group)
- Modify: `pages/settings/index.js` (add `ITEM_DESCRIPTIONS` entry)

- [ ] **Step 1: Read the current Operations group entries**

Open `lib/settings-nav.js` and find the `Operations` group. It currently has `dispatcher_colors` and `document_validation` entries. We'll add `document_designer` after `document_validation` (related concept: document output customization).

- [ ] **Step 2: Add the nav entry**

Find the line:

```js
      { key: 'document_validation', label: 'Document Validation', href: '/settings/document-validation', icon: ShieldCheck, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
```

Add the following line immediately after it (inside the same `items` array):

```js
      { key: 'document_designer', label: 'Document Designer', href: '/settings/document-designer', icon: FileText, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] },
```

If `FileText` is not yet imported at the top of `lib/settings-nav.js`, add it to the lucide-react import block.

- [ ] **Step 3: Add the description in `pages/settings/index.js`'s `ITEM_DESCRIPTIONS` map**

Find the `ITEM_DESCRIPTIONS` object near the top of `pages/settings/index.js`. Add the new entry alongside the existing entries:

```js
  document_designer: 'Customize printed documents per tenant or per customer.',
```

- [ ] **Step 4: Verify dev server compiles**

`preview_logs` should show `✓ Compiled` after the nav edit.

---

### Task 5: Verification + commit

**Files:**
- Touch: none (verification only) until commit

- [ ] **Step 1: Dispatch a static-verification subagent**

Spawn an Explore subagent with this brief:

```
Verify FU-035-B — Document Designer Settings UI.

1. components/settings/document-designer/TemplateEditor.js exists, default-exports
   a function with the props (template, onSaved, onDeleted, showDelete, onError).
   Save handler chooses POST vs PUT based on template.id presence; PUT body is
   { section_config }; POST body includes customer_id + document_type +
   section_config. Delete uses DELETE /api/tenant/document-templates/[id].

2. pages/settings/document-designer/index.js renders DOCUMENT_TYPES from
   lib/constants/document-types.js as cards linking to
   /settings/document-designer/[value].

3. pages/settings/document-designer/[type].js fetches templates via
   GET /api/tenant/document-templates?document_type=<type>, splits into
   tenantDefault (customer_id IS null) + overrides; renders TemplateEditor
   for tenant default; renders accordion list of overrides; "Add Customer
   Override" inline form uses OrgPicker. Validates [type] via isValidDocumentType.

4. lib/settings-nav.js has a new entry { key: 'document_designer',
   label: 'Document Designer', href: '/settings/document-designer', icon:
   FileText, requiredPermission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL] }
   under the Operations group.

5. pages/settings/index.js's ITEM_DESCRIPTIONS map has a document_designer
   entry.

6. preview_logs (serverId c05f7ae8-1532-45e5-8c5a-26192bd4fe5b) shows recent
   ✓ Compiled with no errors.

Report PASS/FAIL per check.
```

- [ ] **Step 2: Run dd-qa**

Invoke the dd-qa skill. Anticipated:
- Field Consistency: N/A.
- Enum & Reference Data: N/A.
- API Endpoint Shape: N/A (no new API endpoints — pages call FU-035-A's existing endpoints).
- Routing Logic: N/A.
- UI Pattern Compliance: pass — uses standard Tailwind tokens, mirrors umbrellas page, no overflow-hidden, OrgPicker is the established customer picker.

- [ ] **Step 3: Manual browser test (user does this)**

User verifies in a real session:
1. Navigate to Settings → confirm "Document Designer" appears in the Operations group.
2. Click → land on chooser page; both Full DO and Next-Move DO cards visible.
3. Click Full DO → tenant-default editor renders with all toggleable sections checked (defaultVisible=true) and the 3 non-toggleable sections shown as "Always on".
4. Toggle off one section (e.g., Bill-to customer) → Save → success toast → bulk-print a real load → confirm Bill-to is omitted.
5. Click "Add Customer Override" → pick a customer → Add → expanded editor → toggle a section → Save → confirm the row persists; bulk-print a load for that customer → confirm the override applies.
6. Delete the override → confirm it disappears and that load now uses the tenant default.

If any step fails, report and fix; otherwise proceed.

- [ ] **Step 4: Update FU-035 in followups.md**

Move the FU-035 entry from "Open" to "Recently resolved" under `## 2026-04-26`. Note that A and B shipped together this session; FU-035-C (reordering, per-section options, live preview) remains open as a follow-up.

The new follow-up entry under "Open":

```markdown
### FU-035-C: Document Designer — section reordering + per-section options + live preview
- Source: FU-035 split during 2026-04-26 brainstorm (A foundation + B UI shipped same session)
- Scope: medium
- Area: settings / pdf
- Intent: Drag-and-drop section reordering on the editor; per-section options (e.g., `equipment_details.show_seal: false` field-level toggles); live PDF preview iframe alongside the editor. The TemplateEditor.js component is the natural extension point — additive, not restructuring.
- Notes: Spec at `docs/superpowers/specs/2026-04-26-document-designer-ui-design.md` §12 sketches the forward path.
```

The FU-035 resolved entry:

```markdown
### FU-035: Document Designer (per-tenant + per-customer PDF customization)
- **Resolved:** 2026-04-26 in `<sha>` — shipped in two stages this session. FU-035-A (foundation, commit `1ba77ef`) added `document_templates` table (migration 108), the cascade resolver (`lib/pdf/resolve-template-config.js`), CRUD API endpoints, and wired the resolver into the bulk-print pipeline. FU-035-B (this commit) added the visual editor at `/settings/document-designer/` — chooser page + per-doc-type editor with Tenant Default panel + Customer Overrides accordion + section toggle UI. Per-section options + reordering + live preview deferred to FU-035-C. Spec `docs/superpowers/specs/2026-04-26-document-designer-ui-design.md`; plan `docs/superpowers/plans/2026-04-26-document-designer-ui.md`.
```

- [ ] **Step 5: Update MEMORY.md count line**

Bump open count -1, recently-resolved +1; add FU-035-C to open. Net: -1 +1 net (closed FU-035; opened FU-035-C). Update HEAD SHA.

- [ ] **Step 6: Commit**

```bash
git add components/settings/document-designer/ \
        pages/settings/document-designer/ \
        lib/settings-nav.js \
        pages/settings/index.js \
        docs/superpowers/specs/2026-04-26-document-designer-ui-design.md \
        docs/superpowers/plans/2026-04-26-document-designer-ui.md
git add -- "C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md"
git add -- "C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/MEMORY.md"

git commit -m "$(cat <<'EOF'
feat(settings): Document Designer UI for template editing (FU-035-B)

The visual editor for document templates that FU-035-A's schema and
resolver support. Tenants can now manage Delivery Order section
visibility per-tenant and per-customer from
/settings/document-designer/ without writing SQL.

Two pages:
- /settings/document-designer  (doc-type chooser; renders DOCUMENT_TYPES
  registry as cards)
- /settings/document-designer/[type]  (editor for one doc type;
  Tenant Default panel + Customer Overrides accordion + Add inline form)

Shared TemplateEditor component handles section toggles + Save (POST
or PUT depending on whether template.id exists) + Delete (customer
overrides only) + Reset (revert local edits to last-saved). State
is local per editor instance so multiple panels can have unsaved
changes simultaneously without bleeding into each other.

Added Settings nav entry under Operations group; matches the existing
pattern (umbrellas / templates / sender-domains).

Out of scope (filed as FU-035-C): section reordering (drag-drop),
per-section options (field-level toggles like equipment_details.
show_seal), live PDF preview iframe, diff view between tenant default
and customer override.

Resolves: FU-035 (A foundation in 1ba77ef + B UI in this commit)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- §3 routes (chooser + editor) → Tasks 2 + 3 ✓
- §4 state model (per-panel local state) → Task 1 (TemplateEditor) + Task 3 (page-level) ✓
- §5 UI structure (Tenant Default + Customer Overrides accordion) → Task 3 ✓
- §6 shared component → Task 1 ✓
- §7 permissions (SETTINGS|ALL on nav entry) → Task 4 ✓
- §8 error handling (Alert + per-editor onError prop) → Tasks 1 + 3 ✓
- §9 testing (subagent + manual browser) → Task 5 ✓

**Placeholder scan:** none.

**Type consistency:** `template` shape (`{ id, customer_id, document_type, section_config }`) is consistent across TemplateEditor (Task 1), the editor page (Task 3), and the FU-035-A API responses (already shipped). The `_customer_name` augmentation is a UI-only field added in Task 3 and read by both Task 3's accordion header and consistently passed through Task 1's `onSaved` re-merge.
