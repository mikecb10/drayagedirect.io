import { useRef, useState, useEffect } from 'react';
import {
  ArrowLeftRight,
  FileEdit,
  Calendar,
  Clock,
  Hash,
  Package,
  Upload,
  DollarSign,
  PackagePlus,
  Share2,
  Copy,
  Printer,
  X,
  Check,
  RotateCcw,
  Activity,
  UserCheck,
  MapPin,
  Trash2,
} from 'lucide-react';
import CellPopover from './CellPopover';
import OrgPicker from '../ui/OrgPicker';
import DateTimePicker from '../ui/DateTimePicker';
import Dropdown from '../ui/Dropdown';
import { useTenantTimeFormat } from '../../hooks/useTenantSettings';

/**
 * BulkActionBar — fixed bar at the bottom of the Dispatcher when one or more
 * loads are selected. Each button opens a popover (or runs an instant action)
 * and calls `onApply(patch)` which bulk-updates every selected load.
 *
 * Actions supported:
 *   Ready For Return       — instant (sets ready_to_return_date = today)
 *   Edit Load Info         — Terminal, Warehouse, Container Return, Load Notes, Driver Notes
 *   Edit Dates             — LFD, Empty, Per Diem Free, CUT, ETA
 *   Edit Pick Up APT       — From/To datetime
 *   Edit Delivery APT      — From/To datetime
 *   Edit Return APT        — From/To datetime
 *   Edit Reference #s      — all 14 reference fields
 *   Edit Equipment Info    — big grid of equipment/flag fields
 *   Add Documents          — (stub)
 *   Add Charges            — (stub — needs charge set logic)
 *   Add to Order           — (stub)
 *   Live Share             — (stub)
 *   Copy Container         — instant (copies container #s to clipboard)
 *   Print                  — (stub)
 */
