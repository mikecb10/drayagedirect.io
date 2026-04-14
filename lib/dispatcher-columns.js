/**
 * Dispatcher Board Column Definitions
 *
 * Single source of truth for all 63 columns available on the Dispatcher Board.
 * Each column has:
 *   key            - unique identifier (matches DB column or derived name)
 *   label          - display text in header + Board Columns panel
 *   width          - fixed pixel width (used for sticky column offset math)
 *   defaultVisible - shown by default on a user's first visit
 *   defaultFrozen  - sticky-left by default
 *   renderCell     - function(row) → ReactNode for the cell content
 *
 * To add a column, append to the DISPATCHER_COLUMNS array below.
 */

import { deriveState, STATE_BY_KEY } from './dispatcher-states';

// ============================================================
// HELPERS
// ============================================================

// Parse a date string safely. Date-only strings like "2026-04-13" parse
// as UTC midnight in JS, which shifts back a day in US timezones (e.g.
// Apr 13 UTC = Apr 12 7pm CDT). Appending T12:00:00 keeps it on the
// correct calendar day in any timezone.
function safeParse(d) {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return new Date(d + 'T12:00:00');
  }
  return new Date(d);
}

function formatDate(d) {
  if (!d) return null;
  try {
    return safeParse(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
    });
  } catch {
    return null;
  }
}

