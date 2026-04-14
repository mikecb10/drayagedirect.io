import { useEffect, useState, useRef, useMemo } from 'react';
import { X, Search, ChevronDown } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Checkbox from '../ui/Checkbox';
import FormSection from '../ui/FormSection';
import Alert from '../ui/Alert';
import CurrencyInput from '../ui/CurrencyInput';
import AddressAutocomplete from '../ui/AddressAutocomplete';
import StatePicker from '../ui/StatePicker';
import { getVisibleSections, ORG_SUBTYPES, INVOICE_COMBINATIONS, PAYMENT_TERMS_FROM, PAY_TYPES, REQUIRED_DOCUMENT_TYPES } from '../../lib/org-form-config';

// ── Searchable Multi-Select for Document Types ───────────────
function DocMultiSelect({ selected = [], options, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function toggle(value) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  function remove(value) {
    onChange(selected.filter((v) => v !== value));
  }

  function getLabel(value) {
    return options.find((o) => o.value === value)?.label || value;
  }

  return (
    <div ref={wrapperRef} className="relative">
      {/* Selected pills + input */}
      <div
        onClick={() => setOpen(true)}
        className="min-h-[40px] rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/40"
      >
        {selected.map((val) => (
          <span key={val} className="inline-flex items-center gap-1 text-[11px] font-medium bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
            {getLabel(val)}
            <button type="button" onClick={(e) => { e.stopPropagation(); remove(val); }} className="hover:text-blue-900 dark:hover:text-blue-100">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {selected.length === 0 && !open && (
          <span className="text-sm text-gray-400 dark:text-slate-500 px-1">Select required documents...</span>
        )}
        {open && (
          <input
            type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..." autoFocus
            className="flex-1 min-w-[100px] text-sm bg-transparent outline-none border-none py-0.5"
          />
        )}
        <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400 dark:text-slate-500 text-center">No matching document types</div>
          ) : (
            filtered.map((opt) => {
              const isChecked = selected.includes(opt.value);
              return (
                <button key={opt.value} type="button"
                  onClick={() => toggle(opt.value)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors ${isChecked ? 'bg-blue-50/60 dark:bg-blue-950/40' : ''}`}>
                  <input type="checkbox" checked={isChecked} readOnly
                    className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5 pointer-events-none" />
                  <span className={`${isChecked ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-700 dark:text-slate-200'}`}>{opt.label}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const TYPE_OPTIONS = [
  {
    value: 'customer',
    label: 'Customer',
    description: 'Bill-to party or load owner — the account that receives invoices',
  },
  {
    value: 'terminal',
    label: 'Terminal',
    description: 'Port or rail terminal — pickup and return locations for containers',
  },
  {
    value: 'warehouse',
    label: 'Warehouse',
    description: 'Delivery destination or loading origin for containers',
  },
  {
    value: 'yard',
    label: 'Yard',
    description: 'Storage location for containers between moves; chassis split site',
  },
  {
    value: 'final_destination',
    label: 'Final Destination',
    description: 'Outbound post-rail destination (location only, never a bill-to party) — used for accurate BOL and rail routing data',
  },
];

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'CAD', label: 'CAD' },
  { value: 'MXN', label: 'MXN' },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const PAYMENT_FROM_OPTIONS = [
  { value: 'invoice_date', label: 'Invoice Date' },
  { value: 'delivery_date', label: 'Delivery Date' },
  { value: 'pickup_date', label: 'Pickup Date' },
];

const EMPTY_FORM = {
  name: '',
  customer_types: ['customer'],
  profile_label: '',
  tracking_status: false,
  terminal_market: '',
  mc_number: '',
  address_line1: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
  phone: '',
  billing_email: '',
  receiver_email: '',
  quickbooks_email: '',
  company_domain: '',
  portal_email: '',
  portal_enabled: false,
  portal_admin_email: '',
  currency: 'USD',
  payment_terms: 30,
  payment_terms_days: 30,
  payment_term_method: 'daily',
  payment_terms_from: 'invoice_date',
  invoice_combination_rule: 'by_load',
  credit_limit_cents: null,
  account_hold: false,
  office_hour_start: '',
  office_hour_end: '',
  main_contact_name: '',
  main_phone: '',
  secondary_contact_name: '',
  secondary_phone: '',
  sales_agent: '',
  organization_subtypes: [],
  quickbooks_company_field: '',
  pay_type: '',
  organization_tags: [],
  is_hazmat_certified: false,
  can_edit_load: false,
  tir_optional: false,
  invoice_combination: '',
  required_documents: [],
  validation_required_doc_types: [],
  notes: '',
};

export default function OrganizationModal({ isOpen, onClose, onSuccess, editing = null }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [systemTerminals, setSystemTerminals] = useState([]);

  // Fetch system terminals for the Profile Label dropdown
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/tenant/terminals?all=true')
      .then((r) => (r.ok ? r.json() : { terminals: [] }))
      .then((data) => setSystemTerminals(data.terminals || []))
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (editing) {
        setForm({
          ...EMPTY_FORM,
          ...editing,
          customer_types: editing.customer_types || ['customer'],
          payment_terms: editing.payment_terms ?? 30,
          credit_limit_cents: editing.credit_limit_cents ?? null,
        });
      } else {
        setForm(EMPTY_FORM);
      }
    }
  }, [isOpen, editing]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleType(type) {
    setForm((f) => {
      const has = f.customer_types.includes(type);
      return {
        ...f,
        customer_types: has
          ? f.customer_types.filter((t) => t !== type)
          : [...f.customer_types, type],
      };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (form.customer_types.length === 0) {
        throw new Error('Select at least one organization type');
      }

      const url = editing
        ? `/api/tenant/organizations/${editing.id}`
        : '/api/tenant/organizations';
      const method = editing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save organization');
      }

      const data = await res.json();
      onSuccess?.(data.organization);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'Add Organization'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <Alert type="error" message={error} />}

        {/* Type selector */}
        <FormSection
          title="Organization Type"
          description="An organization can be one or more types simultaneously (e.g. a customer can also be the delivery warehouse)."
          columns={1}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TYPE_OPTIONS.map((t) => {
              const checked = form.customer_types.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => toggleType(t.value)}
                  className={`text-left rounded-lg border-2 p-3 transition-colors ${
                    checked
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                      : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {}}
                      className="mt-0.5 w-4 h-4 rounded text-blue-600 border-gray-300 dark:border-slate-600 pointer-events-none"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{t.label}</div>
                      <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 leading-snug">
                        {t.description}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </FormSection>

        {/* Identity — always shown */}
        {(() => {
          const vis = getVisibleSections(form.customer_types);
          const isTerminal = form.customer_types.includes('terminal');
          return (
            <>
        <FormSection title={isTerminal ? 'Terminal Identity' : 'Identity'}>
          {isTerminal && (
            <>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                  Profile Label (System Terminal) *
                </label>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
                  This is the immutable backend key used for tracking APIs. You cannot edit or create labels — only select from the system list. Your Profile Name below is what dispatchers see.
                </p>
                <TerminalLabelPicker
                  terminals={systemTerminals}
                  value={form.profile_label}
                  onChange={(terminal) => {
                    if (terminal) {
                      update('profile_label', terminal.label);
                      update('source_terminal_id', terminal.id);
                      update('terminal_market', terminal.market);
                      update('tracking_status', terminal.effective_enabled ?? true);
                      // Pre-fill address from terminal if empty
                      if (!form.address_line1) {
                        update('address_line1', terminal.address || '');
                        update('city', terminal.city || '');
                        update('state', terminal.state || '');
                        update('zip', terminal.zip || '');
                      }
                      // Set profile name to the terminal's effective name if empty
                      if (!form.name) {
                        update('name', terminal.effective_name || terminal.default_name || terminal.label);
                      }
                    } else {
                      update('profile_label', '');
                      update('source_terminal_id', null);
                    }
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">Tracking Status</label>
                <div className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${
                  form.tracking_status ? 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400'
                }`}>
                  {form.tracking_status ? '✓ Tracking Active' : '✗ Not Tracking'}
                </div>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Depends on API configuration for this terminal</p>
              </div>
            </>
          )}
          <Input
            label="Profile Name *"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            required
            className={isTerminal ? '' : 'sm:col-span-2'}
          />
          {isTerminal && (
            <Input
              label="Market"
              value={form.terminal_market || ''}
              onChange={(e) => update('terminal_market', e.target.value)}
              helpText="e.g. LA/LB, NY/NJ, Chicago"
            />
          )}
          <Input
            label="MC Number"
            value={form.mc_number || ''}
            onChange={(e) => update('mc_number', e.target.value)}
          />
        </FormSection>

        {/* Company address — always shown */}
        <FormSection title="Company" description="Physical address and primary phone">
          <AddressAutocomplete
            label="Address"
            value={form.address_line1 || ''}
            onChange={(val) => update('address_line1', val)}
            onSelect={(addr) => {
              setForm((f) => ({
                ...f,
                address_line1: addr.street || f.address_line1,
                city: addr.city || f.city,
                state: addr.state || f.state,
                zip: addr.zip || f.zip,
                country: addr.country || f.country,
              }));
            }}
            helpText="Type a street address to see suggestions"
            className="sm:col-span-2"
          />
          <Input
            label="City"
            value={form.city || ''}
            onChange={(e) => update('city', e.target.value)}
          />
          <StatePicker
            label="State"
            value={form.state || ''}
            onChange={(v) => update('state', v)}
          />
          <Input
            label="Zip Code"
            value={form.zip || ''}
            onChange={(e) => update('zip', e.target.value)}
          />
          <Input
            label="Country"
            value={form.country || ''}
            onChange={(e) => update('country', e.target.value)}
          />
          <Input
            label="Main Phone"
            value={form.phone || ''}
            onChange={(e) => update('phone', e.target.value)}
          />
        </FormSection>

        {/* Email — Customer (full) + Warehouse (partial) */}
        {vis.email && (
          <FormSection title="Email">
            {vis.email === true && (
              <Input label="Billing Email" type="email" value={form.billing_email || ''} onChange={(e) => update('billing_email', e.target.value)} helpText="Receives invoices when generated" />
            )}
            <Input label="Receiver Email" type="email" value={form.receiver_email || ''} onChange={(e) => update('receiver_email', e.target.value)} helpText="Receives system-generated emails and notifications" />
            {vis.email === true && (
              <Input label="QuickBooks Email" type="email" value={form.quickbooks_email || ''} onChange={(e) => update('quickbooks_email', e.target.value)} />
            )}
            <Input label="Company Domain" value={form.company_domain || ''} onChange={(e) => update('company_domain', e.target.value)} helpText="e.g. chrobinson.com" />
            <Input label="Portal Email" type="email" value={form.portal_email || ''} onChange={(e) => update('portal_email', e.target.value)} helpText="Customer portal login email" />
          </FormSection>
        )}

        {/* Payment — Customer (full) + Warehouse (light) */}
        {vis.payment && (
          <FormSection title="Payment">
            {vis.payment === true && (
              <CurrencyInput label="Credit Limit" valueCents={form.credit_limit_cents} onChangeCents={(cents) => update('credit_limit_cents', cents)} />
            )}
            <Select label="Currency" value={form.currency} onChange={(e) => update('currency', e.target.value)} options={CURRENCY_OPTIONS} />
            <div className="flex items-center pt-6">
              <Checkbox checked={form.account_hold} onChange={(v) => update('account_hold', v)} label="Account on hold" description="Block new orders for this organization" />
            </div>
          </FormSection>
        )}

        {/* Contact */}
        <FormSection title="Contact">
          {vis.contact !== 'basic' && (
            <>
              <Input label="Office Hour Start" type="time" value={form.office_hour_start || ''} onChange={(e) => update('office_hour_start', e.target.value || null)} />
              <Input label="Office Hour End" type="time" value={form.office_hour_end || ''} onChange={(e) => update('office_hour_end', e.target.value || null)} />
            </>
          )}
          <Input label="Main Contact Name" value={form.main_contact_name || ''} onChange={(e) => update('main_contact_name', e.target.value)} />
          <Input label="Main Phone" value={form.main_phone || ''} onChange={(e) => update('main_phone', e.target.value)} />
          <Input label="Secondary Contact Name" value={form.secondary_contact_name || ''} onChange={(e) => update('secondary_contact_name', e.target.value)} />
          <Input label="Secondary Phone" value={form.secondary_phone || ''} onChange={(e) => update('secondary_phone', e.target.value)} />
          <Input label="Sales Agent" value={form.sales_agent || ''} onChange={(e) => update('sales_agent', e.target.value)} />
        </FormSection>

        {/* Organization Subtype */}
        {vis.orgSubtype && (
          <FormSection title="Organization Subtype" description="Tags describing what this organization does in the industry" columns={1}>
            <div className="flex flex-wrap gap-2">
              {ORG_SUBTYPES.map((sub) => {
                const checked = (form.organization_subtypes || []).includes(sub);
                return (
                  <button key={sub} type="button"
                    onClick={() => {
                      const curr = form.organization_subtypes || [];
                      update('organization_subtypes', checked ? curr.filter((s) => s !== sub) : [...curr, sub]);
                    }}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                      checked ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600'
                    }`}
                  >
                    {sub}
                  </button>
                );
              })}
            </div>
          </FormSection>
        )}

        {/* QuickBooks */}
        {vis.quickbooks && (
          <FormSection title="QuickBooks">
            <Input label="QuickBooks Company Field" value={form.quickbooks_company_field || ''} onChange={(e) => update('quickbooks_company_field', e.target.value)} />
          </FormSection>
        )}

        {/* Preferences — Customer + Warehouse + Terminal */}
        {vis.preferences && (
          <FormSection title="Preferences" columns={1}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Select label="Pay Type" value={form.pay_type || ''} onChange={(e) => update('pay_type', e.target.value)} options={PAY_TYPES} placeholder="Select..." />
              <div>
                <Checkbox checked={form.is_hazmat_certified} onChange={(v) => update('is_hazmat_certified', v)} label="HAZMAT Certified" />
              </div>
              <div>
                <Checkbox checked={form.can_edit_load} onChange={(v) => update('can_edit_load', v)} label="Can Edit Load" />
              </div>
              <div>
                <Checkbox checked={form.tir_optional} onChange={(v) => update('tir_optional', v)} label="TIR Optional" />
              </div>
            </div>
          </FormSection>
        )}

        {/* Invoice Combination — Customer only */}
        {vis.invoiceCombination && (
          <FormSection title="Load Charge Combination for Invoicing" description="How invoices are grouped and sent for this customer">
            <Select label="Invoice Combination" value={form.invoice_combination || ''} onChange={(e) => update('invoice_combination', e.target.value)} options={INVOICE_COMBINATIONS} placeholder="Select..." className="sm:col-span-2" />
          </FormSection>
        )}

        {/* Payment Terms */}
        {vis.paymentTerms && (
          <FormSection title="Payment Terms">
            <Select label="Default From" value={form.payment_terms_from || 'invoice_date'} onChange={(e) => update('payment_terms_from', e.target.value)} options={PAYMENT_TERMS_FROM} />
            <Input label="+ Days (Net Terms)" type="number" value={form.payment_terms_days ?? 30} onChange={(e) => update('payment_terms_days', Number(e.target.value) || 0)} helpText="e.g. 30 for Net 30" />
            <div className="sm:col-span-2">
              <Select label="Invoice Combination Rule" value={form.invoice_combination_rule || 'by_load'}
                onChange={(e) => update('invoice_combination_rule', e.target.value)}
                options={[
                  { value: 'by_load', label: 'By Load (1 invoice per load)' },
                  { value: 'manual', label: 'Manual (billing user selects)' },
                  { value: 'by_day', label: 'By Day (group by completion date)' },
                  { value: 'by_week', label: 'By Week (group by completion week)' },
                  { value: 'by_reference', label: 'By Reference # (when all completed)' },
                  { value: 'all_completed', label: 'All Completed Loads (batch)' },
                ]}
                helpText="How charge sets are grouped into invoices for this customer"
              />
            </div>
          </FormSection>
        )}

        {/* Required Documents — customer only */}
        {vis.requiredDocuments && (
          <FormSection title="Required Driver Documents" description="Documents the driver must upload via the mobile app before completing certain routing events. Dispatchers can still manually complete loads.">
            {/* Lifecycle-specific POD & BOL */}
            <div className="sm:col-span-2 space-y-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mb-1">Lifecycle Document Requirements</div>
              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 cursor-pointer transition-colors">
                <input type="checkbox"
                  checked={(form.required_documents || []).includes('POD_AT_DELIVERY')}
                  onChange={() => {
                    const docs = form.required_documents || [];
                    update('required_documents', docs.includes('POD_AT_DELIVERY')
                      ? docs.filter((d) => d !== 'POD_AT_DELIVERY')
                      : [...docs, 'POD_AT_DELIVERY']
                    );
                  }}
                  className="mt-0.5 rounded border-gray-300 dark:border-slate-600 text-blue-600 w-4 h-4" />
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-slate-100">Require POD Upload Before Leaving Delivery Location</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Driver must upload a signed Proof of Delivery before they can depart the delivery location.</div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 cursor-pointer transition-colors">
                <input type="checkbox"
                  checked={(form.required_documents || []).includes('BOL_AT_LOADING')}
                  onChange={() => {
                    const docs = form.required_documents || [];
                    update('required_documents', docs.includes('BOL_AT_LOADING')
                      ? docs.filter((d) => d !== 'BOL_AT_LOADING')
                      : [...docs, 'BOL_AT_LOADING']
                    );
                  }}
                  className="mt-0.5 rounded border-gray-300 dark:border-slate-600 text-blue-600 w-4 h-4" />
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-slate-100">Require BOL Upload Before Leaving Loading Location</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Driver must upload a Bill of Lading before they can depart the pickup/loading location.</div>
                </div>
              </label>
            </div>

            {/* General documents required before load completion — searchable multi-select */}
            <div className="sm:col-span-2">
              <div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mb-2">Additional Documents Required Before Load Completion</div>
              <DocMultiSelect
                selected={(form.required_documents || []).filter((d) => !['POD_AT_DELIVERY', 'BOL_AT_LOADING'].includes(d))}
                options={REQUIRED_DOCUMENT_TYPES}
                onChange={(docs) => {
                  // Preserve lifecycle docs (POD_AT_DELIVERY, BOL_AT_LOADING) and merge general docs
                  const lifecycle = (form.required_documents || []).filter((d) => ['POD_AT_DELIVERY', 'BOL_AT_LOADING'].includes(d));
                  update('required_documents', [...lifecycle, ...docs]);
                }}
              />
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-2">These documents must be uploaded before the driver can mark the load as completed in the mobile app.</p>
            </div>

            {/* Document Validation — which types need dispatcher approval */}
            <div className="sm:col-span-2 mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
              <div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mb-1">Documents Requiring Dispatcher Validation</div>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-3">When a driver uploads one of these document types, it goes to the validation queue for dispatcher approval instead of auto-approving. Leave empty to use the global tenant default.</p>
              <DocMultiSelect
                selected={form.validation_required_doc_types || []}
                options={[
                  { value: 'pod', label: 'Proof of Delivery (POD)' },
                  { value: 'bol', label: 'Bill of Lading (BOL)' },
                  { value: 'weight_ticket', label: 'Weight Ticket' },
                  { value: 'rate_confirmation', label: 'Rate Confirmation' },
                  ...REQUIRED_DOCUMENT_TYPES,
                ]}
                onChange={(docs) => update('validation_required_doc_types', docs)}
              />
            </div>
          </FormSection>
        )}

        {/* Notes — always shown */}
        <FormSection title="Internal Notes" columns={1}>
          <textarea value={form.notes || ''} onChange={(e) => update('notes', e.target.value)} rows={3}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
            placeholder="Internal notes about this organization..." />
        </FormSection>

        </>
          );
        })()}

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editing ? 'Save Changes' : 'Create Organization'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * TerminalLabelPicker — searchable dropdown of system terminal labels.
 * Labels are immutable — the customer can only SELECT, not create.
 * Grouped by market for easy navigation.
 */
function TerminalLabelPicker({ terminals, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = query
    ? terminals.filter((t) =>
        t.label.toLowerCase().includes(query.toLowerCase()) ||
        t.default_name.toLowerCase().includes(query.toLowerCase()) ||
        (t.market || '').toLowerCase().includes(query.toLowerCase())
      )
    : terminals;

  // Group by market
  const grouped = {};
  for (const t of filtered) {
    const market = t.market || 'Other';
    if (!grouped[market]) grouped[market] = [];
    grouped[market].push(t);
  }
  const markets = Object.keys(grouped).sort();

  const selectedTerminal = terminals.find((t) => t.label === value);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center w-full rounded-lg border bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-left hover:border-gray-400 dark:hover:border-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 ${
          value ? 'border-gray-300 dark:border-slate-600' : 'border-dashed border-gray-300 dark:border-slate-600'
        }`}
      >
        {value ? (
          <div className="flex-1 min-w-0">
            <div className="font-mono text-xs font-semibold text-gray-900 dark:text-slate-100">{value}</div>
            {selectedTerminal && (
              <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
                {selectedTerminal.market} · {selectedTerminal.type}
              </div>
            )}
          </div>
        ) : (
          <span className="text-gray-400 dark:text-slate-500 text-xs">Select a system terminal label...</span>
        )}
        {value && (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="ml-2 text-gray-400 dark:text-slate-500 hover:text-red-500"
          >
            ✕
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-72 overflow-hidden">
          <div className="p-2 border-b border-gray-100 dark:border-slate-800">
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search terminals by label, name, or market..."
                autoFocus
                className="block w-full rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 pl-3 pr-3 py-1.5 text-xs text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-400 focus:bg-white dark:focus:bg-slate-900"
              />
            </div>
          </div>
          <div className="overflow-y-auto max-h-56">
            {markets.length === 0 ? (
              <div className="px-3 py-4 text-xs text-gray-400 dark:text-slate-500 text-center">No terminals found</div>
            ) : (
              markets.map((market) => (
                <div key={market}>
                  <div className="px-3 py-1 bg-gray-50 dark:bg-slate-900 text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 sticky top-0">
                    {market}
                  </div>
                  {grouped[market].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { onChange(t); setOpen(false); setQuery(''); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-950/40 text-xs ${
                        t.label === value ? 'bg-blue-50 dark:bg-blue-950/40 font-semibold' : ''
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        t.type === 'MARINE' ? 'bg-blue-400' : 'bg-amber-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-gray-900 dark:text-slate-100">{t.label}</div>
                        {t.effective_name !== t.label && (
                          <div className="text-[10px] text-gray-400 dark:text-slate-500">{t.effective_name}</div>
                        )}
                      </div>
                      <span className={`text-[9px] uppercase tracking-wide font-semibold ${
                        t.type === 'MARINE' ? 'text-blue-500' : 'text-amber-500'
                      }`}>
                        {t.type}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