export default function BulkActionBar({
  selectedIds,
  loads,
  onApply,
  onClear,
  onFlash,
  onRefresh,
}) {
  const [openAction, setOpenAction] = useState(null);
  const anchorRefs = useRef({});

  if (!selectedIds || selectedIds.size === 0) return null;

  const selectedLoads = loads.filter((l) => selectedIds.has(l.id));
  const count = selectedIds.size;

  // ===== Instant action handlers =====

  // Toggle: if ALL selected loads already have ready_to_return_date set,
  // clear it (mark as NOT ready). Otherwise set the timestamp on all of
  // them and ensure the status is 'dropped' so the load filters into the
  // "Need To Be Returned → Ready" sub-card on the KPI strip.
  async function handleReadyForReturn() {
    const allMarked = selectedLoads.every((l) => !!l.ready_to_return_date);

    if (allMarked) {
      // TOGGLE OFF — clear the timestamp on all selected
      await onApply({ ready_to_return_date: null });
      onFlash?.(`Cleared ready for return on ${count} load${count !== 1 ? 's' : ''}`);
    } else {
      // TOGGLE ON — set timestamp + force status to 'dropped'
      const now = new Date().toISOString();
      await onApply({ ready_to_return_date: now, status: 'dropped' });
      onFlash?.(`Marked ${count} load${count !== 1 ? 's' : ''} ready for return`);
    }
  }

  async function handleCopyContainers() {
    const list = selectedLoads.map((l) => l.container_number).filter(Boolean);
    if (list.length === 0) {
      onFlash?.('No container numbers on selected loads', 'error');
      return;
    }
    const containers = list.join(', ');
    try {
      await navigator.clipboard.writeText(containers);
      onFlash?.(`Copied ${list.length} container #s`);
    } catch {
      onFlash?.('Copy failed', 'error');
    }
  }

  function handleStub(name) {
    onFlash?.(`${name} coming soon`, 'info');
  }

  // Soft-delete the selected loads. Confirms with the user first since
  // this is destructive and affects multiple rows. Calls the new
  // bulk-soft-delete endpoint, clears selection, and refetches via the
  // parent's onRefresh so the deleted loads disappear from the board.
  async function handleBulkSoftDelete() {
    if (count === 0) return;
    const ok = window.confirm(
      `Delete ${count} load${count !== 1 ? 's' : ''}? They'll be hidden from the dispatcher view but can be restored from Trash.`
    );
    if (!ok) return;
    try {
      const res = await fetch('/api/tenant/loads/bulk-soft-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ load_ids: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Bulk delete failed');
      }
      const data = await res.json();
      const deleted = data.deleted ?? 0;
      const skipped = data.skipped ?? 0;
      const msg = skipped > 0
        ? `Deleted ${deleted}; ${skipped} already gone`
        : `Deleted ${deleted} load${deleted === 1 ? '' : 's'}`;
      onFlash?.(msg);
      onClear?.();
      onRefresh?.();
    } catch (e) {
      onFlash?.(e.message, 'error');
    }
  }

  function handleOpen(actionKey, e) {
    e?.stopPropagation();
    setOpenAction(openAction === actionKey ? null : actionKey);
  }

  // ===== Button config =====

  // Hint the user when clicking will TOGGLE OFF (all selected are already marked)
  const allReadyForReturn = selectedLoads.every((l) => !!l.ready_to_return_date);

  const buttons = [
    {
      key: 'ready_for_return',
      label: allReadyForReturn ? 'Mark Not Ready' : 'Ready For Return',
      icon: RotateCcw,
      onClick: handleReadyForReturn,
      active: allReadyForReturn,
    },
    { key: 'status', label: 'Edit Status', icon: Activity, hasPopover: true },
    { key: 'terminal_status', label: 'Terminal Status', icon: MapPin, hasPopover: true },
    { key: 'csr', label: 'Assign CSR', icon: UserCheck, hasPopover: true },
    { key: 'load_info', label: 'Edit Load Info', icon: FileEdit, hasPopover: true },
    { key: 'dates', label: 'Edit Dates', icon: Calendar, hasPopover: true },
    { key: 'pickup_apt', label: 'Edit Pick Up APT', icon: Clock, hasPopover: true },
    { key: 'delivery_apt', label: 'Edit Delivery APT', icon: Clock, hasPopover: true },
    { key: 'return_apt', label: 'Edit Return APT', icon: Clock, hasPopover: true },
    { key: 'references', label: 'Edit Reference #s', icon: Hash, hasPopover: true },
    { key: 'equipment', label: 'Edit Equipment Info', icon: Package, hasPopover: true },
    { key: 'documents', label: 'Add Documents', icon: Upload, onClick: () => handleStub('Add Documents') },
    { key: 'charges', label: 'Add Charges', icon: DollarSign, onClick: () => handleStub('Add Charges') },
    { key: 'add_to_order', label: 'Add to Order', icon: PackagePlus, onClick: () => handleStub('Add to Order'), disabled: true },
    { key: 'live_share', label: 'Live Share', icon: Share2, onClick: () => handleStub('Live Share'), disabled: true },
    { key: 'copy_container', label: 'Copy Container', icon: Copy, onClick: handleCopyContainers },
    { key: 'print', label: 'Print', icon: Printer, onClick: () => handleStub('Print') },
    { key: 'delete', label: 'Delete', icon: Trash2, onClick: handleBulkSoftDelete, destructive: true },
  ];

  // ===== Popover content per action =====

  async function applyAndClose(patch) {
    // Forms may submit an empty patch when they did all the persistence
    // themselves (e.g. LoadInfoForm fires bulk-notes directly because the
    // bulk-update endpoint can't write to order_notes). Just close in that
    // case — calling onApply with an empty patch would 400 from the API.
    if (patch && Object.keys(patch).length > 0) {
      await onApply(patch);
    }
    setOpenAction(null);
  }

  function renderOpenPopover() {
    if (!openAction) return null;
    const anchor = anchorRefs.current[openAction];
    if (!anchor) return null;

    switch (openAction) {
      case 'status':
        return (
          <CellPopover anchorEl={anchor} onClose={() => setOpenAction(null)} width={240}>
            <StatusForm onSubmit={applyAndClose} />
          </CellPopover>
        );
      case 'csr':
        return (
          <CellPopover anchorEl={anchor} onClose={() => setOpenAction(null)} width={260}>
            <CsrForm onSubmit={applyAndClose} />
          </CellPopover>
        );
      case 'terminal_status':
        return (
          <CellPopover anchorEl={anchor} onClose={() => setOpenAction(null)} width={260}>
            <TerminalStatusForm onSubmit={applyAndClose} />
          </CellPopover>
        );
      case 'dates':
        return (
          <CellPopover anchorEl={anchor} onClose={() => setOpenAction(null)} width={380}>
            <DatesForm onSubmit={applyAndClose} />
          </CellPopover>
        );
      case 'pickup_apt':
        return (
          <CellPopover anchorEl={anchor} onClose={() => setOpenAction(null)} width={260}>
            <AptWindowForm
              fromField="pickup_apt_from"
              toField="pickup_apt_to"
              submitLabel="Add Pick Up Times"
              onSubmit={applyAndClose}
            />
          </CellPopover>
        );
      case 'delivery_apt':
        return (
          <CellPopover anchorEl={anchor} onClose={() => setOpenAction(null)} width={260}>
            <AptWindowForm
              fromField="delivery_apt_from"
              toField="delivery_apt_to"
              submitLabel="Add Delivery Times"
              onSubmit={applyAndClose}
            />
          </CellPopover>
        );
      case 'return_apt':
        return (
          <CellPopover anchorEl={anchor} onClose={() => setOpenAction(null)} width={260}>
            <AptWindowForm
              fromField="return_apt_from"
              toField="return_apt_to"
              submitLabel="Add Return Times"
              onSubmit={applyAndClose}
            />
          </CellPopover>
        );
      case 'references':
        return (
          <CellPopover anchorEl={anchor} onClose={() => setOpenAction(null)} width={320}>
            <ReferencesForm onSubmit={applyAndClose} />
          </CellPopover>
        );
      case 'equipment':
        return (
          <CellPopover anchorEl={anchor} onClose={() => setOpenAction(null)} width={420}>
            <EquipmentInfoForm onSubmit={applyAndClose} />
          </CellPopover>
        );
      case 'load_info':
        return (
          <CellPopover anchorEl={anchor} onClose={() => setOpenAction(null)} width={320}>
            <LoadInfoForm
              onSubmit={applyAndClose}
              loadIds={Array.from(selectedIds)}
              onFlash={onFlash}
            />
          </CellPopover>
        );
      default:
        return null;
    }
  }

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none flex justify-center pb-4 lg:pl-60">
        <div className="pointer-events-auto bg-slate-800 text-white rounded-xl shadow-2xl flex items-center gap-1 px-3 py-2 overflow-x-auto max-w-[95vw]">
          {/* Count badge */}
          <div className="flex items-center gap-2 pr-2 border-r border-white/10 mr-1 shrink-0">
            <div className="bg-blue-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
              {count}
            </div>
            <span className="text-xs font-medium">Selected</span>
          </div>

          {/* Action buttons */}
          {buttons.map((btn) => {
            const Icon = btn.icon;
            return (
              <button
                key={btn.key}
                ref={(el) => {
                  anchorRefs.current[btn.key] = el;
                }}
                type="button"
                disabled={btn.disabled}
                onClick={(e) => {
                  if (btn.hasPopover) {
                    handleOpen(btn.key, e);
                  } else if (btn.onClick) {
                    btn.onClick();
                  }
                }}
                className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                  btn.disabled
                    ? 'text-white/30 cursor-not-allowed'
                    : btn.active
                    ? 'bg-emerald-500/30 text-white ring-1 ring-emerald-400/60 hover:bg-emerald-500/40'
                    : btn.destructive
                    ? 'text-red-300 hover:bg-red-500/30 hover:text-white'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                } ${openAction === btn.key ? 'bg-white/15 text-white' : ''}`}
                title={btn.active ? 'All selected loads are already marked — click to unmark' : undefined}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{btn.label}</span>
              </button>
            );
          })}

          {/* Close */}
          <button
            type="button"
            onClick={onClear}
            className="ml-1 text-white/60 hover:text-white rounded p-1"
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {renderOpenPopover()}
    </>
  );
}

// ============================================================
// Form components for each popover
// ============================================================

// ===== Bulk Status change =====
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'available', label: 'Available' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'dropped', label: 'Dropped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function StatusForm({ onSubmit }) {
  const [status, setStatus] = useState('');
  return (
    <div className="space-y-2">
      <SelectField
        label="New Status"
        value={status}
        options={STATUS_OPTIONS}
        onChange={setStatus}
      />
      <FormBtn disabled={!status} onClick={() => onSubmit({ status })}>
        Set Status
      </FormBtn>
    </div>
  );
}

// ===== Bulk Terminal Status =====
// Free-form text — no enum on orders.terminal_status. Dispatchers use
// tenant-specific terminology (e.g. "READY", "HELD", "ROW 3"). The Clear
// toggle sends null so a bulk clear is one click.
function TerminalStatusForm({ onSubmit }) {
  const [value, setValue] = useState('');
  const [clear, setClear] = useState(false);

  function handleSubmit() {
    if (clear) {
      onSubmit({ terminal_status: null });
    } else if (value.trim()) {
      onSubmit({ terminal_status: value.trim() });
    }
  }

  const canSubmit = clear || !!value.trim();

  return (
    <div className="space-y-2">
      <TextField
        label="Terminal Status"
        value={value}
        onChange={(v) => {
          setValue(v);
          if (v.trim()) setClear(false);
        }}
        placeholder="e.g. READY, HELD, ROW 3"
      />
      <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={clear}
          onChange={(e) => {
            setClear(e.target.checked);
            if (e.target.checked) setValue('');
          }}
          className="rounded"
        />
        Clear terminal status (set to empty)
      </label>
      <FormBtn disabled={!canSubmit} onClick={handleSubmit}>
        {clear ? 'Clear Terminal Status' : 'Set Terminal Status'}
      </FormBtn>
    </div>
  );
}

// ===== Bulk Assign CSR =====
function CsrForm({ onSubmit }) {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tenant/users')
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data) => {
        // Sort by display name (first_name + last_name, falling back to email).
        const list = (data.users || [])
          .filter((u) => u.status !== 'inactive')
          .map((u) => ({
            id: u.id,
            label: u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setUsers(list);
      })
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  // The "" value submits as null — explicit "Unassign" path.
  const options = [
    { value: '__UNASSIGN__', label: '— Unassign CSR —' },
    ...users.map((u) => ({ value: u.id, label: u.label })),
  ];

  function handleSubmit() {
    if (!userId) return;
    const payload = { csr_user_id: userId === '__UNASSIGN__' ? null : userId };
    onSubmit(payload);
  }

  return (
    <div className="space-y-2">
      <SelectField
        label={loading ? 'Loading users…' : 'CSR'}
        value={userId}
        options={options}
        onChange={setUserId}
      />
      <FormBtn disabled={!userId || loading} onClick={handleSubmit}>
        {userId === '__UNASSIGN__' ? 'Unassign CSR' : 'Assign CSR'}
      </FormBtn>
    </div>
  );
}

function FormBtn({ children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-slate-600 text-white py-2 text-sm font-medium transition-colors mt-2"
    >
      {children}
    </button>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label || placeholder}
      className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
    />
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <Dropdown
      label={label}
      value={value}
      options={options || []}
      onChange={onChange}
      placeholder="— Select —"
    />
  );
}

function DateField({ label, value, onChange, type = 'date' }) {
  const use24h = useTenantTimeFormat();
  const showTime = type === 'datetime-local';
  return (
    <DateTimePicker
      label={label}
      value={value || null}
      onChange={(v) => onChange(v || '')}
      showTime={showTime}
      use24h={use24h}
    />
  );
}

// ===== Edit Dates popover =====
// All 12 date dimensions surfaced by the bulk Edit Dates form. Existing 5
// (LFD/Empty/PerDiem/CUT/ETA) plus 7 operational dates added via FU-092.
// type defaults to 'date' (matches the DATE column type in Postgres);
// timestamp-shaped fields override with 'datetime-local'.
const DATE_FIELDS = [
  { key: 'last_free_day', label: 'Last Free Day' },
  { key: 'empty_date', label: 'Empty Date' },
  { key: 'per_diem_free_day', label: 'Per Diem Free Day' },
  { key: 'cutoff_date', label: 'CUT', type: 'datetime-local' },
  { key: 'container_eta', label: 'ETA', type: 'datetime-local' },
  { key: 'pickup_date', label: 'Pickup Date' },
  { key: 'delivery_date', label: 'Delivery Date' },
  { key: 'vessel_eta', label: 'Vessel ETA' },
  { key: 'available_date', label: 'Available Date' },
  { key: 'discharge_date', label: 'Discharge Date' },
  { key: 'outgate_date', label: 'Outgate Date' },
  { key: 'ingate_date', label: 'Ingate Date' },
];

function DatesForm({ onSubmit }) {
  const [form, setForm] = useState(
    Object.fromEntries(DATE_FIELDS.map((f) => [f.key, '']))
  );

  function patch() {
    const out = {};
    for (const f of DATE_FIELDS) {
      if (form[f.key]) out[f.key] = form[f.key];
    }
    return out;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {DATE_FIELDS.map((f) => (
          <DateField
            key={f.key}
            label={f.label}
            value={form[f.key]}
            onChange={(v) => setForm({ ...form, [f.key]: v })}
            type={f.type}
          />
        ))}
      </div>
      <FormBtn
        disabled={Object.keys(patch()).length === 0}
        onClick={() => onSubmit(patch())}
      >
        Add Load Times
      </FormBtn>
    </div>
  );
}

// ===== Appointment window form (used for pickup/delivery/return) =====
function AptWindowForm({ fromField, toField, submitLabel, onSubmit }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Auto-mirror From → To when To is empty or was previously auto-copied
  // (still matches the old From). Treats the appointment as a firm time by
  // default; the user can override To for a buffer window. Mirrors the same
  // behavior in components/loads/tabs/LoadInfoTab.js.
  function handleFromChange(v) {
    const oldFrom = from;
    setFrom(v);
    if (v && (!to || to === oldFrom)) {
      setTo(v);
    }
  }

  function patch() {
    const out = {};
    if (from) out[fromField] = from;
    if (to) out[toField] = to;
    return out;
  }

  return (
    <div className="space-y-2">
      <DateField label="From" value={from} onChange={handleFromChange} type="datetime-local" />
      <DateField label="To" value={to} onChange={setTo} type="datetime-local" />
      <FormBtn disabled={Object.keys(patch()).length === 0} onClick={() => onSubmit(patch())}>
        {submitLabel}
      </FormBtn>
    </div>
  );
}

// ===== Edit Reference #s popover =====
function ReferencesForm({ onSubmit }) {
  const [form, setForm] = useState({
    bill_of_lading: '',
    booking_number: '',
    house_bol: '',
    pickup_number: '',
    customer_reference: '',
    return_number: '',
    shipment_number: '',
    seal_number: '',
    vessel_name: '',
    voyage_number: '',
    appointment_number: '',
    reservation_number: '',
  });

  function patch() {
    const out = {};
    for (const [k, v] of Object.entries(form)) {
      if (v && v.trim()) out[k] = v.trim();
    }
    return out;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Master Bill of Lading" value={form.bill_of_lading} onChange={(v) => setForm({ ...form, bill_of_lading: v })} />
        <TextField label="Booking #" value={form.booking_number} onChange={(v) => setForm({ ...form, booking_number: v })} />
        <TextField label="House Bill of Lading" value={form.house_bol} onChange={(v) => setForm({ ...form, house_bol: v })} />
        <TextField label="Pick Up #" value={form.pickup_number} onChange={(v) => setForm({ ...form, pickup_number: v })} />
        <TextField label="Reference #" value={form.customer_reference} onChange={(v) => setForm({ ...form, customer_reference: v })} />
        <TextField label="Return #" value={form.return_number} onChange={(v) => setForm({ ...form, return_number: v })} />
        <TextField label="Shipment #" value={form.shipment_number} onChange={(v) => setForm({ ...form, shipment_number: v })} />
        <TextField label="Seal #" value={form.seal_number} onChange={(v) => setForm({ ...form, seal_number: v })} />
        <TextField label="Vessel Name" value={form.vessel_name} onChange={(v) => setForm({ ...form, vessel_name: v })} />
        <TextField label="Voyage" value={form.voyage_number} onChange={(v) => setForm({ ...form, voyage_number: v })} />
        <TextField label="Appointment #" value={form.appointment_number} onChange={(v) => setForm({ ...form, appointment_number: v })} />
        <TextField label="Reservation #" value={form.reservation_number} onChange={(v) => setForm({ ...form, reservation_number: v })} />
      </div>
      <FormBtn disabled={Object.keys(patch()).length === 0} onClick={() => onSubmit(patch())}>
        Add References
      </FormBtn>
    </div>
  );
}

// ===== Edit Equipment Info popover =====
function EquipmentInfoForm({ onSubmit }) {
  const [form, setForm] = useState({
    genset_temperature: '',
    container_type: '',
    container_size: '',
    chassis_number: '',
    chassis_type: '',
    chassis_size: '',
    genset_number: '',
    chassis_owner: '',
    genset_route: '',
    steamship_line_scac: '',
    is_liquor: false,
    is_overweight: false,
    is_overheight: false,
    is_hot: false,
    is_bonded: false,
    is_double: false,
    is_hazmat: false,
    is_oog: false,
    is_ev: false,
    is_tanker: false,
    is_genset: false,
    is_scale: false,
    is_street_turn: false,
    is_bill_only: false,
  });
  const [sizeOpts, setSizeOpts] = useState([]);
  const [typeOpts, setTypeOpts] = useState([]);
  const [chassisSizeOpts, setChassisSizeOpts] = useState([]);
  const [chassisTypeOpts, setChassisTypeOpts] = useState([]);
  // Mode toggle for the flags grid: 'on' (default — selected flags get
  // is_X=true) or 'off' (selected flags get is_X=false). Switching modes
  // clears the selection so a single submit always emits one direction.
  const [flagMode, setFlagMode] = useState('on');

  function setFlagModeAndClear(mode) {
    if (mode === flagMode) return;
    setForm((f) => {
      const next = { ...f };
      for (const k of Object.keys(next)) {
        if (typeof next[k] === 'boolean') next[k] = false;
      }
      return next;
    });
    setFlagMode(mode);
  }

  // Fetch reference data once on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/tenant/container-sizes?enabled=true').then((r) => r.ok ? r.json() : { items: [] }),
      fetch('/api/tenant/container-types?enabled=true').then((r) => r.ok ? r.json() : { items: [] }),
      fetch('/api/tenant/chassis-sizes?enabled=true').then((r) => r.ok ? r.json() : { items: [] }),
      fetch('/api/tenant/chassis-types?enabled=true').then((r) => r.ok ? r.json() : { items: [] }),
    ]).then(([sizes, types, cSizes, cTypes]) => {
      setSizeOpts((sizes.items || []).map((s) => ({ value: s.code, label: s.label })));
      setTypeOpts((types.items || []).map((s) => ({ value: s.label, label: s.label })));
      setChassisSizeOpts((cSizes.items || []).map((s) => ({ value: s.code, label: s.label })));
      setChassisTypeOpts((cTypes.items || []).map((s) => ({ value: s.label, label: s.label })));
    }).catch(() => {});
  }, []);

  function patch() {
    const out = {};
    for (const [k, v] of Object.entries(form)) {
      if (typeof v === 'boolean') {
        // Boolean (is_*) fields are flag toggles. Emit only the ones the
        // user actively selected; the value depends on flagMode (true in
        // 'on' mode, false in 'off' mode).
        if (v === true) out[k] = (flagMode === 'on');
      }
      else if (typeof v === 'string' && v.trim()) out[k] = v.trim();
      else if (typeof v === 'number') out[k] = v;
    }
    return out;
  }

  function flagBtn(key, label) {
    const active = form[key];
    const activeClass = flagMode === 'on'
      ? 'bg-blue-500 text-white border-blue-500'
      : 'bg-red-500 text-white border-red-500';
    return (
      <button
        type="button"
        onClick={() => setForm({ ...form, [key]: !active })}
        className={`text-[11px] px-2 py-1 rounded border ${
          active
            ? activeClass
            : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="space-y-2 max-h-[65vh] overflow-y-auto">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Temperature" value={form.genset_temperature} onChange={(v) => setForm({ ...form, genset_temperature: v })} />
        <SelectField label="Container Size" value={form.container_size} options={sizeOpts} onChange={(v) => setForm({ ...form, container_size: v })} />
        <SelectField label="Container Type" value={form.container_type} options={typeOpts} onChange={(v) => setForm({ ...form, container_type: v })} />
        <TextField label="SSL SCAC" value={form.steamship_line_scac} onChange={(v) => setForm({ ...form, steamship_line_scac: v })} />
        <TextField label="Chassis #" value={form.chassis_number} onChange={(v) => setForm({ ...form, chassis_number: v })} />
        <SelectField label="Chassis Size" value={form.chassis_size} options={chassisSizeOpts} onChange={(v) => setForm({ ...form, chassis_size: v })} />
        <SelectField label="Chassis Type" value={form.chassis_type} options={chassisTypeOpts} onChange={(v) => setForm({ ...form, chassis_type: v })} />
        <TextField label="Chassis Owner" value={form.chassis_owner} onChange={(v) => setForm({ ...form, chassis_owner: v })} />
        <TextField label="Genset #" value={form.genset_number} onChange={(v) => setForm({ ...form, genset_number: v })} />
        <TextField label="Genset Route" value={form.genset_route} onChange={(v) => setForm({ ...form, genset_route: v })} />
      </div>
      <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400">
            Selected flags will be set to {flagMode === 'on' ? 'TRUE' : 'FALSE'}
          </div>
          <div className="inline-flex rounded-md border border-gray-300 dark:border-slate-600 overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setFlagModeAndClear('on')}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                flagMode === 'on'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
              }`}
            >
              Apply ON
            </button>
            <button
              type="button"
              onClick={() => setFlagModeAndClear('off')}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                flagMode === 'off'
                  ? 'bg-red-500 text-white'
                  : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
              }`}
            >
              Apply OFF
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {flagBtn('is_liquor', 'Liquor')}
          {flagBtn('is_overweight', 'Overweight')}
          {flagBtn('is_overheight', 'Overheight')}
          {flagBtn('is_hot', 'Hot')}
          {flagBtn('is_bonded', 'Bonded')}
          {flagBtn('is_double', 'Double')}
          {flagBtn('is_hazmat', 'Hazmat')}
          {flagBtn('is_oog', 'OOG')}
          {flagBtn('is_ev', 'EV')}
          {flagBtn('is_tanker', 'Tanker')}
          {flagBtn('is_genset', 'Genset')}
          {flagBtn('is_scale', 'Scale')}
          {flagBtn('is_street_turn', 'Street Turn')}
          {flagBtn('is_bill_only', 'Bill Only')}
        </div>
      </div>
      <FormBtn disabled={Object.keys(patch()).length === 0} onClick={() => onSubmit(patch())}>
        Add Equipment Info
      </FormBtn>
    </div>
  );
}

