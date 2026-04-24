import { useEffect, useState } from 'react';
import {
  Package,
  Ship,
  Truck,
  FileText,
  ArrowRight,
  ArrowLeft,
  Check,
  PackageOpen,
  PackageCheck,
  Container,
} from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DatePicker from '../ui/DatePicker';
import FormSection from '../ui/FormSection';
import Alert from '../ui/Alert';
import OrgPicker from '../ui/OrgPicker';
import BranchPicker from '../ui/BranchPicker';
import { useAuth } from '../../contexts/AuthContext';
import { LOAD_TYPES as CENTRAL_LOAD_TYPES } from '../../lib/constants/load-types.js';

// Icon map for load types — kept here so constants module stays UI-free.
const LOAD_TYPE_ICONS = {
  import: Ship,
  inbound: PackageOpen,
  export: Package,
  outbound: PackageCheck,
  road: Truck,
  bill_only: FileText,
  chassis_reposition: Container,
};

// Render-time shape: { id, label, description, icon }. Uses value→id rename
// because the existing JSX downstream references lt.id.
const LOAD_TYPES = CENTRAL_LOAD_TYPES.map((t) => ({
  id: t.value,
  label: t.label,
  description: t.description,
  icon: LOAD_TYPE_ICONS[t.value] || Package,
}));

// Per-type location slot configuration
const TYPE_CONFIG = {
  import: {
    slot1: { label: 'Pickup Location', orgType: 'terminal' },
    slot2: { label: 'Delivery Location', orgType: 'warehouse' },
    slot3: { label: 'Return Location', orgType: 'terminal' },
    showContainer: true,
    showFinalDelivery: false,
    showTrailer: false,
  },
  inbound: {
    slot1: { label: 'Pickup Location (Rail)', orgType: 'terminal' },
    slot2: { label: 'Delivery Location', orgType: 'warehouse' },
    slot3: { label: 'Return Location (Rail)', orgType: 'terminal' },
    showContainer: true,
    showFinalDelivery: false,
    showTrailer: false,
  },
  export: {
    slot1: { label: 'Empty Container Pickup', orgType: 'terminal' },
    slot2: { label: 'Loading Warehouse', orgType: 'warehouse' },
    slot3: { label: 'Delivery Terminal', orgType: 'terminal' },
    showContainer: true,
    showFinalDelivery: false,
    showTrailer: false,
  },
  outbound: {
    slot1: { label: 'Empty Container Pickup', orgType: 'terminal' },
    slot2: { label: 'Loading Warehouse', orgType: 'warehouse' },
    slot3: { label: 'Delivery Terminal (Rail)', orgType: 'terminal' },
    showContainer: true,
    showFinalDelivery: true,
    showTrailer: false,
  },
  road: {
    slot1: { label: 'Loading Warehouse', orgType: 'warehouse' },
    slot2: { label: 'Final Delivery', orgType: 'warehouse' },
    slot3: null,
    showContainer: false,
    showFinalDelivery: false,
    showTrailer: true,
  },
  bill_only: {
    slot1: null,
    slot2: null,
    slot3: null,
    showContainer: false,
    showFinalDelivery: false,
    showTrailer: false,
  },
  chassis_reposition: {
    // Chassis reposition = move an empty chassis between yards/terminals.
    // Slots reuse the form's pickup/delivery fields for UI state, but submit
    // logic remaps them to hook_chassis_location_id / terminate_chassis_location_id
    // (see handleSubmit below) per lib/validation/load-payload.js.
    slot1: { label: 'Hook Chassis Location', orgType: 'yard' },
    slot2: { label: 'Terminate Chassis Location', orgType: 'yard' },
    slot3: null,
    showContainer: false,
    showFinalDelivery: false,
    showTrailer: false,
  },
};

const DEFAULT_CONTAINER_SIZES = [
  { value: '20', label: "20'" },
  { value: '40', label: "40'" },
  { value: '40HC', label: "40' HC" },
  { value: '45', label: "45'" },
  { value: '53', label: "53'" },
];

