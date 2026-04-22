import { useEffect, useState, useCallback, useRef } from 'react';
import { X, AlertTriangle } from 'lucide-react';

function formatCents(n) {
  if (!Number.isFinite(n)) return '$0.00';
  return '$' + (n / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function Field({ label, children, hint }) {
  return (
    <label className="block mb-3">
      <span className="block text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 dark:text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export default function DryRunSlideOver({
  open,
  onClose,
  onSaved,
  orderId,
  event,        // { id, event_type, location_label, distance_miles }
  drivers,      // [{ id, name }]
  existing,     // full dry_run_attempts row OR null for "create" mode
}) {
  const isEdit = !!existing;

  const [driverId, setDriverId] = useState(existing?.driver_id || '');
  const [occurredAt, setOccurredAt] = useState(
    existing?.occurred_at?.slice(0, 16) || new Date().toISOString().slice(0, 16)
  );
  const [rateSource, setRateSource] = useState(existing?.rate_source || 'manual');
  const [chargeProfileId, setChargeProfileId] = useState(existing?.charge_profile_id || '');
  const [driverChargeProfileId, setDriverChargeProfileId] = useState(existing?.driver_charge_profile_id || '');
  const [rateMethod, setRateMethod] = useState(existing?.rate_method || 'per_mile');
  const [miles, setMiles] = useState(existing?.miles ?? event?.distance_miles ?? '');
  const [arAmount, setArAmount] = useState(existing ? existing.ar_amount_cents / 100 : '');
  const [apAmount, setApAmount] = useState(existing ? existing.ap_amount_cents / 100 : '');
  const [arRate, setArRate] = useState('');
  const [apRate, setApRate] = useState('');
  const [notes, setNotes] = useState(existing?.notes || '');

  const [arProfiles, setArProfiles] = useState([]);
  const [apProfiles, setApProfiles] = useState([]);
  const [previewAr, setPreviewAr] = useState(existing?.ar_amount_cents || 0);
  const [previewAp, setPreviewAp] = useState(existing?.ap_amount_cents || 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Fetch preset profiles on open
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [arRes, apRes] = await Promise.all([
          fetch('/api/tenant/charge-profiles?is_dry_run=true').then((r) => r.json()),
          fetch('/api/tenant/ap/charge-profiles?is_dry_run=true').then((r) => r.json()),
        ]);
        setArProfiles(arRes?.profiles || []);
        setApProfiles(apRes?.profiles || []);
      } catch {
        // Non-fatal — user can still use Manual
      }
    })();
  }, [open]);

  // Live preview (debounced)
  const previewTimer = useRef(null);
  const refreshPreview = useCallback(() => {
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        const body = {
          rate_source: rateSource,
          rate_method: rateMethod,
          miles: rateMethod === 'per_mile' ? Number(miles) || null : null,
          charge_profile_id: chargeProfileId || null,
          driver_charge_profile_id: driverChargeProfileId || null,
          ar_amount_cents: rateMethod === 'fixed' ? Math.round(Number(arAmount || 0) * 100) : 0,
          ap_amount_cents: rateMethod === 'fixed' ? Math.round(Number(apAmount || 0) * 100) : 0,
          ar_rate_cents_per_mile: rateMethod === 'per_mile' ? Math.round(Number(arRate || 0) * 100) : 0,
          ap_rate_cents_per_mile: rateMethod === 'per_mile' ? Math.round(Number(apRate || 0) * 100) : 0,
        };
        const res = await fetch(`/api/tenant/loads/${orderId}/dry-runs/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (res.ok) {
          setPreviewAr(data.ar_amount_cents || 0);
          setPreviewAp(data.ap_amount_cents || 0);
        }
      } catch {}
    }, 250);
  }, [orderId, rateSource, rateMethod, miles, chargeProfileId, driverChargeProfileId, arAmount, apAmount, arRate, apRate]);

  useEffect(() => { if (open) refreshPreview(); }, [open, refreshPreview]);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        event_id: event.id,
        driver_id: driverId,
        occurred_at: new Date(occurredAt).toISOString(),
        rate_source: rateSource,
        charge_profile_id: rateSource === 'preset' ? chargeProfileId : null,
        driver_charge_profile_id: rateSource === 'preset' ? driverChargeProfileId : null,
        rate_method: rateMethod,
        miles: rateMethod === 'per_mile' ? Number(miles) : null,
        ar_amount_cents: rateMethod === 'fixed' ? Math.round(Number(arAmount) * 100) : 0,
        ap_amount_cents: rateMethod === 'fixed' ? Math.round(Number(apAmount) * 100) : 0,
        ar_rate_cents_per_mile: rateMethod === 'per_mile' ? Math.round(Number(arRate) * 100) : 0,
        ap_rate_cents_per_mile: rateMethod === 'per_mile' ? Math.round(Number(apRate) * 100) : 0,
        notes: notes || null,
      };
      const url = isEdit
        ? `/api/tenant/loads/${orderId}/dry-runs/${existing.id}`
        : `/api/tenant/loads/${orderId}/dry-runs`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Save failed');
      }
      const data = await res.json();
      onSaved?.(data.dry_run);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div
        className="fixed top-0 right-0 bottom-0 z-50 bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-800 shadow-xl overflow-y-auto"
        style={{ width: 'min(520px, 100%)' }}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold">
              <AlertTriangle className="w-4 h-4" />
              {isEdit ? 'Edit Dry Run' : 'Add Dry Run'}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {event?.event_type?.replace(/_/g, ' ')} · {event?.location_label || 'no location'}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          {error && (
            <div className="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-2">
            What happened
          </div>

          <Field label="Driver">
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
            >
              <option value="">Select driver...</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>

          <Field label="Occurred at">
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
            />
          </Field>

          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mt-4 mb-2">
            Rate
          </div>

          <Field label="Source">
            <select
              value={rateSource}
              onChange={(e) => setRateSource(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
            >
              <option value="manual">Manual</option>
              <option value="preset" disabled={arProfiles.length === 0 || apProfiles.length === 0}>
                Preset profile {(arProfiles.length === 0 || apProfiles.length === 0) ? '(none configured)' : ''}
              </option>
            </select>
          </Field>

          {rateSource === 'preset' && (
            <>
              <Field label="AR Profile">
                <select
                  value={chargeProfileId}
                  onChange={(e) => setChargeProfileId(e.target.value)}
                  className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <option value="">Select AR profile...</option>
                  {arProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="AP Profile (driver pay)">
                <select
                  value={driverChargeProfileId}
                  onChange={(e) => setDriverChargeProfileId(e.target.value)}
                  className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <option value="">Select AP profile...</option>
                  {apProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            </>
          )}

          <Field label="Method">
            <div className="flex gap-2">
              {['per_mile', 'fixed'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRateMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    rateMethod === m
                      ? 'bg-blue-600 dark:bg-blue-500 text-white border-blue-600 dark:border-blue-500'
                      : 'bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300 border-gray-300 dark:border-slate-600'
                  }`}
                >
                  {m === 'per_mile' ? 'Per Mile' : 'Fixed'}
                </button>
              ))}
            </div>
          </Field>

          {rateMethod === 'per_mile' && (
            <Field label="Miles" hint={event?.distance_miles ? `Pre-filled from leg distance (${event.distance_miles} mi)` : 'Enter miles driven'}>
              <input
                type="number"
                step="0.1"
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
              />
            </Field>
          )}

          {rateSource === 'manual' && rateMethod === 'per_mile' && (
            <>
              <Field label="AR rate (per mile)">
                <input type="number" step="0.01" value={arRate} onChange={(e) => setArRate(e.target.value)} placeholder="e.g. 2.50" className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm" />
              </Field>
              <Field label="AP rate (per mile)">
                <input type="number" step="0.01" value={apRate} onChange={(e) => setApRate(e.target.value)} placeholder="e.g. 1.50" className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm" />
              </Field>
            </>
          )}

          {rateSource === 'manual' && rateMethod === 'fixed' && (
            <>
              <Field label="AR amount ($)">
                <input type="number" step="0.01" value={arAmount} onChange={(e) => setArAmount(e.target.value)} className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm" />
              </Field>
              <Field label="AP amount ($)">
                <input type="number" step="0.01" value={apAmount} onChange={(e) => setApAmount(e.target.value)} className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm" />
              </Field>
            </>
          )}

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Container not released, yard closed, etc."
              className="w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm"
            />
          </Field>

          <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-400">Preview</span>
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
              {formatCents(previewAr)} AR · {formatCents(previewAp)} AP
            </span>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !driverId}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Dry Run'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