// ===== Edit Load Info popover =====
function LoadInfoForm({ onSubmit, loadIds, onFlash }) {
  const [form, setForm] = useState({
    pickup_location_id: null,
    delivery_location_id: null,
    return_location_id: null,
    final_delivery_location_id: null,
    load_note: '',
    driver_note: '',
  });
  const [labels, setLabels] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Locations go through bulk-update (orders.* columns).
  function locationPatch() {
    const out = {};
    if (form.pickup_location_id) out.pickup_location_id = form.pickup_location_id;
    if (form.delivery_location_id) out.delivery_location_id = form.delivery_location_id;
    if (form.return_location_id) out.return_location_id = form.return_location_id;
    if (form.final_delivery_location_id) out.final_delivery_location_id = form.final_delivery_location_id;
    return out;
  }

  // Notes go through the new bulk-notes endpoint into order_notes (audience-tagged),
  // not orders.notes / orders.internal_notes (which no UI surface reads).
  function notesToPost() {
    const out = [];
    if (form.load_note?.trim()) out.push({ audience: 'load', body: form.load_note.trim() });
    if (form.driver_note?.trim()) out.push({ audience: 'driver', body: form.driver_note.trim() });
    return out;
  }

  function isEmpty() {
    return Object.keys(locationPatch()).length === 0 && notesToPost().length === 0;
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const locations = locationPatch();
      const notes = notesToPost();

      // Apply structural updates (always closes the popover via applyAndClose).
      // When only notes are present, pass an empty patch — applyAndClose
      // skips the API call but still closes the popover.
      await onSubmit(Object.keys(locations).length > 0 ? locations : {});

      // Fire one bulk-notes POST per non-empty audience.
      if (notes.length > 0 && loadIds && loadIds.length > 0) {
        const results = await Promise.all(
          notes.map((n) =>
            fetch('/api/tenant/loads/bulk-notes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ load_ids: loadIds, audience: n.audience, body: n.body }),
            }).then(async (res) => {
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed to save ${n.audience} notes`);
              }
              return res.json();
            })
          )
        );
        const totalCreated = results.reduce((sum, r) => sum + (r.count || 0), 0);
        onFlash?.(
          `Added ${totalCreated} note${totalCreated !== 1 ? 's' : ''} across ${loadIds.length} load${loadIds.length !== 1 ? 's' : ''}`
        );
      }
    } catch (err) {
      onFlash?.(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2 max-h-[65vh] overflow-y-auto">
      <OrgPicker
        placeholder="Terminal"
        type="terminal"
        value={form.pickup_location_id}
        valueLabel={labels.pickup}
        onChange={(org) => {
          setForm({ ...form, pickup_location_id: org?.id || null });
          setLabels({ ...labels, pickup: org?.name || '' });
        }}
      />
      <OrgPicker
        placeholder="Warehouse"
        type="warehouse"
        value={form.delivery_location_id}
        valueLabel={labels.delivery}
        onChange={(org) => {
          setForm({ ...form, delivery_location_id: org?.id || null });
          setLabels({ ...labels, delivery: org?.name || '' });
        }}
      />
      <OrgPicker
        placeholder="Container Return"
        type="terminal"
        value={form.return_location_id}
        valueLabel={labels.return_}
        onChange={(org) => {
          setForm({ ...form, return_location_id: org?.id || null });
          setLabels({ ...labels, return_: org?.name || '' });
        }}
      />
      <OrgPicker
        placeholder="Final Delivery"
        type="warehouse"
        value={form.final_delivery_location_id}
        valueLabel={labels.final_delivery}
        onChange={(org) => {
          setForm({ ...form, final_delivery_location_id: org?.id || null });
          setLabels({ ...labels, final_delivery: org?.name || '' });
        }}
      />
      <textarea
        value={form.load_note}
        onChange={(e) => setForm({ ...form, load_note: e.target.value })}
        placeholder="Load Notes"
        rows={2}
        className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 resize-none"
      />
      <textarea
        value={form.driver_note}
        onChange={(e) => setForm({ ...form, driver_note: e.target.value })}
        placeholder="Driver Notes"
        rows={2}
        className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 resize-none"
      />
      <FormBtn disabled={isEmpty() || submitting} onClick={handleSubmit}>
        {submitting ? 'Saving…' : 'Add Load Info'}
      </FormBtn>
    </div>
  );
}