const EMPTY_FORM = {
  load_type: 'import',
  routing_template_id: null,
  routing_template_name: '',
  customer_id: null,
  customer_label: '',
  pickup_location_id: null,
  pickup_location_label: '',
  delivery_location_id: null,
  delivery_location_label: '',
  return_location_id: null,
  return_location_label: '',
  final_delivery_location_id: null,
  final_delivery_location_label: '',
  trailer_number: '',
  container_number: '',
  container_size: '',
  pickup_date: '',
  delivery_date: '',
  bill_of_lading: '',
  booking_number: '',
  branch_id: null,
};

export default function NewLoadModal({ isOpen, onClose, onSuccess }) {
  const { branchIds, branches, role } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [containerSizes, setContainerSizes] = useState(DEFAULT_CONTAINER_SIZES);

  const typeCfg = TYPE_CONFIG[form.load_type] || TYPE_CONFIG.import;

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setForm({
        ...EMPTY_FORM,
        branch_id: branchIds?.length === 1 ? branchIds[0] : null,
      });
      setError(null);
      // Fetch container sizes from the tenant's enabled reference data
      fetch('/api/tenant/container-sizes?enabled=true')
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.items?.length > 0) {
            setContainerSizes(
              data.items.map((s) => ({ value: s.code, label: s.label, id: s.id }))
            );
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function fetchTemplates() {
      setLoadingTemplates(true);
      try {
        const params = new URLSearchParams();
        if (form.load_type) params.set('load_type', form.load_type);
        const res = await fetch(`/api/tenant/routing-templates?${params}`);
        if (!res.ok) throw new Error('Failed to load templates');
        const data = await res.json();
        if (!cancelled) setTemplates(data.templates || []);
      } catch {
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    }
    fetchTemplates();
    return () => {
      cancelled = true;
    };
  }, [isOpen, form.load_type]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function selectTemplate(tpl) {
    setForm((f) => ({
      ...f,
      routing_template_id: tpl.id,
      routing_template_name: tpl.name,
    }));
  }

  function selectOrg(field, labelField, org) {
    setForm((f) => ({
      ...f,
      [field]: org?.id || null,
      [labelField]: org?.name || '',
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (form.load_type !== 'bill_only' && !form.routing_template_id) {
        throw new Error('Select a routing template');
      }
      if (!form.customer_id) throw new Error('Customer is required');

      // chassis_reposition reuses the slot1/slot2 form fields for UI state but
      // maps them to hook_chassis_location_id / terminate_chassis_location_id
      // at submit time. The API validator (lib/validation/load-payload.js)
      // requires both chassis fields for this load type and allows null
      // pickup/delivery/return.
      const isChassisReposition = form.load_type === 'chassis_reposition';
      const payload = {
        load_type: form.load_type,
        routing_template_id: form.routing_template_id,
        routing_template_name: form.routing_template_name,
        customer_id: form.customer_id,
        pickup_location_id: isChassisReposition ? null : form.pickup_location_id,
        delivery_location_id: isChassisReposition ? null : form.delivery_location_id,
        return_location_id: isChassisReposition ? null : form.return_location_id,
        final_delivery_location_id: form.final_delivery_location_id,
        hook_chassis_location_id: isChassisReposition ? form.pickup_location_id : null,
        terminate_chassis_location_id: isChassisReposition ? form.delivery_location_id : null,
        container_number: form.container_number || null,
        container_size: form.container_size || null,
        container_size_id: form.container_size_id || null,
        pickup_date: form.pickup_date || null,
        delivery_date: form.delivery_date || null,
        bill_of_lading: form.bill_of_lading || null,
        booking_number: form.booking_number || null,
        branch_id: form.branch_id || null,
      };

      const res = await fetch('/api/tenant/loads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create load');
      }
      const data = await res.json();
      onSuccess?.(data.load);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Load" size="lg">
      <div className="flex items-center justify-center gap-3 mb-6 -mt-2">
        <StepDot active={step === 1} done={step > 1} label="Type & Routing" />
        <div className="h-0.5 w-8 bg-gray-200 dark:bg-slate-700" />
        <StepDot active={step === 2} done={false} label="Details" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <Alert type="error" message={error} />}

        {step === 1 && (
          <>
            <FormSection title="Load Type" columns={2}>
              {LOAD_TYPES.map((lt) => {
                const Icon = lt.icon;
                const active = form.load_type === lt.id;
                return (
                  <button
                    key={lt.id}
                    type="button"
                    onClick={() => update('load_type', lt.id)}
                    className={`flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                        : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className={`rounded-lg p-2 ${active ? 'bg-blue-100 dark:bg-blue-950/60' : 'bg-gray-100 dark:bg-slate-800'}`}>
                      <Icon
                        className={`w-5 h-5 ${active ? 'text-blue-600' : 'text-gray-500 dark:text-slate-400'}`}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{lt.label}</div>
                      <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{lt.description}</div>
                    </div>
                    {active && <Check className="w-4 h-4 text-blue-600" />}
                  </button>
                );
              })}
            </FormSection>

            {form.load_type !== 'bill_only' && (
              <FormSection
                title="Routing Template"
                description="Pick a pre-built pattern that matches this load's workflow"
                columns={1}
              >
                {loadingTemplates ? (
                  <div className="text-sm text-gray-500 dark:text-slate-400 text-center py-4">
                    Loading templates...
                  </div>
                ) : templates.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-slate-400 text-center py-4">
                    No templates available for this load type.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {templates.map((tpl) => {
                      const active = form.routing_template_id === tpl.id;
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => selectTemplate(tpl)}
                          className={`rounded-lg border-2 p-3 text-left transition-colors ${
                            active
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                              : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{tpl.name}</div>
                          {tpl.description && (
                            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{tpl.description}</div>
                          )}
                          {tpl.event_sequence?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {tpl.event_sequence.map((ev, i) => (
                                <span
                                  key={i}
                                  className="text-[10px] uppercase tracking-wide bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 px-1.5 py-0.5 rounded"
                                >
                                  {ev.label || ev.type}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </FormSection>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <FormSection title="Customer & Locations">
              <OrgPicker
                label="Customer"
                type="customer"
                value={form.customer_id}
                valueLabel={form.customer_label}
                onChange={(org) => selectOrg('customer_id', 'customer_label', org)}
                required
                className="sm:col-span-2"
              />
              {branches?.length > 0 && (
                <BranchPicker
                  label="Branch"
                  value={form.branch_id}
                  onChange={(val) => setForm((f) => ({ ...f, branch_id: val }))}
                  placeholder="— Select Branch —"
                />
              )}
              {typeCfg.slot1 && (
                <OrgPicker
                  label={typeCfg.slot1.label}
                  type={typeCfg.slot1.orgType}
                  value={form.pickup_location_id}
                  valueLabel={form.pickup_location_label}
                  onChange={(org) => selectOrg('pickup_location_id', 'pickup_location_label', org)}
                />
              )}
              {typeCfg.slot2 && (
                <OrgPicker
                  label={typeCfg.slot2.label}
                  type={typeCfg.slot2.orgType}
                  value={form.delivery_location_id}
                  valueLabel={form.delivery_location_label}
                  onChange={(org) =>
                    selectOrg('delivery_location_id', 'delivery_location_label', org)
                  }
                />
              )}
              {typeCfg.slot3 && (
                <OrgPicker
                  label={typeCfg.slot3.label}
                  type={typeCfg.slot3.orgType}
                  value={form.return_location_id}
                  valueLabel={form.return_location_label}
                  onChange={(org) => selectOrg('return_location_id', 'return_location_label', org)}
                  className={typeCfg.showFinalDelivery ? '' : 'sm:col-span-2'}
                />
              )}
              {typeCfg.showFinalDelivery && (
                <OrgPicker
                  label="Final Delivery Location"
                  type="final_destination"
                  value={form.final_delivery_location_id}
                  valueLabel={form.final_delivery_location_label}
                  onChange={(org) =>
                    selectOrg('final_delivery_location_id', 'final_delivery_location_label', org)
                  }
                  helpText="Outbound final destination — where the load goes after the rail move"
                />
              )}
            </FormSection>

            {typeCfg.showContainer && (
              <FormSection title="Container & Dates">
                <Input
                  label="Container Number"
                  value={form.container_number}
                  onChange={(e) => update('container_number', e.target.value.toUpperCase())}
                  placeholder="MSKU1234567"
                />
                <Select
                  label="Container Size"
                  value={form.container_size}
                  onChange={(e) => {
                    const code = e.target.value;
                    update('container_size', code);
                    const match = containerSizes.find((s) => s.value === code);
                    update('container_size_id', match?.id || null);
                  }}
                  options={containerSizes}
                />
                <DatePicker
                  label="Pickup Date"
                  value={form.pickup_date}
                  onChange={(v) => update('pickup_date', v)}
                />
                <DatePicker
                  label="Delivery Date"
                  value={form.delivery_date}
                  onChange={(v) => update('delivery_date', v)}
                />
              </FormSection>
            )}

            {typeCfg.showTrailer && (
              <FormSection title="Trailer & Dates">
                <Input
                  label="Trailer / Dry Van ID"
                  value={form.trailer_number}
                  onChange={(e) => update('trailer_number', e.target.value.toUpperCase())}
                  placeholder="TRL12345"
                />
                <div />
                <DatePicker
                  label="Pickup Date"
                  value={form.pickup_date}
                  onChange={(v) => update('pickup_date', v)}
                />
                <DatePicker
                  label="Delivery Date"
                  value={form.delivery_date}
                  onChange={(v) => update('delivery_date', v)}
                />
              </FormSection>
            )}

            {form.load_type !== 'bill_only' && form.load_type !== 'chassis_reposition' && (
              <FormSection title="References">
                <Input
                  label="Master BOL"
                  value={form.bill_of_lading}
                  onChange={(e) => update('bill_of_lading', e.target.value)}
                />
                <Input
                  label="Booking Number"
                  value={form.booking_number}
                  onChange={(e) => update('booking_number', e.target.value)}
                />
              </FormSection>
            )}

            {form.load_type === 'chassis_reposition' && (
              <FormSection title="Dates">
                <DatePicker
                  label="Pickup Date"
                  value={form.pickup_date}
                  onChange={(v) => update('pickup_date', v)}
                />
                <DatePicker
                  label="Delivery Date"
                  value={form.delivery_date}
                  onChange={(v) => update('delivery_date', v)}
                />
              </FormSection>
            )}
          </>
        )}

        <div className="flex justify-between gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
          <div>
            {step === 2 && (
              <Button variant="secondary" type="button" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 inline -mt-0.5 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            {step === 1 ? (
              <Button
                type="button"
                onClick={() => setStep(2)}
                disabled={form.load_type !== 'bill_only' && !form.routing_template_id}
              >
                Next
                <ArrowRight className="w-4 h-4 inline -mt-0.5 ml-1" />
              </Button>
            ) : (
              <Button type="submit" loading={submitting}>
                Create Load
              </Button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}

function StepDot({ active, done, label }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
          active
            ? 'bg-blue-600 text-white'
            : done
              ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
              : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'
        }`}
      >
        {done ? <Check className="w-3.5 h-3.5" /> : active ? '•' : ''}
      </div>
      <span
        className={`text-xs font-medium ${
          active ? 'text-gray-900 dark:text-slate-100' : done ? 'text-gray-600 dark:text-slate-300' : 'text-gray-400 dark:text-slate-500'
        }`}
      >
        {label}
      </span>
    </div>
  );
}
