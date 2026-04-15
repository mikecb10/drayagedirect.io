import { useEffect, useState } from 'react';
import { Plus, Trash2, Wallet, User, DollarSign, RefreshCw, CheckCircle2, XCircle, ChevronDown, Sparkles, Hand, ExternalLink } from 'lucide-react';
import DriverChargeProfileViewer from '../DriverChargeProfileViewer';
import Alert from '../../ui/Alert';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import DateTimePicker from '../../ui/DateTimePicker';
import CurrencyInput from '../../ui/CurrencyInput';
import DriverPicker from '../../ui/DriverPicker';
import OrgPicker from '../../ui/OrgPicker';

const LINE_TYPES = [
  { value: 'line_haul', label: 'Line Haul' },
  { value: 'detention', label: 'Detention' },
  { value: 'fuel_surcharge', label: 'Fuel Surcharge' },
  { value: 'layover', label: 'Layover' },
  { value: 'chassis_split', label: 'Chassis Split' },
  { value: 'scale', label: 'Scale' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'other', label: 'Other' },
];

const STATUS_STYLES = {
  drafted: 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200',
  unapproved: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  approved: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
  reviewed: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300',
  finalized: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
};

const STATUS_FLOW = {
  drafted: 'unapproved',
  unapproved: 'approved',
  approved: 'reviewed',
  reviewed: 'finalized',
  finalized: null,
};

