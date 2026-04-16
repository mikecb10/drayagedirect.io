import { useEffect, useState, useMemo } from 'react';
import {
  Plus,
  Edit3,
  Trash2,
  StickyNote,
  Lock,
  Unlock,
  FileText,
  DollarSign,
  User,
  History,
  Route,
  Truck,
  MapPin,
  Package,
  CheckCircle2,
  Play,
  Flag,
  ArrowLeftRight,
  Settings,
} from 'lucide-react';
import Alert from '../../ui/Alert';

// ============================================================
// Action → human-readable label + icon + color
// ============================================================
const ACTION_LABELS = {
  // Load lifecycle
  'load.create':               { label: 'Load Created', icon: Plus, color: 'green' },
  'load.update':               { label: 'Load Updated', icon: Edit3, color: 'blue' },
  'load.delete':               { label: 'Load Deleted', icon: Trash2, color: 'red' },
  'load.restore':              { label: 'Load Restored', icon: Plus, color: 'green' },
  'load.complete':             { label: 'Load Completed', icon: Flag, color: 'emerald' },

  // Holds
  'load.hold_update':          { label: 'Hold Updated', icon: Lock, color: 'amber' },

  // Notes
  'load.note_create':          { label: 'Note Added', icon: StickyNote, color: 'purple' },
  'load.note_update':          { label: 'Note Edited', icon: Edit3, color: 'purple' },
  'load.note_delete':          { label: 'Note Deleted', icon: Trash2, color: 'purple' },

  // Documents
  'load.document_upload':      { label: 'Document Uploaded', icon: FileText, color: 'blue' },
  'load.document_delete':      { label: 'Document Deleted', icon: Trash2, color: 'red' },

  // Billing / Charge Sets
  'billing.auto_apply':        { label: 'Tariff Rates Auto-Applied', icon: DollarSign, color: 'emerald' },
  'load.recalculate_charges':  { label: 'Rates Recalculated', icon: DollarSign, color: 'blue' },
  'load.charge_set_create':    { label: 'Charge Set Created', icon: DollarSign, color: 'emerald' },
  'load.charge_set_update':    { label: 'Charge Set Updated', icon: DollarSign, color: 'emerald' },
  'load.charge_set_delete':    { label: 'Charge Set Deleted', icon: Trash2, color: 'red' },
  'load.line_item_create':     { label: 'Line Item Added', icon: Plus, color: 'emerald' },
  'load.line_item_update':     { label: 'Line Item Updated', icon: Edit3, color: 'emerald' },
  'load.line_item_delete':     { label: 'Line Item Deleted', icon: Trash2, color: 'red' },

  // Driver
  'load.driver_assign':        { label: 'Driver Assigned', icon: User, color: 'blue' },
  'load.driver_pay_create':    { label: 'Driver Pay Line Added', icon: DollarSign, color: 'teal' },
  'load.driver_pay_update':    { label: 'Driver Pay Updated', icon: Edit3, color: 'teal' },
  'load.driver_pay_delete':    { label: 'Driver Pay Deleted', icon: Trash2, color: 'red' },

  // Routing — moves
  'load.move_create':          { label: 'Container Move Created', icon: Route, color: 'blue' },
  'load.move_update':          { label: 'Container Move Updated', icon: Edit3, color: 'blue' },
  'load.move_delete':          { label: 'Container Move Deleted', icon: Trash2, color: 'red' },
  'load.move_start':           { label: 'Move Started', icon: Play, color: 'amber' },
  'load.move_complete':        { label: 'Move Completed', icon: CheckCircle2, color: 'emerald' },

  // Routing — events
  'load.routing_event_create': { label: 'Routing Event Added', icon: MapPin, color: 'blue' },
  'load.routing_event_update': { label: 'Routing Event Updated', icon: Edit3, color: 'blue' },
  'load.routing_event_delete': { label: 'Routing Event Deleted', icon: Trash2, color: 'red' },
  'load.routing_seed_from_template': { label: 'Routing Seeded from Template', icon: Route, color: 'green' },

  // Terminal import
  'terminal.override_update':  { label: 'Terminal Name Customized', icon: Settings, color: 'gray' },

  // Settings
  'tenant_settings.update':    { label: 'Settings Updated', icon: Settings, color: 'gray' },
};