function formatDateTime(d) {
  if (!d) return null;
  try {
    // For date-only strings, show just the date (no time component)
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return safeParse(d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    }
    return new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function driverName(driver) {
  if (!driver) return null;
  const full = [driver.first_name, driver.last_name].filter(Boolean).join(' ');
  return full || driver.name || null;
}

// Pulls a note body from the `notes_by_audience` aggregate the API computes.
function noteFor(row, audience) {
  const note = row?.notes_by_audience?.[audience];
  return note || null;
}

function truncate(s, n = 40) {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function em(value) {
  if (value == null || value === '') return <span className="text-gray-300 dark:text-slate-600">—</span>;
  return value;
}

function text(s) {
  return em(s);
}

// Computes row warnings from load data (client-side).
export function computeWarnings(row) {
  const warnings = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (row.last_free_day) {
    const lfd = new Date(row.last_free_day);
    const diffDays = Math.floor((lfd - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) warnings.push('LFD Passed');
    else if (diffDays <= 2) warnings.push('LFD Soon');
  }

  if (row.per_diem_free_day) {
    const pdfd = new Date(row.per_diem_free_day);
    if (pdfd < today) warnings.push('Per Diem Risk');
  }

  if (row.pickup_date && row.status === 'pending') {
    const pd = new Date(row.pickup_date);
    if (pd < today) warnings.push('Overdue');
  }

  return warnings;
}

// ============================================================
// CELL RENDERERS
// ============================================================

const dateCell = (key) => (row) => em(formatDate(row[key]));
const textCell = (key) => (row) => text(row[key]);
const tsCell = (key) => (row) => em(formatDateTime(row[key]));

function statusBadge(status) {
  const cfg = {
    pending: { label: 'Pending', cls: 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300' },
    available: { label: 'Available', cls: 'bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300' },
    dispatched: { label: 'Dispatched', cls: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300' },
    in_transit: { label: 'In Transit', cls: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' },
    dropped: { label: 'Dropped', cls: 'bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300' },
    delivered: { label: 'Delivered', cls: 'bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300' },
    completed: { label: 'Completed', cls: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' },
    cancelled: { label: 'Cancelled', cls: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300' },
  }[status] || { label: status || '—', cls: 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400' };
  return (
    <span className={`inline-flex text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function typeBadge(type) {
  if (!type) return <span className="text-gray-300 dark:text-slate-600">—</span>;
  const cfg = {
    import: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
    inbound: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300',
    export: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300',
    outbound: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300',
    road: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300',
    bill_only: 'bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-slate-300',
  }[type] || 'bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-400';
  return (
    <span className={`inline-flex text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${cfg}`}>
      {type.replace('_', ' ')}
    </span>
  );
}

// ============================================================
// COLUMN DEFINITIONS (63)
// ============================================================

// Flag definitions — icon + color for each boolean flag on a load
const FLAG_DEFS = [
  { key: 'is_hazmat',      icon: '⚠️', label: 'Hazmat',       cls: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300' },
  { key: 'is_hot',         icon: '🔥', label: 'Hot',          cls: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300' },
  { key: 'is_overweight',  icon: '⚖️', label: 'Overweight',   cls: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' },
  { key: 'is_overheight',  icon: '📏', label: 'Overheight',   cls: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' },
  { key: 'is_genset',      icon: '⚡', label: 'Genset',       cls: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300' },
  { key: 'is_scale',       icon: '⚖', label: 'Scale',        cls: 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300' },
  { key: 'is_ev',          icon: '🔋', label: 'EV',           cls: 'bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300' },
  { key: 'is_street_turn', icon: '🔄', label: 'Street Turn',  cls: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300' },
  { key: 'is_oog',         icon: '📦', label: 'OOG',          cls: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300' },
  { key: 'is_bonded',      icon: '🔒', label: 'Bonded',       cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' },
  { key: 'is_double',      icon: '2️⃣', label: 'Double',       cls: 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300' },
  { key: 'is_tanker',      icon: '🛢', label: 'Tanker',       cls: 'bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300' },
  { key: 'is_liquor',      icon: '🍷', label: 'Liquor',       cls: 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300' },
];

function getActiveFlags(row) {
  return FLAG_DEFS.filter((f) => !!row[f.key]);
}

export const DISPATCHER_COLUMNS = [
  // === Frozen / Primary identifiers ===
  {
    key: 'order_number',
    label: 'Load #',
    width: 160,
    defaultVisible: true,
    defaultFrozen: true,
    interaction: {
      type: 'link',
      hrefTemplate: '/dispatcher?load={id}&tab=info',
      idField: 'id',
    },
    renderCell: (row, ctx) => {
      const typeColor = ctx?.loadTypeColors?.[row.load_type];
      const flags = getActiveFlags(row);
      return (
        <div className="leading-tight flex items-start gap-1.5">
          <div className="flex-1 min-w-0">
            <span
              className="font-mono text-xs font-semibold underline-offset-2 hover:underline cursor-pointer"
              style={{ color: typeColor || '#2563eb' }}
              data-open-load="true"
              data-load-id={row.id}
            >
              {row.order_number}
            </span>
            {flags.length > 0 && (
              <div className="flex flex-wrap gap-0.5 mt-0.5">
                {flags.map((f) => (
                  <span
                    key={f.key}
                    title={f.label}
                    className={`inline-block text-[9px] leading-none px-1 py-0.5 rounded font-bold ${f.cls}`}
                  >
                    {f.icon}
                  </span>
                ))}
              </div>
            )}
          </div>
          <span
            className="shrink-0 mt-0.5 w-5 h-5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-500 dark:text-blue-400 flex items-center justify-center cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/60 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            title="Open load"
            data-open-load="true"
            data-load-id={row.id}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </span>
        </div>
      );
    },
  },
  {
    key: 'customer',
    label: 'Customer',
    width: 180,
    defaultVisible: true,
    defaultFrozen: true,
    interaction: {
      type: 'orgPicker',
      field: 'customer_id',
      orgType: 'customer',
      labelPath: 'customer.name',
    },
    renderCell: (row) => em(row.customer?.name),
  },
  {
    key: 'container_number',
    label: 'Container #',
    width: 150,
    defaultVisible: true,
    defaultFrozen: true,
    interaction: { type: 'copy', field: 'container_number' },
    renderCell: (row) => (row.container_number ? (
      <span className="font-mono text-xs">{row.container_number}</span>
    ) : em(null)),
  },
  {
    key: 'status',
    label: 'Load Status',
    width: 130,
    defaultVisible: true,
    defaultFrozen: true,
    interaction: {
      type: 'select',
      field: 'status',
      options: [
        { value: 'pending', label: 'Pending' },
        { value: 'available', label: 'Available' },
        { value: 'dispatched', label: 'Dispatched' },
        { value: 'in_transit', label: 'In Transit' },
        { value: 'dropped', label: 'Dropped' },
        { value: 'delivered', label: 'Delivered' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
    renderCell: (row) => statusBadge(row.status),
  },

  // Fine-grained operational state (derived from order status + current routing event)
  {
    key: 'event_state',
    label: 'Event State',
    width: 195,
    defaultVisible: true,
    defaultFrozen: false,
    renderCell: (row, ctx) => {
      const key = deriveState(row);
      const state = STATE_BY_KEY[key];
      if (!state) return em(null);
      const bg = ctx?.stateColors?.[key] || state.defaultColor;
      return (
        <span
          className="inline-flex items-center rounded text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5"
          style={{ backgroundColor: bg, color: state.textColor }}
        >
          {state.label}
        </span>
      );
    },
  },

  // === Core operational columns ===
  // Load Type is display-only — the load number embeds the type letter
  // (M/N/E/O/R/B), so it cannot be changed after creation.
  { key: 'load_type', label: 'Load Type', width: 120, defaultVisible: true, defaultFrozen: false,
    renderCell: (row) => typeBadge(row.load_type) },
  { key: 'driver', label: 'Driver', width: 200, defaultVisible: true, defaultFrozen: false,
    interaction: { type: 'driverInline', field: 'driver_id' },
    renderCell: (row) => {
      const name = driverName(row.driver);
      const isDispatched = !!row.dispatched_at;

      // No driver assigned — show person + icon
      if (!name) {
        return (
          <div className="flex items-center justify-center">
            <div className="relative w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-800 border-2 border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center text-gray-400 dark:text-slate-500 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-500 dark:hover:text-blue-400 cursor-pointer transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-blue-500 text-white flex items-center justify-center text-[8px] font-bold border border-white dark:border-slate-900">
                +
              </div>
            </div>
          </div>
        );
      }

      // Check if driver has started any move (has routing events with arrived_at)
      const hasStartedMove = (row.routing_events || []).some((e) => e.arrived_at);

      // Driver assigned
      return (
        <div className="flex items-center gap-1.5">
          {/* Driver avatar */}
          <div className="relative shrink-0">
            <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center text-[10px] font-bold">
              {(name[0] || '?').toUpperCase()}
            </div>
            {isDispatched && (
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border border-white dark:border-slate-900" title="Dispatched" />
            )}
          </div>
          <span className="text-xs text-gray-900 dark:text-slate-100 truncate flex-1">{name}</span>
          {/* Action buttons */}
          <div className="flex gap-0.5 shrink-0">
            {/* Green dispatch button — only before dispatch */}
            {!isDispatched && (
              <span
                className="w-5 h-5 rounded bg-green-500 text-white flex items-center justify-center text-[10px] font-bold cursor-pointer hover:bg-green-600"
                title="Dispatch to driver"
                data-dispatch="true"
                data-load-id={row.id}
              >✓</span>
            )}
            {/* Red remove button — always visible UNLESS driver has started a move */}
            {!hasStartedMove && (
              <span
                className="w-5 h-5 rounded bg-red-500 text-white flex items-center justify-center text-[10px] font-bold cursor-pointer hover:bg-red-600"
                title="Remove driver from load"
                data-remove-driver="true"
                data-load-id={row.id}
              >✗</span>
            )}
            {/* Status badges */}
            {isDispatched && !hasStartedMove && (
              <span className="text-[8px] uppercase tracking-wide font-bold bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded shrink-0 ml-0.5">
                Sent
              </span>
            )}
            {hasStartedMove && (
              <span className="text-[8px] uppercase tracking-wide font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded shrink-0 ml-0.5">
                Active
              </span>
            )}
          </div>
        </div>
      );
    },
  },
  { key: 'pickup_location', label: 'Pick Up Location', width: 185, defaultVisible: true, defaultFrozen: false,
    interaction: { type: 'orgPicker', field: 'pickup_location_id', orgType: 'terminal', labelPath: 'pickup_org.name' },
    renderCell: (row) => em(row.pickup_org?.name) },
  { key: 'delivery_location', label: 'Delivery Location', width: 185, defaultVisible: true, defaultFrozen: false,
    interaction: { type: 'orgPicker', field: 'delivery_location_id', orgType: 'warehouse', labelPath: 'delivery_org.name' },
    renderCell: (row) => em(row.delivery_org?.name) },
  { key: 'return_location', label: 'Return Location', width: 175, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'orgPicker', field: 'return_location_id', orgType: 'terminal', labelPath: 'return_org.name' },
    renderCell: (row) => em(row.return_org?.name) },
  { key: 'delivery_city_state', label: 'Delivery City/State', width: 165, defaultVisible: true, defaultFrozen: false,
    renderCell: (row) => em([row.delivery_org?.city, row.delivery_org?.state].filter(Boolean).join(', ')) },

  // === Reference numbers (all copy-on-click) ===
  { key: 'mbol_bkg', label: 'MBOL/BKG', width: 150, defaultVisible: true, defaultFrozen: false,
    interaction: { type: 'copy', field: 'bill_of_lading' },
    renderCell: (row) => em(row.bill_of_lading || row.booking_number) },
  { key: 'house_bol', label: 'House BOL', width: 140, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'copy', field: 'house_bol' },
    renderCell: textCell('house_bol') },
  { key: 'reference_number', label: 'Reference #', width: 140, defaultVisible: true, defaultFrozen: false,
    interaction: { type: 'edit', field: 'customer_reference', inputType: 'text' },
    renderCell: textCell('customer_reference') },
  { key: 'shipment_number', label: 'Shipment #', width: 140, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'edit', field: 'shipment_number', inputType: 'text' },
    renderCell: textCell('shipment_number') },
  { key: 'pickup_number', label: 'Pick Up #', width: 120, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'edit', field: 'pickup_number', inputType: 'text' },
    renderCell: textCell('pickup_number') },
  { key: 'appointment_number', label: 'Appointment #', width: 160, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'edit', field: 'appointment_number', inputType: 'text' },
    renderCell: textCell('appointment_number') },
  { key: 'return_number', label: 'Return #', width: 120, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'edit', field: 'return_number', inputType: 'text' },
    renderCell: textCell('return_number') },
  { key: 'reservation_number', label: 'Reservation #', width: 150, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'edit', field: 'reservation_number', inputType: 'text' },
    renderCell: textCell('reservation_number') },
  { key: 'purchase_order', label: 'Purchase Order #', width: 170, defaultVisible: false, defaultFrozen: false,
    renderCell: (row) => em((row.po_numbers || []).join(', ') || null) },
  { key: 'ref_container_number', label: 'Ref Container #', width: 160, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'edit', field: 'ref_container_number', inputType: 'text' },
    renderCell: textCell('ref_container_number') },

  // === Equipment ===
  { key: 'container_type', label: 'Type', width: 100, defaultVisible: false, defaultFrozen: false,
    interaction: {
      type: 'refPicker',
      field: 'container_type_id',
      displayField: 'container_type',
      endpoint: '/api/tenant/container-types',
      snapshotFrom: 'label',
    },
    renderCell: textCell('container_type') },
  { key: 'container_size', label: 'Size', width: 80, defaultVisible: true, defaultFrozen: false,
    interaction: {
      type: 'refPicker',
      field: 'container_size_id',
      displayField: 'container_size',
      endpoint: '/api/tenant/container-sizes',
      snapshotFrom: 'code',
    },
    renderCell: textCell('container_size') },
  { key: 'seal_number', label: 'Seal #', width: 120, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'copy', field: 'seal_number' },
    renderCell: textCell('seal_number') },
  { key: 'chassis_number', label: 'Chassis #', width: 120, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'copy', field: 'chassis_number' },
    renderCell: textCell('chassis_number') },
  { key: 'gray_chassis_number', label: 'Gray Chassis #', width: 160, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'copy', field: 'gray_chassis_number' },
    renderCell: textCell('gray_chassis_number') },
  { key: 'gray_container_number', label: 'Gray Container #', width: 175, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'copy', field: 'gray_container_number' },
    renderCell: textCell('gray_container_number') },
  { key: 'genset_number', label: 'Genset #', width: 110, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'copy', field: 'genset_number' },
    renderCell: textCell('genset_number') },
  { key: 'total_weight', label: 'Weight (lbs)', width: 110, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'edit', field: 'weight_lbs', inputType: 'number' },
    renderCell: (row) => em(row.weight_lbs ? `${row.weight_lbs.toLocaleString()} lbs` : null) },
  { key: 'weight_kg', label: 'Weight (kg)', width: 110, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'edit', field: 'weight_kg', inputType: 'number' },
    renderCell: (row) => em(row.weight_kg ? `${Number(row.weight_kg).toLocaleString()} kg` : null) },
  { key: 'piece_count', label: 'Pieces', width: 90, defaultVisible: true, defaultFrozen: false,
    interaction: { type: 'edit', field: 'piece_count', inputType: 'number' },
    renderCell: (row) => em(row.piece_count != null ? row.piece_count.toLocaleString() : null) },
  { key: 'pallet_count', label: 'Pallets', width: 90, defaultVisible: true, defaultFrozen: false,
    interaction: { type: 'edit', field: 'pallet_count', inputType: 'number' },
    renderCell: (row) => em(row.pallet_count != null ? row.pallet_count.toLocaleString() : null) },
  { key: 'commodity', label: 'Commodity', width: 200, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'edit', field: 'commodity_description', inputType: 'text' },
    renderCell: (row) => em(truncate(row.commodity_description, 50)) },

  // === Vessel / SSL ===
  { key: 'vessel_name', label: 'Vessel Name', width: 150, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'copy', field: 'vessel_name' },
    renderCell: textCell('vessel_name') },
  { key: 'voyage_number', label: 'Voyage', width: 110, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'copy', field: 'voyage_number' },
    renderCell: textCell('voyage_number') },
  { key: 'ssl', label: 'SSL', width: 110, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'containerOwnerPicker', field: 'container_owner_id' },
    renderCell: textCell('steamship_line') },
  { key: 'scac', label: 'SCAC', width: 80, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'copy', field: 'steamship_line_scac' },
    renderCell: textCell('steamship_line_scac') },

  // === Dates (DB) ===
  { key: 'container_eta', label: 'Container ETA', width: 150, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'date', field: 'container_eta', dateType: 'datetime-local' },
    renderCell: tsCell('container_eta') },
  { key: 'available_date', label: 'Available Date', width: 140, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'date', field: 'available_date', dateType: 'date' },
    renderCell: dateCell('available_date') },
  { key: 'discharge_date', label: 'Discharge Date', width: 140, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'date', field: 'discharge_date', dateType: 'date' },
    renderCell: dateCell('discharge_date') },
  { key: 'last_free_day', label: 'LFD/ERD', width: 110, defaultVisible: true, defaultFrozen: false,
    interaction: { type: 'date', field: 'last_free_day', dateType: 'date' },
    renderCell: dateCell('last_free_day') },
  { key: 'per_diem_free_day', label: 'Per Diem Free Day', width: 165, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'date', field: 'per_diem_free_day', dateType: 'date' },
    renderCell: dateCell('per_diem_free_day') },
  { key: 'cutoff_date', label: 'Cut Off Date', width: 135, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'date', field: 'cutoff_date', dateType: 'datetime-local' },
    renderCell: (row) => em(formatDateTime(row.cutoff_date)) },
  { key: 'ready_to_return_date', label: 'Ready To Return', width: 185, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'date', field: 'ready_to_return_date', dateType: 'datetime-local' },
    renderCell: (row) => em(formatDateTime(row.ready_to_return_date)) },

  // === Appointment windows ===
  { key: 'pickup_apt_from', label: 'Pick Up Apt From', width: 170, defaultVisible: true, defaultFrozen: false,
    interaction: { type: 'date', field: 'pickup_apt_from', dateType: 'datetime-local' },
    renderCell: tsCell('pickup_apt_from') },
  { key: 'pickup_apt_to', label: 'Pick Up Apt To', width: 160, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'date', field: 'pickup_apt_to', dateType: 'datetime-local' },
    renderCell: tsCell('pickup_apt_to') },
  { key: 'delivery_apt_from', label: 'Delivery Apt From', width: 170, defaultVisible: true, defaultFrozen: false,
    interaction: { type: 'date', field: 'delivery_apt_from', dateType: 'datetime-local' },
    renderCell: tsCell('delivery_apt_from') },
  { key: 'delivery_apt_to', label: 'Delivery Apt To', width: 160, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'date', field: 'delivery_apt_to', dateType: 'datetime-local' },
    renderCell: tsCell('delivery_apt_to') },
  { key: 'return_apt_from', label: 'Return Apt From', width: 165, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'date', field: 'return_apt_from', dateType: 'datetime-local' },
    renderCell: tsCell('return_apt_from') },
  { key: 'return_apt_to', label: 'Return Apt To', width: 155, defaultVisible: false, defaultFrozen: false,
    interaction: { type: 'date', field: 'return_apt_to', dateType: 'datetime-local' },
    renderCell: tsCell('return_apt_to') },

  // === Routing / Events ===
  { key: 'routing_template', label: 'Routing Template', width: 160, defaultVisible: false, defaultFrozen: false,
    renderCell: textCell('routing_template_name') },
  { key: 'event', label: 'Event', width: 130, defaultVisible: true, defaultFrozen: false,
    renderCell: (row) => em(row.current_event?.event_type?.replace('_', ' ')) },
  { key: 'next_address', label: 'Next Address', width: 200, defaultVisible: false, defaultFrozen: false,
    renderCell: (row) => {
      const e = row.current_event;
      if (!e) return em(null);
      const loc = e.location?.name || e.location_name;
      const city = [e.city, e.state].filter(Boolean).join(', ');
      return <span className="text-xs">{loc}{city && <span className="text-gray-400 dark:text-slate-500"> · {city}</span>}</span>;
    } },

  // === Status / Holds / Terminal ===
  { key: 'holds', label: 'Holds', width: 90, defaultVisible: true, defaultFrozen: false,
    renderCell: (row) => {
      const activeHolds = (row.holds || []).filter((h) => h.status === 'hold');
      if (activeHolds.length === 0) return <span className="text-green-600 dark:text-green-400 text-xs">Released</span>;
      return (
        <span className="inline-flex text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300">
          {activeHolds.length} Hold{activeHolds.length > 1 ? 's' : ''}
        </span>
      );
    } },
  { key: 'terminal_status', label: 'Terminal Status', width: 130, defaultVisible: false, defaultFrozen: false,
    renderCell: textCell('terminal_status') },

  // === CSR / People ===
  { key: 'csr', label: 'CSR', width: 130, defaultVisible: false, defaultFrozen: false,
    renderCell: (row) => em(row.csr?.name) },

  // === Notes (per audience) ===
  { key: 'driver_note', label: 'Driver Note', width: 180, defaultVisible: false, defaultFrozen: false,
    renderCell: (row) => em(truncate(noteFor(row, 'driver'))) },
  { key: 'load_note', label: 'Load Note', width: 180, defaultVisible: false, defaultFrozen: false,
    renderCell: (row) => em(truncate(noteFor(row, 'load'))) },
  { key: 'yard_note', label: 'Yard Note', width: 180, defaultVisible: false, defaultFrozen: false,
    renderCell: (row) => em(truncate(noteFor(row, 'yard'))) },
  { key: 'terminal_note', label: 'Terminal Note', width: 180, defaultVisible: false, defaultFrozen: false,
    renderCell: (row) => em(truncate(noteFor(row, 'terminal'))) },

  // === Derived / stub columns ===
  { key: 'driver_eta', label: 'Driver ETA', width: 110, defaultVisible: false, defaultFrozen: false,
    renderCell: () => <span className="text-gray-300 dark:text-slate-600 text-xs italic">—</span> },
  { key: 'distance', label: 'Distance', width: 100, defaultVisible: false, defaultFrozen: false,
    renderCell: (row) => em(row.estimated_miles ? `${row.estimated_miles} mi` : null) },
  { key: 'last_tracked', label: 'Last Tracked', width: 130, defaultVisible: false, defaultFrozen: false,
    renderCell: () => <span className="text-gray-300 dark:text-slate-600 text-xs italic">—</span> },
  { key: 'emails', label: 'Emails', width: 80, defaultVisible: false, defaultFrozen: false,
    renderCell: () => <span className="text-gray-300 dark:text-slate-600">—</span> },

  // === Container Return (derived) ===
  { key: 'container_return', label: 'Container Return', width: 140, defaultVisible: false, defaultFrozen: false,
    renderCell: (row) => em(formatDateTime(row.return_apt_from)) },

  // === Warning (client-computed) ===
  {
    key: 'warning',
    label: 'Warning',
    width: 150,
    defaultVisible: true,
    defaultFrozen: false,
    renderCell: (row) => {
      const warnings = computeWarnings(row);
      if (warnings.length === 0) return <span className="text-gray-300 dark:text-slate-600">—</span>;
      return (
        <div className="flex gap-1 flex-wrap">
          {warnings.map((w) => (
            <span
              key={w}
              className="inline-flex text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300"
            >
              {w}
            </span>
          ))}
        </div>
      );
    },
  },
];

// Quick lookup by key
export const COLUMN_BY_KEY = DISPATCHER_COLUMNS.reduce((acc, col) => {
  acc[col.key] = col;
  return acc;
}, {});

// Defaults derived from the definitions
export const DEFAULT_VISIBLE = DISPATCHER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
export const DEFAULT_HIDDEN = DISPATCHER_COLUMNS.filter((c) => !c.defaultVisible).map((c) => c.key);
export const DEFAULT_FROZEN = DISPATCHER_COLUMNS.filter((c) => c.defaultFrozen).map((c) => c.key);
export const DEFAULT_ORDER = DISPATCHER_COLUMNS.map((c) => c.key);

/**
 * Resolve the final column list to render based on a user's preferences.
 * - Preserves user's saved order for known keys
 * - Appends any newly-added columns at the end (future-proof)
 * - Removes hidden columns
 * - Sorts frozen columns to the front in their saved order
 */
export function resolveColumns(prefs) {
  const order = prefs?.column_order?.length ? prefs.column_order : DEFAULT_ORDER;
  const hidden = new Set(prefs?.hidden_columns?.length ? prefs.hidden_columns : DEFAULT_HIDDEN);
  const frozen = new Set(prefs?.frozen_columns?.length ? prefs.frozen_columns : DEFAULT_FROZEN);
  const widths = prefs?.column_widths || {};

  // Merge: user order first, then any new columns not in the saved order
  const allKeys = [...order];
  for (const c of DISPATCHER_COLUMNS) {
    if (!allKeys.includes(c.key)) allKeys.push(c.key);
  }

  // Filter hidden + map to column definitions, applying saved widths as overrides
  const visible = allKeys
    .filter((k) => !hidden.has(k))
    .map((k) => {
      const def = COLUMN_BY_KEY[k];
      if (!def) return null;
      // Apply saved width override (if any) without mutating the shared definition
      const savedWidth = widths[k];
      if (savedWidth && savedWidth !== def.width) {
        return { ...def, width: savedWidth };
      }
      return def;
    })
    .filter(Boolean);

  // Sort: frozen first (preserving order), then non-frozen
  const frozenCols = visible.filter((c) => frozen.has(c.key));
  const unfrozenCols = visible.filter((c) => !frozen.has(c.key));

  return {
    columns: [...frozenCols, ...unfrozenCols],
    frozenCols,
    unfrozenCols,
    frozenSet: frozen,
    hiddenSet: hidden,
  };
}