const STATUS_NEXT_LABEL = {
  drafted: 'Submit',
  unapproved: 'Approve',
  approved: 'Review',
  reviewed: 'Finalize',
};

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DriverPayTab({ load }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    driver_id: load?.driver_id || null,
    line_type: 'line_haul',
    description: '',
    from_location: '',
    from_location_label: '',
    to_location: '',
    to_location_label: '',
    amount_cents: null,
    hours: '',
    miles: '',
    worked_at: '',
  });

  async function fetchLines() {
    if (!load?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/driver-pay`);
      if (!res.ok) throw new Error('Failed to load driver pay');
      const data = await res.json();
      setLines(data.lines || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load?.id]);

  async function handleCreate() {
    if (!draft.amount_cents && draft.amount_cents !== 0) {
      setError('Amount is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/driver-pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_id: draft.driver_id,
          line_type: draft.line_type,
          description: draft.description || null,
          from_location: draft.from_location || null,
          to_location: draft.to_location || null,
          amount_cents: draft.amount_cents,
          hours: draft.hours ? parseFloat(draft.hours) : null,
          miles: draft.miles ? parseFloat(draft.miles) : null,
          worked_at: draft.worked_at || new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Failed to add pay line');
      setDraft({
        driver_id: load?.driver_id || null,
        line_type: 'line_haul',
        description: '',
        from_location: '',
        from_location_label: '',
        to_location: '',
        to_location_label: '',
        amount_cents: null,
        hours: '',
        miles: '',
        worked_at: '',
      });
      setShowForm(false);
      await fetchLines();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function advanceStatus(line) {
    const next = STATUS_FLOW[line.status];
    if (!next) return;
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/driver-pay/${line.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      await fetchLines();
    } catch (e) {
      setError(e.message);
    }
  }

  async function updateLine(lineId, patch) {
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/driver-pay/${lineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update');
      await fetchLines();
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteLine(lineId) {
    if (!confirm('Delete this pay line?')) return;
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/driver-pay/${lineId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      await fetchLines();
    } catch (e) {
      setError(e.message);
    }
  }

  // Manual driver-pay recalculation. Fires the same engine as the auto hook
  // on load PUT, but returns a diagnostic trace so a zero-result outcome is
  // debuggable instead of silent.
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [diagOpen, setDiagOpen] = useState(false);

  // Source charge profile viewer — opens as a modal on the load instead of
  // navigating the user away. Keeps context (they're investigating THIS pay
  // line in the context of THIS load). The viewer has an "Open in full
  // editor" link for when they actually need to edit the profile.
  const [viewerProfileId, setViewerProfileId] = useState(null);

  function openSourceProfile(line) {
    if (!line?.source_charge_profile_id) return;
    setViewerProfileId(line.source_charge_profile_id);
  }

  async function recalcDriverPay() {
    setRecalcBusy(true);
    setError(null);
    setDiagnostic(null);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/recalculate-driver-pay`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Recalculate failed');
      setDiagnostic(body);
      setDiagOpen(true);
      await fetchLines();
    } catch (e) {
      setError(e.message);
    } finally {
      setRecalcBusy(false);
    }
  }

  const total = lines.reduce((sum, l) => sum + (l.amount_cents || 0), 0);
  const approvedTotal = lines
    .filter((l) => ['approved', 'reviewed', 'finalized'].includes(l.status))
    .reduce((sum, l) => sum + (l.amount_cents || 0), 0);

  return (
    <div className="space-y-4">
      {viewerProfileId && (
        <DriverChargeProfileViewer
          profileId={viewerProfileId}
          onClose={() => setViewerProfileId(null)}
        />
      )}

      {error && <Alert type="error" message={error} />}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SummaryCard label="Pay Lines" value={lines.length} icon={Wallet} color="blue" />
        <SummaryCard label="Approved" value={formatCents(approvedTotal)} icon={User} color="emerald" />
        <SummaryCard label="Total" value={formatCents(total)} icon={DollarSign} color="purple" />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={recalcDriverPay}
          disabled={recalcBusy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${recalcBusy ? 'animate-spin' : ''}`} />
          {recalcBusy ? 'Recalculating…' : 'Recalculate Driver Pay'}
        </button>
        <Button onClick={() => setShowForm((s) => !s)}>
          <Plus className="w-4 h-4 inline -mt-0.5 mr-1" />
          {showForm ? 'Cancel' : 'Add Pay Line'}
        </Button>
      </div>

      {/* Diagnostic panel — shown after a manual recalc. Lists each tariff
          the engine considered, with a pass/fail per check so the user can
          see exactly why matching succeeded or was rejected. Safe to leave
          mounted — it doesn't auto-populate. */}
      {diagnostic && (
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setDiagOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div className="flex items-center gap-2">
              {diagnostic.applied > 0 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <XCircle className="w-4 h-4 text-amber-500" />
              )}
              <span className="text-sm font-medium text-gray-900 dark:text-slate-100">
                {diagnostic.message || (diagnostic.applied > 0 ? `${diagnostic.applied} line(s) applied` : 'No match')}
              </span>
              {diagnostic.diagnostic && (
                <span className="text-xs text-gray-500 dark:text-slate-400">
                  · {diagnostic.diagnostic.tariffs_matched}/{diagnostic.diagnostic.tariffs_total} tariff(s) matched
                </span>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-slate-500 transition-transform ${diagOpen ? 'rotate-180' : ''}`} />
          </button>
          {diagOpen && diagnostic.diagnostic && (
            <div className="border-t border-gray-100 dark:border-slate-800 p-4 space-y-3 text-xs">
              {diagnostic.reason === 'no_driver' ? (
                <div className="text-amber-700 dark:text-amber-300">No driver assigned to this load. Assign a driver first, then recalculate.</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 text-gray-600 dark:text-slate-300">
                    <div>
                      <div className="font-semibold mb-1 text-gray-900 dark:text-slate-100">Load</div>
                      <div>Type: <span>{diagnostic.diagnostic.load.load_type || '(empty)'}</span></div>
                      <div>Pickup: <span>{diagnostic.diagnostic.load.pickup_location_name || diagnostic.diagnostic.load.pickup_location_id || '(empty)'}</span></div>
                      <div>Delivery: <span>{diagnostic.diagnostic.load.delivery_location_name || diagnostic.diagnostic.load.delivery_location_id || '(empty)'}</span></div>
                      <div>Return: <span>{diagnostic.diagnostic.load.return_location_name || diagnostic.diagnostic.load.return_location_id || '(empty)'}</span></div>
                      <div>Container: <span>{[diagnostic.diagnostic.load.container_size, diagnostic.diagnostic.load.container_type].filter(Boolean).join(' / ') || '(empty)'}</span></div>
                    </div>
                    <div>
                      <div className="font-semibold mb-1 text-gray-900 dark:text-slate-100">Driver groups</div>
                      <div>{diagnostic.diagnostic.driver_group_names.length > 0 ? diagnostic.diagnostic.driver_group_names.join(', ') : '(none — driver in no groups)'}</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {diagnostic.diagnostic.tariffs.map((t) => (
                      <div key={t.id} className={`rounded-lg border p-2 ${t.matched ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40'}`}>
                        <div className="flex items-center gap-2 font-medium">
                          {t.matched ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-gray-400" />}
                          <span className="text-gray-900 dark:text-slate-100">{t.name}</span>
                          <span className="text-gray-500 dark:text-slate-400">· status: {t.status} · priority: {t.priority}</span>
                        </div>
                        <div className="mt-1.5 pl-5 space-y-0.5 text-gray-600 dark:text-slate-300">
                          {t.checks.map((c, i) => (
                            <div key={i} className={c.pass ? '' : 'text-red-600 dark:text-red-400'}>
                              {c.pass ? '✓' : '✗'} {c.check}{c.detail ? ` — ${c.detail}` : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* New line form */}
      {showForm && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/40 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <DriverPicker
              label="Driver"
              value={draft.driver_id}
              onChange={(v) => setDraft({ ...draft, driver_id: v })}
            />
            <Select
              label="Type"
              value={draft.line_type}
              onChange={(e) => setDraft({ ...draft, line_type: e.target.value })}
              options={LINE_TYPES}
            />
            <OrgPicker
              label="From"
              value={null}
              valueLabel={draft.from_location_label}
              onChange={(org) => setDraft({ ...draft, from_location: org?.name || '', from_location_label: org?.name || '' })}
              placeholder="Select origin..."
            />
            <OrgPicker
              label="To"
              value={null}
              valueLabel={draft.to_location_label}
              onChange={(org) => setDraft({ ...draft, to_location: org?.name || '', to_location_label: org?.name || '' })}
              placeholder="Select destination..."
            />
            <CurrencyInput
              label="Amount"
              valueCents={draft.amount_cents}
              onChangeCents={(v) => setDraft({ ...draft, amount_cents: v })}
              required
            />
            <Input
              label="Hours"
              type="number"
              value={draft.hours}
              onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
            />
            <Input
              label="Miles"
              type="number"
              value={draft.miles}
              onChange={(e) => setDraft({ ...draft, miles: e.target.value })}
            />
            <Input
              label="Description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <DateTimePicker
              label="Date & Time"
              value={draft.worked_at}
              onChange={(v) => setDraft({ ...draft, worked_at: v })}
              showTime
            />
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} loading={saving}>
              Add Line
            </Button>
          </div>
        </div>
      )}

      {/* Lines table */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900 text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Driver</th>
                <th className="text-left px-4 py-2">Type</th>
                <th className="text-left px-4 py-2">From → To</th>
                <th className="text-right px-4 py-2">Amount</th>
                <th className="text-right px-4 py-2">Hours</th>
                <th className="text-right px-4 py-2">Miles</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="w-32 px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : lines.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
                    No pay lines yet. Click "Add Pay Line" to get started.
                  </td>
                </tr>
              ) : (
                lines.map((l) => {
                  const driverName =
                    [l.driver?.first_name, l.driver?.last_name].filter(Boolean).join(' ') ||
                    l.driver?.name ||
                    '—';
                  const nextLabel = STATUS_NEXT_LABEL[l.status];
                  return (
                    <EditablePayRow
                      key={l.id}
                      line={l}
                      driverName={driverName}
                      nextLabel={nextLabel}
                      onUpdate={(patch) => updateLine(l.id, patch)}
                      onAdvance={() => advanceStatus(l)}
                      onDelete={() => deleteLine(l.id)}
                      formatCents={formatCents}
                      onOpenSource={openSourceProfile}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, color }) {
  const colors = {
    blue: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400',
    purple: 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400',
  };
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="flex items-start gap-2">
        <div className={`rounded-lg p-1.5 ${colors[color]}`}>
          <Icon className="w-4 h-4" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
          <div className="text-lg font-semibold text-gray-900 dark:text-slate-100">{value}</div>
        </div>
      </div>
    </div>
  );
}

const STATUS_STYLES_ROW = {
  drafted: 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300',
  unapproved: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  approved: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
  reviewed: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300',
  finalized: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300',
};

function EditablePayRow({ line, driverName, nextLabel, onUpdate, onAdvance, onDelete, formatCents, onOpenSource }) {
  // source_type comes from migration 073. Falls back to the old [auto-applied]
  // notes marker so rows created before the migration (no source_type column
  // populated) still show as auto.
  const isAuto =
    !!line.source_type ||
    (line.notes && line.notes.startsWith('[auto-applied]'));
  const canOpenSource = isAuto && !!line.source_charge_profile_id;
  const sourceTitle = (() => {
    if (!isAuto) return 'Manually added';
    const parts = ['Auto-applied'];
    if (line.source_charge_profile?.name) parts.push(`from ${line.source_charge_profile.name}`);
    if (line.source_tariff?.name) parts.push(`via ${line.source_tariff.name}`);
    if (canOpenSource) parts.push('— click to open charge profile');
    return parts.join(' ');
  })();
  const [editField, setEditField] = useState(null);
  const [editValue, setEditValue] = useState('');

  function startEdit(field, value) {
    setEditField(field);
    setEditValue(value ?? '');
  }

  function saveEdit(field) {
    setEditField(null);
    let newVal = editValue;
    if (field === 'amount_cents') {
      newVal = Math.round(parseFloat(newVal || 0) * 100);
    } else if (field === 'hours' || field === 'miles') {
      newVal = newVal === '' ? null : parseFloat(newVal);
    }
    onUpdate({ [field]: newVal });
  }

  function renderCell(field, display, align = 'left', cls = '') {
    const raw = field === 'amount_cents' ? ((line[field] || 0) / 100).toFixed(2) : line[field];
    if (editField === field) {
      return (
        <td className={`px-2 py-1 ${align === 'right' ? 'text-right' : ''}`}>
          <input
            type={['amount_cents', 'hours', 'miles'].includes(field) ? 'number' : 'text'}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => saveEdit(field)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(field); if (e.key === 'Escape') setEditField(null); }}
            autoFocus
            step={field === 'amount_cents' ? '0.01' : undefined}
            className="w-full rounded border border-blue-300 dark:border-blue-800 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
          />
        </td>
      );
    }
    return (
      <td
        className={`px-4 py-2 ${align === 'right' ? 'text-right' : ''} ${cls} cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/40`}
        onClick={() => startEdit(field, raw)}
      >
        {display}
      </td>
    );
  }

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-slate-800 group">
      <td className="px-4 py-2 font-medium text-gray-900 dark:text-slate-100">
        <div className="flex items-center gap-2">
          {/* Source marker — auto (sparkles, clickable when profile id present)
              or manual (hand, informational only). The icon + title provide a
              quick "where did this line come from" signal, and for auto rows
              the sparkles icon doubles as a link into the originating profile. */}
          {isAuto ? (
            canOpenSource ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenSource?.(line); }}
                title={sourceTitle}
                className="inline-flex items-center justify-center rounded-md p-0.5 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
            ) : (
              <span title={sourceTitle} className="text-blue-500 dark:text-blue-400">
                <Sparkles className="w-3.5 h-3.5" />
              </span>
            )
          ) : (
            <span title={sourceTitle} className="text-gray-400 dark:text-slate-500">
              <Hand className="w-3.5 h-3.5" />
            </span>
          )}
          <span>{driverName}</span>
          {canOpenSource && (
            <ExternalLink className="w-3 h-3 text-gray-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      </td>
      <td className="px-4 py-2 text-xs text-gray-600 dark:text-slate-300 capitalize">
        {(line.line_type || 'line_haul').replace(/_/g, ' ')}
      </td>
      {renderCell('from_location',
        <span className="text-xs text-gray-600 dark:text-slate-300">
          {line.from_location || '—'}
          {line.to_location && <><span className="text-gray-400 dark:text-slate-500 mx-1">→</span>{line.to_location}</>}
        </span>
      )}
      {renderCell('amount_cents', formatCents(line.amount_cents), 'right', 'font-semibold text-gray-900 dark:text-slate-100')}
      {renderCell('hours', line.hours ?? '—', 'right', 'text-xs text-gray-600 dark:text-slate-300')}
      {renderCell('miles', line.miles ?? '—', 'right', 'text-xs text-gray-600 dark:text-slate-300')}
      <td className="px-4 py-2">
        <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES_ROW[line.status] || STATUS_STYLES_ROW.drafted}`}>
          {line.status}
        </span>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1 justify-end">
          {nextLabel && (
            <button onClick={onAdvance} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-2 py-1">
              {nextLabel}
            </button>
          )}
          <button onClick={onDelete} className="text-gray-300 dark:text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