const COLOR_BG = {
  green:   'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300',
  blue:    'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
  red:     'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300',
  amber:   'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  purple:  'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300',
  emerald: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
  teal:    'bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300',
  gray:    'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200',
};

// Event type labels for routing events
const EVENT_TYPE_LABELS = {
  pull: 'Pull from Terminal',
  pickup: 'Pickup Container',
  deliver: 'Deliver Container',
  drop: 'Drop Container',
  hook: 'Hook Container',
  return: 'Return Container',
  terminate: 'Terminate Chassis',
  lift_off: 'Lift Off',
  wait: 'Wait',
  scale: 'Scale',
  complete: 'Completed',
  hook_chassis: 'Hook Chassis',
};

function formatDateTime(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return d;
  }
}

// ============================================================
// Build a rich description from action + new_values
// ============================================================
function buildDescription(action, newValues, oldValues) {
  const nv = newValues || {};
  const ov = oldValues || {};

  // Routing events — show the event type
  if (action === 'load.routing_event_create' && nv.event_type) {
    return EVENT_TYPE_LABELS[nv.event_type] || nv.event_type;
  }
  if (action === 'load.routing_seed_from_template') {
    const parts = [];
    if (nv.template) parts.push(`Template: ${nv.template}`);
    if (nv.moves) parts.push(`${nv.moves} moves`);
    if (nv.events) parts.push(`${nv.events} events`);
    return parts.join(' · ') || null;
  }

  // Move lifecycle
  if (action === 'load.move_update' && nv.driver_id) {
    return 'Driver assigned to move';
  }

  // Hold updates
  if (action === 'load.hold_update' && nv.hold_type) {
    const holdLabel = (nv.hold_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const status = nv.status === 'hold' ? 'placed on Hold' : 'Released';
    return `${holdLabel} — ${status}`;
  }

  // Note creation / update / delete — show audience + first 3 words of body
  if ((action === 'load.note_create' || action === 'load.note_update' || action === 'load.note_delete') && nv.audience) {
    const audience = (nv.audience || '').replace(/\b\w/g, (c) => c.toUpperCase());
    if (nv.body) {
      const words = nv.body.trim().split(/\s+/);
      const preview = words.slice(0, 3).join(' ') + (words.length > 3 ? '...' : '');
      return `${audience} — "${preview}"`;
    }
    return `${audience} note`;
  }

  // Charge set
  if (action === 'load.charge_set_create' || action === 'load.charge_set_update') {
    if (nv.status) return `Status: ${nv.status}`;
  }

  // Driver pay
  if (action === 'load.driver_pay_create' && nv.line_type) {
    const type = (nv.line_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (nv.amount_cents) return `${type} — $${(nv.amount_cents / 100).toFixed(2)}`;
    return type;
  }

  return null;
}

// ============================================================
// Compute field-level changes between old and new values
// ============================================================
const WATCH_FIELDS = [
  'status', 'customer_id', 'driver_id',
  'pickup_location_id', 'delivery_location_id', 'return_location_id', 'final_delivery_location_id',
  'container_number', 'container_size', 'container_type', 'seal_number',
  'chassis_number', 'chassis_size', 'chassis_type', 'chassis_owner',
  'steamship_line', 'steamship_line_scac', 'container_owner_id',
  'bill_of_lading', 'house_bol', 'booking_number', 'customer_reference',
  'vessel_name', 'voyage_number', 'shipment_number', 'pickup_number',
  'appointment_number', 'return_number', 'reservation_number', 'delivery_reference', 'work_order',
  'pickup_date', 'delivery_date', 'vessel_eta', 'discharge_date', 'outgate_date',
  'last_free_day', 'empty_date', 'per_diem_free_day', 'ingate_date',
  'ready_to_return_date', 'cutoff_date',
  'weight_lbs', 'weight_kg', 'piece_count', 'pallet_count', 'commodity_description',
  'is_hazmat', 'is_overweight', 'is_overheight', 'is_hot', 'is_genset',
  'is_scale', 'is_ev', 'is_street_turn', 'is_oog', 'is_bonded',
  'is_double', 'is_tanker', 'is_liquor',
  'routing_template_name',
];

function computeChanges(oldV, newV) {
  if (!oldV || !newV) return [];
  const changes = [];
  for (const key of WATCH_FIELDS) {
    const o = oldV[key];
    const n = newV[key];
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      changes.push({ field: key, from: o, to: n });
    }
  }
  return changes;
}

function fieldLabel(field) {
  // Special labels for common fields
  const LABELS = {
    bill_of_lading: 'Master BOL',
    house_bol: 'House BOL',
    steamship_line: 'SSL',
    steamship_line_scac: 'SSL SCAC',
    pickup_location_id: 'Pickup Location',
    delivery_location_id: 'Delivery Location',
    return_location_id: 'Return Location',
    final_delivery_location_id: 'Final Delivery',
    container_owner_id: 'Container Owner',
    routing_template_name: 'Routing Template',
    is_hazmat: 'Hazmat',
    is_overweight: 'Overweight',
    is_overheight: 'Overheight',
    is_hot: 'Hot',
    is_genset: 'Genset',
    is_ev: 'EV',
    is_street_turn: 'Street Turn',
    is_oog: 'OOG',
    is_bonded: 'Bonded',
    is_double: 'Double',
    is_tanker: 'Tanker',
    is_liquor: 'Liquor',
    weight_lbs: 'Weight (lbs)',
    weight_kg: 'Weight (kg)',
  };
  if (LABELS[field]) return LABELS[field];
  return field
    .replace(/_id$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ============================================================
// Categories — each action maps to a filterable tag
// ============================================================
const ACTION_CATEGORIES = {
  'load.create': 'Load',
  'load.update': 'Load',
  'load.delete': 'Load',
  'load.restore': 'Load',
  'load.complete': 'Load',
  'load.hold_update': 'Holds',
  'load.note_create': 'Notes',
  'load.note_update': 'Notes',
  'load.note_delete': 'Notes',
  'load.document_upload': 'Documents',
  'load.document_delete': 'Documents',
  'load.charge_set_create': 'Billing',
  'load.charge_set_update': 'Billing',
  'load.charge_set_delete': 'Billing',
  'load.line_item_create': 'Billing',
  'load.line_item_update': 'Billing',
  'load.line_item_delete': 'Billing',
  'load.driver_assign': 'Driver',
  'load.driver_pay_create': 'Driver Pay',
  'load.driver_pay_update': 'Driver Pay',
  'load.driver_pay_delete': 'Driver Pay',
  'load.move_create': 'Routing',
  'load.move_update': 'Routing',
  'load.move_delete': 'Routing',
  'load.move_start': 'Routing',
  'load.move_complete': 'Routing',
  'load.routing_event_create': 'Routing',
  'load.routing_event_update': 'Routing',
  'load.routing_event_delete': 'Routing',
  'load.routing_seed_from_template': 'Routing',
  'terminal.override_update': 'Settings',
  'tenant_settings.update': 'Settings',
};

const CATEGORY_COLORS = {
  'Load':       'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  'Routing':    'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
  'Billing':    'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  'Driver Pay': 'bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800',
  'Driver':     'bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800',
  'Holds':      'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  'Notes':      'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
  'Documents':  'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  'Settings':   'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700',
};

function getCategory(action) {
  return ACTION_CATEGORIES[action] || 'Other';
}

// ============================================================
// Component
// ============================================================
export default function AuditTab({ load }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(null); // null = show all

  useEffect(() => {
    let cancelled = false;
    async function fetchAudit() {
      if (!load?.id) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tenant/loads/${load.id}/audit`);
        if (!res.ok) throw new Error('Failed to load audit trail');
        const data = await res.json();
        if (!cancelled) setEvents(data.events || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAudit();
    return () => { cancelled = true; };
  }, [load?.id]);

  // Compute category counts for the filter pills
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const ev of events) {
      const cat = getCategory(ev.action);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [events]);

  const categories = useMemo(() => {
    return Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ name: cat, count }));
  }, [categoryCounts]);

  // Unique users for search suggestions
  const uniqueUsers = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const name = ev.user?.name || ev.user?.email;
      if (name && !map[name]) map[name] = true;
    }
    return Object.keys(map);
  }, [events]);

  // Filter events by category + search text
  const filtered = useMemo(() => {
    let list = events;

    // Category filter (from pill click)
    if (activeCategory) {
      list = list.filter((ev) => getCategory(ev.action) === activeCategory);
    }

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();

      // Check if the search matches a category name exactly → filter by category
      const matchedCategory = categories.find(
        (c) => c.name.toLowerCase() === q || c.name.toLowerCase().startsWith(q)
      );
      if (matchedCategory && !activeCategory) {
        list = list.filter((ev) => getCategory(ev.action) === matchedCategory.name);
      } else {
        // General text search — matches action label, user name, description, changes
        list = list.filter((ev) => {
          const cfg = ACTION_LABELS[ev.action];
          const label = cfg?.label || ev.action;
          const userName = ev.user?.name || ev.user?.email || '';
          const desc = buildDescription(ev.action, ev.new_values, ev.old_values) || '';
          // Search through field changes instead of raw JSON
          const changes = computeChanges(ev.old_values, ev.new_values);
          const changeText = changes
            .map((c) => `${fieldLabel(c.field)} ${displayValue(c.from)} ${displayValue(c.to)}`)
            .join(' ');
          return (
            label.toLowerCase().includes(q) ||
            userName.toLowerCase().includes(q) ||
            desc.toLowerCase().includes(q) ||
            changeText.toLowerCase().includes(q)
          );
        });
      }
    }

    return list;
  }, [events, activeCategory, search, categories]);

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {/* Search + Category Filters */}
      {!loading && events.length > 0 && (
        <div className="space-y-3">
          {/* Search bar */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search audit trail... (action, user, field, value)"
              className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category filter pills */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                !activeCategory
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
              }`}
            >
              All
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                !activeCategory ? 'bg-blue-500 text-blue-100' : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'
              }`}>
                {events.length}
              </span>
            </button>
            {categories.map((cat) => {
              const isActive = activeCategory === cat.name;
              const colorCls = CATEGORY_COLORS[cat.name] || 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700';
              return (
                <button
                  key={cat.name}
                  type="button"
                  onClick={() => setActiveCategory(isActive ? null : cat.name)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? colorCls + ' ring-2 ring-offset-1 ring-blue-400'
                      : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
                  }`}
                >
                  {cat.name}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    isActive ? 'bg-white/30' : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'
                  }`}>
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-900/70 rounded-t-xl flex items-center gap-2">
          <History className="w-4 h-4 text-gray-400 dark:text-slate-500" />
          <div className="text-section-title text-strong">
            {activeCategory ? `${activeCategory} Events` : 'Audit Trail'}
          </div>
          <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">
            {loading ? '...' : filtered.length === events.length
              ? `${events.length} ${events.length === 1 ? 'event' : 'events'}`
              : `${filtered.length} of ${events.length} events`}
          </span>
        </div>

        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
            Loading audit trail...
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
            {events.length === 0
              ? 'No audit events yet.'
              : `No events match "${search || activeCategory}" — try a different search or category.`}
          </div>
        ) : (
          <ol className="divide-y divide-gray-100 dark:divide-slate-800">
            {filtered.map((ev) => {
              const cfg = ACTION_LABELS[ev.action] || {
                label: ev.action.replace(/\./g, ' → ').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
                icon: Edit3,
                color: 'gray',
              };
              const Icon = cfg.icon;
              const changes = computeChanges(ev.old_values, ev.new_values);
              const description = buildDescription(ev.action, ev.new_values, ev.old_values);
              const category = getCategory(ev.action);
              const catColor = CATEGORY_COLORS[category] || 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700';

              // User info
              const userName = ev.user?.name || ev.user?.email || 'System';
              const userInitial = (userName[0] || 'S').toUpperCase();

              return (
                <li key={ev.id} className="px-5 py-3 flex gap-3 hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                  {/* Icon */}
                  <div className={`shrink-0 rounded-full p-1.5 mt-0.5 ${COLOR_BG[cfg.color]}`}>
                    <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${catColor}`}>
                        {category}
                      </span>
                      <span className="text-section-title text-strong">{cfg.label}</span>
                      {description && (
                        <span className="text-helper text-muted">— {description}</span>
                      )}
                    </div>

                    {/* User + timestamp */}
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 flex items-center justify-center text-[10px] font-bold shrink-0">
                        {userInitial}
                      </div>
                      <span className="text-xs font-medium text-gray-700 dark:text-slate-200">{userName}</span>
                      <span className="text-xs text-gray-400 dark:text-slate-500">·</span>
                      <span className="text-xs text-gray-400 dark:text-slate-500">{formatDateTime(ev.created_at)}</span>
                    </div>

                    {/* Field-level changes — PortPro style: "Field Changed To Value" */}
                    {changes.length > 0 && (
                      <div className="mt-2 rounded-lg bg-gray-50 dark:bg-slate-900 border border-gray-100 dark:border-slate-800 px-3 py-2 space-y-1.5">
                        {changes.map((c, i) => {
                          const isBoolean = typeof c.to === 'boolean' || c.to === 'true' || c.to === 'false';
                          const isClear = c.to === null || c.to === undefined || c.to === '';
                          return (
                            <div key={i} className="text-xs">
                              {isClear ? (
                                // Field was cleared
                                <span>
                                  <span className="font-semibold text-gray-700 dark:text-slate-200">{fieldLabel(c.field)}</span>
                                  {' '}
                                  <span className="text-red-600 dark:text-red-400 font-medium">Cleared</span>
                                  {c.from && (
                                    <span className="text-gray-400 dark:text-slate-500 ml-1">(was: {displayValue(c.from)})</span>
                                  )}
                                </span>
                              ) : c.from && !isClear ? (
                                // Field changed from → to
                                <span>
                                  <span className="font-semibold text-gray-700 dark:text-slate-200">{fieldLabel(c.field)}</span>
                                  {' Changed To '}
                                  <span className="font-bold text-strong">{displayValue(c.to)}</span>
                                  <span className="text-gray-400 dark:text-slate-500 ml-1">(was: {displayValue(c.from)})</span>
                                </span>
                              ) : (
                                // Field set for the first time
                                <span>
                                  <span className="font-semibold text-gray-700 dark:text-slate-200">{fieldLabel(c.field)}</span>
                                  {isBoolean ? ' Changed To ' : ' Set To '}
                                  <span className="font-bold text-strong">{displayValue(c.to)}</span>
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Fallback for non-update actions that have new_values */}
                    {ev.new_values && changes.length === 0 && !['load.update', 'load.create'].includes(ev.action) && !description && (
                      <div className="mt-1 text-helper text-muted">
                        {Object.entries(ev.new_values)
                          .filter(([k]) => !['id', 'tenant_id', 'order_id', 'created_at', 'updated_at'].includes(k))
                          .slice(0, 4)
                          .map(([k, v]) => `${fieldLabel(k)}: ${displayValue(v)}`)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
