import { useEffect, useState } from 'react';

import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Alert from '../ui/Alert';
import DatePicker from '../ui/DatePicker';
import OrgPicker from '../ui/OrgPicker';
import BranchPicker from '../ui/BranchPicker';
import { useAuth } from '../../contexts/AuthContext';
import { LOAD_TYPES as CENTRAL_LOAD_TYPES } from '../../lib/constants/load-types.js';
import { Package, Truck, ArrowRight as ArrowRightIcon, RefreshCcw, FileText } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const LOAD_TYPE_ICONS = {
  import: Package,
  export: ArrowRightIcon,
  inbound: Truck,
  outbound: Truck,
  road: Truck,
  bill_only: FileText,
  chassis_reposition: RefreshCcw,
};

const LOAD_TYPES = CENTRAL_LOAD_TYPES.map((t) => ({
  id: t.value,
  label: t.label,
  description: t.description,
  icon: LOAD_TYPE_ICONS[t.value] || Package,
}));

// TYPE_CONFIG controls which slot fields show + which load_type variants
// allow null container/trailer/etc. Mirrors lib/validation/load-payload.js.
const TYPE_CONFIG = {
  import: {
    slot1: { label: 'Pickup Location', orgType: 'terminal' },
    slot2: { label: 'Delivery Location', orgType: 'consignee' },
    slot3: { label: 'Return Location', orgType: 'terminal' },
    showContainer: true,
    showFinalDelivery: false,
    showTrailer: false,
  },
  export: {
    slot1: { label: 'Pickup Location', orgType: 'shipper' },
    slot2: { label: 'Delivery Location', orgType: 'terminal' },
    slot3: { label: 'Return Location', orgType: 'terminal' },
    showContainer: true,
    showFinalDelivery: false,
    showTrailer: false,
  },
  inbound: {
    slot1: { label: 'Pickup Location', orgType: 'terminal' },
    slot2: { label: 'Delivery Location', orgType: 'consignee' },
    slot3: { label: 'Return Location', orgType: 'terminal' },
    showContainer: true,
    showFinalDelivery: false,
    showTrailer: false,
  },
  outbound: {
    slot1: { label: 'Pickup Location', orgType: 'shipper' },
    slot2: { label: 'Delivery Location (Rail)', orgType: 'terminal' },
    slot3: null,
    showContainer: true,
    showFinalDelivery: true,
    showTrailer: false,
  },
  road: {
    slot1: { label: 'Pickup Location', orgType: 'shipper' },
    slot2: { label: 'Delivery Location', orgType: 'consignee' },
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
    // chassis_reposition writes pickup_location_id → hook_chassis_location_id
    // and delivery_location_id → terminate_chassis_location_id at submit time
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
  container_size_id: null,
  pickup_apt_from: '',
  pickup_apt_to: '',
  delivery_apt_from: '',
  delivery_apt_to: '',
  bill_of_lading: '',
  booking_number: '',
  branch_id: null,
};

export default function NewLoadModal({ isOpen, onClose, onSuccess }) {
  const { branchIds, branches } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [containerSizes, setContainerSizes] = useState(DEFAULT_CONTAINER_SIZES);
  const [templateOrder, setTemplateOrder] = useState([]); // string[] of template ids

  const typeCfg = TYPE_CONFIG[form.load_type] || TYPE_CONFIG.import;

  useEffect(() => {
    if (isOpen) {
      setForm({
        ...EMPTY_FORM,
        branch_id: branchIds?.length === 1 ? branchIds[0] : null,
      });
      setError(null);
      fetch('/api/tenant/container-sizes?enabled=true')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.items?.length > 0) {
            setContainerSizes(
              data.items.map((s) => ({ value: s.code, label: s.label, id: s.id }))
            );
          }
        })
        .catch(() => {});
    }
  }, [isOpen, branchIds]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/tenant/dispatcher-preferences')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const order = data?.preferences?.routing_template_order || [];
        setTemplateOrder(Array.isArray(order) ? order : []);
      })
      .catch(() => { if (!cancelled) setTemplateOrder([]); });
    return () => { cancelled = true; };
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

  function updateApt(prefix, value) {
    setForm((f) => ({
      ...f,
      [`${prefix}_apt_from`]: value || '',
      [`${prefix}_apt_to`]: value || '',
    }));
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

  // Merge user-saved order with the fetched template list. Templates the user
  // have ordered come first (in saved order); any template not in the order
  // array (newly added by admin, or never reordered) appends at the end.
  const orderedTemplates = (() => {
    if (templateOrder.length === 0) return templates;
    const byId = new Map(templates.map((t) => [t.id, t]));
    const ordered = templateOrder.map((id) => byId.get(id)).filter(Boolean);
    const orderedIds = new Set(ordered.map((t) => t.id));
    const remaining = templates.filter((t) => !orderedIds.has(t.id));
    return [...ordered, ...remaining];
  })();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function persistOrder(newOrderIds) {
    fetch('/api/tenant/dispatcher-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routing_template_order: newOrderIds }),
    }).catch((err) => {
      console.error('[NewLoadModal] persist template order failed:', err?.message);
    });
  }

  function handleDragEnd(ev) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedTemplates.findIndex((t) => t.id === active.id);
    const newIndex = orderedTemplates.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(orderedTemplates, oldIndex, newIndex);
    const nextIds = next.map((t) => t.id);
    setTemplateOrder(nextIds);
    persistOrder(nextIds);
  }

  function handleResetOrder() {
    setTemplateOrder([]);
    persistOrder([]);
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
        pickup_apt_from: form.pickup_apt_from || null,
        pickup_apt_to: form.pickup_apt_to || null,
        delivery_apt_from: form.delivery_apt_from || null,
        delivery_apt_to: form.delivery_apt_to || null,
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
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Load" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert type="error" message={error} />}

        {/* Type pills row */}
        <div className="flex flex-wrap gap-2">
          {LOAD_TYPES.map((lt) => {
            const Icon = lt.icon;
            const active = form.load_type === lt.id;
            return (
              <button
                key={lt.id}
                type="button"
                onClick={() => update('load_type', lt.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-600'
                    : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {lt.label}
              </button>
            );
          })}
        </div>

        {/* Routing template chip grid (DnD-reorderable) */}
        {form.load_type !== 'bill_only' && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400 font-medium">
                Routing Template <span className="text-gray-400 dark:text-slate-500 normal-case font-normal">— drag to reorder</span>
              </div>
              {templateOrder.length > 0 && (
                <button
                  type="button"
                  onClick={handleResetOrder}
                  className="text-[10px] text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 underline-offset-2 hover:underline"
                >
                  Reset order
                </button>
              )}
            </div>
            {loadingTemplates ? (
              <div className="text-xs text-gray-500 dark:text-slate-400 py-3">Loading templates…</div>
            ) : orderedTemplates.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-slate-400 py-3">
                No templates available for this load type.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedTemplates.map((t) => t.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {orderedTemplates.map((tpl) => (
                      <SortableTemplateChip
                        key={tpl.id}
                        tpl={tpl}
                        active={form.routing_template_id === tpl.id}
                        onSelect={() => selectTemplate(tpl)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        )}

        {/* 3-column field grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          {/* Customer (col-span 2) + Branch */}
          <div className="md:col-span-2">
            <OrgPicker
              label="Customer"
              type="customer"
              value={form.customer_id}
              valueLabel={form.customer_label}
              onChange={(org) => selectOrg('customer_id', 'customer_label', org)}
              required
            />
          </div>
          {branches?.length > 0 ? (
            <BranchPicker
              label="Branch"
              value={form.branch_id}
              onChange={(val) => setForm((f) => ({ ...f, branch_id: val }))}
              placeholder="— Select —"
            />
          ) : (
            <div />
          )}

          {/* Locations (slot1, slot2, slot3) */}
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
              onChange={(org) => selectOrg('delivery_location_id', 'delivery_location_label', org)}
            />
          )}
          {typeCfg.slot3 && (
            <OrgPicker
              label={typeCfg.slot3.label}
              type={typeCfg.slot3.orgType}
              value={form.return_location_id}
              valueLabel={form.return_location_label}
              onChange={(org) => selectOrg('return_location_id', 'return_location_label', org)}
            />
          )}
          {typeCfg.showFinalDelivery && (
            <OrgPicker
              label="Final Delivery"
              type="final_destination"
              value={form.final_delivery_location_id}
              valueLabel={form.final_delivery_location_label}
              onChange={(org) =>
                selectOrg('final_delivery_location_id', 'final_delivery_location_label', org)
              }
            />
          )}

          {/* Container fields (only if showContainer) */}
          {typeCfg.showContainer && (
            <>
              <Input
                label="Container #"
                value={form.container_number}
                onChange={(e) => update('container_number', e.target.value.toUpperCase())}
                placeholder="MSKU1234567"
              />
              <Select
                label="Size"
                value={form.container_size}
                onChange={(e) => {
                  const code = e.target.value;
                  update('container_size', code);
                  const match = containerSizes.find((s) => s.value === code);
                  update('container_size_id', match?.id || null);
                }}
                options={containerSizes}
              />
              <div />
            </>
          )}

          {/* Trailer (only if showTrailer) */}
          {typeCfg.showTrailer && (
            <>
              <Input
                label="Trailer / Dry Van ID"
                value={form.trailer_number}
                onChange={(e) => update('trailer_number', e.target.value.toUpperCase())}
                placeholder="TRL12345"
              />
              <div />
              <div />
            </>
          )}

          {/* Appointments (when typeCfg shows them) */}
          {(typeCfg.showContainer || typeCfg.showTrailer || form.load_type === 'chassis_reposition') && (
            <>
              <DatePicker
                showTime
                label="Pickup Apt"
                value={form.pickup_apt_from}
                onChange={(v) => updateApt('pickup', v)}
              />
              <DatePicker
                showTime
                label="Delivery Apt"
                value={form.delivery_apt_from}
                onChange={(v) => updateApt('delivery', v)}
              />
              <div />
            </>
          )}

          {/* References (skip for bill_only and chassis_reposition) */}
          {form.load_type !== 'bill_only' && form.load_type !== 'chassis_reposition' && (
            <>
              <Input
                label="Master BOL"
                value={form.bill_of_lading}
                onChange={(e) => update('bill_of_lading', e.target.value)}
              />
              <Input
                label="Booking #"
                value={form.booking_number}
                onChange={(e) => update('booking_number', e.target.value)}
              />
              <div />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-slate-800">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Create Load
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SortableTemplateChip({ tpl, active, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tpl.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      onClick={onSelect}
      {...attributes}
      {...listeners}
      className={`text-left p-2 rounded border transition-colors cursor-grab active:cursor-grabbing ${
        active
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-200'
          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300'
      }`}
    >
      <div className="text-xs font-medium truncate">{tpl.name}</div>
      {tpl.description && (
        <div className="text-[10px] text-gray-500 dark:text-slate-400 truncate mt-0.5">
          {tpl.description}
        </div>
      )}
    </button>
  );
}
