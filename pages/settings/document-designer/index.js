import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { FileText } from 'lucide-react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Alert from '../../../components/ui/Alert';
import TemplateEditor from '../../../components/settings/document-designer/TemplateEditor';
import ConfigurationBar from '../../../components/settings/document-designer/ConfigurationBar';
import {
  isValidDocumentType,
  getDocumentType,
  DOCUMENT_TYPES,
} from '../../../lib/constants/document-types';

const DEFAULT_DOC_TYPE = DOCUMENT_TYPES[0]?.value || 'delivery_order_full';
const DEFAULT_COLORS = { accent: '#3B82F6', text: '#111827' };

export default function DocumentDesignerPage() {
  const router = useRouter();

  const [selectedDocType, setSelectedDocType] = useState(DEFAULT_DOC_TYPE);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);

  const [templates, setTemplates] = useState([]); // all templates for current doc type
  const [customers, setCustomers] = useState([]); // [{id, name}]
  const [branding, setBranding] = useState(null); // {tenantName, logo_url}

  const [liveColors, setLiveColors] = useState(DEFAULT_COLORS);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editorIsDirty, setEditorIsDirty] = useState(false);

  // Sync state from URL on first render and on subsequent route changes.
  useEffect(() => {
    if (!router.isReady) return;
    const t = typeof router.query.type === 'string' && isValidDocumentType(router.query.type)
      ? router.query.type
      : DEFAULT_DOC_TYPE;
    const c = typeof router.query.customer === 'string' && router.query.customer
      ? router.query.customer
      : null;
    setSelectedDocType(t);
    setSelectedCustomerId(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.type, router.query.customer]);

  // Fetch /api/tenant/me for branding once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tenant/me');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setBranding({
          tenantName: data.branding?.companyName || data.branding?.tenantName || null,
          logo_url: data.branding?.logoSmall || data.branding?.logoLarge || null,
        });
      } catch { /* ignore — preview falls back to placeholders */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch customer list once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tenant/organizations?type=customer');
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;
        setCustomers(
          (data.organizations || []).map((o) => ({ id: o.id, name: o.name })),
        );
      } catch (e) {
        if (!cancelled) setError(`Customer list: ${e.message}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch templates whenever doc type changes.
  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/tenant/document-templates?document_type=${encodeURIComponent(selectedDocType)}`,
        );
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) setTemplates(data.templates || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router.isReady, selectedDocType]);

  // Resolve the current template based on selectedCustomerId.
  const tenantDefault = templates.find((t) => t.customer_id === null);
  const currentOverride = selectedCustomerId
    ? templates.find((t) => t.customer_id === selectedCustomerId)
    : null;

  const currentTemplate = selectedCustomerId === null
    ? (tenantDefault || { customer_id: null, document_type: selectedDocType, section_config: {} })
    : (currentOverride || { customer_id: selectedCustomerId, document_type: selectedDocType, section_config: {} });

  const existingOverrideCustomerIds = new Set(
    templates.filter((t) => t.customer_id !== null).map((t) => t.customer_id),
  );

  const showNoOverrideNote =
    selectedCustomerId !== null && !existingOverrideCustomerIds.has(selectedCustomerId);

  const docTypeMeta = getDocumentType(selectedDocType);

  function confirmDiscard() {
    if (!editorIsDirty) return true;
    return confirm('You have unsaved changes. Discard them?');
  }

  function updateUrl(newType, newCustomer) {
    const query = { type: newType };
    if (newCustomer) query.customer = newCustomer;
    router.replace(
      { pathname: '/settings/document-designer', query },
      undefined,
      { shallow: true },
    );
  }

  function handleDocTypeChange(newType) {
    if (!confirmDiscard()) return;
    setSelectedDocType(newType);
    updateUrl(newType, selectedCustomerId);
  }

  function handleCustomerChange(newCustomerId) {
    if (!confirmDiscard()) return;
    setSelectedCustomerId(newCustomerId);
    updateUrl(selectedDocType, newCustomerId);
  }

  function handleSaved(savedTemplate) {
    setTemplates((arr) => {
      const existing = arr.find((t) => t.id === savedTemplate.id);
      if (existing) {
        return arr.map((t) => (t.id === savedTemplate.id ? savedTemplate : t));
      }
      return [...arr, savedTemplate];
    });
  }

  function handleDeleted() {
    setTemplates((arr) => arr.filter((t) => t.customer_id !== selectedCustomerId));
    setSelectedCustomerId(null);
    updateUrl(selectedDocType, null);
  }

  return (
    <SettingsLayout title="Document Designer">
      <div className="max-w-7xl">
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Document Designer
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Customize how your printed documents look. Pick a customer to edit
              that customer's override, or "All Customers" for the tenant default.
              {docTypeMeta?.description ? ` Currently editing: ${docTypeMeta.label}.` : ''}
            </p>
          </div>
        </div>

        {error && <Alert type="error" message={error} className="mb-4" />}

        <ConfigurationBar
          selectedDocType={selectedDocType}
          selectedCustomerId={selectedCustomerId}
          customers={customers}
          existingOverrideCustomerIds={existingOverrideCustomerIds}
          colors={liveColors}
          onDocTypeChange={handleDocTypeChange}
          onCustomerChange={handleCustomerChange}
          onColorsChange={setLiveColors}
          showNoOverrideNote={showNoOverrideNote}
          disabled={loading}
        />

        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <TemplateEditor
            template={currentTemplate}
            showDelete={selectedCustomerId !== null}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onError={setError}
            onDirtyChange={setEditorIsDirty}
            branding={branding}
            colors={liveColors}
            onColorsChange={setLiveColors}
            key={`${selectedDocType}-${selectedCustomerId || 'tenant'}`}
          />
        )}
      </div>
    </SettingsLayout>
  );
}
