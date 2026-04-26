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
  const [pendingCustomer, setPendingCustomer] = useState(null); // { id, name } | null
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
      const ov = (data.templates || [])
        .filter((t) => t.customer_id !== null)
        .map((t) => ({ ...t, _customer_name: t.customer?.name }));
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
          section_config: { visibility: {} },
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
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
        <Link
          href="/settings/document-designer"
          className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Document Designer
        </Link>

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

              {adding && (
                <div className="rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-4 mb-3">
                  <div className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">
                    Pick a customer:
                  </div>
                  <OrgPicker
                    label="Customer"
                    type="customer"
                    value={pendingCustomer?.id || ''}
                    valueLabel={pendingCustomer?.name || ''}
                    onChange={(org) =>
                      setPendingCustomer(org ? { id: org.id, name: org.name } : null)
                    }
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
                        className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : ov.id)}
                          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 text-left rounded-xl"
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
                                    x.id === t.id
                                      ? { ...t, _customer_name: ov._customer_name }
                                      : x
                                  )
                                )
                              }
                              onDeleted={() => {
                                setOverrides((arr) => arr.filter((x) => x.id !== ov.id));
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
