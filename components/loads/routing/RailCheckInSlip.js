import { useMemo, useState } from 'react';
import {
  Train,
  Anchor,
  Container,
  Lock,
  Hash,
  Package,
  Scale,
  MapPin,
  FileCheck,
  CheckCircle2,
  Eye,
  Send,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import RailSlipPreviewModal from './RailSlipPreviewModal';

/**
 * RailCheckInSlip — the dispatcher's verification card for the
 * Rail/Port Check-In Slip on Outbound and Export loads.
 *
 * ## Workflow
 *
 *   1. Dispatcher creates an Outbound/Export load with prenote values
 *      from the broker (container #, seal #, weight, piece count,
 *      reference #, final destination).
 *   2. Driver picks up the loaded container at the shipper.
 *   3. Driver uploads the BOL document via mobile app.
 *   4. Dispatcher pulls up this card, compares each field on the
 *      slip to the BOL, and clicks "Cleared for Rail/Port Check-In"
 *      to mark the slip as verified.
 *   5. Once cleared, the driver gets the verified slip on their
 *      mobile and can drive to the rail/port with confidence.
 *
 * ## State machine
 *
 *   STATE_INCOMPLETE   — One or more of the 6 slip fields is blank.
 *                        Verify button disabled. Each missing field
 *                        shown with an amber warning.
 *
 *   STATE_NO_BOL       — All fields populated, but the driver hasn't
 *                        uploaded a BOL yet. Verify button disabled
 *                        with "Awaiting BOL upload" message.
 *
 *   STATE_PENDING      — All fields populated, BOL uploaded, slip is
 *                        NOT yet verified. Verify button enabled.
 *
 *   STATE_VERIFIED     — Slip is verified. Card shows green confirmation
 *                        with timestamp + dispatcher name. Verify button
 *                        replaced with "Re-verify" / "Unverify".
 *
 * ## Auto-unverify
 *
 * If the dispatcher edits ANY of the 6 slip fields after verification,
 * the backend auto-clears `rail_slip_verified_at` (see the loads PUT
 * handler in pages/api/tenant/loads/[id]/index.js). The card detects
 * this and falls back to STATE_PENDING.
 */

const SLIP_FIELDS = [
  {
    key: 'container_number',
    label: 'Container #',
    Icon: Container,
    format: (v) => v,
  },
  {
    key: 'seal_number',
    label: 'Seal #',
    Icon: Lock,
    format: (v) => v,
  },
  {
    key: 'final_delivery',
    label: 'Final Destination',
    Icon: MapPin,
    format: (load) => {
      const org = load.final_delivery_org;
      if (!org) return null;
      const loc = [org.city, org.state].filter(Boolean).join(', ');
      return loc ? `${org.name} — ${loc}` : org.name;
    },
    isComputed: true,
  },
  {
    key: 'piece_count',
    label: 'Piece Count',
    Icon: Package,
    format: (v) => (v != null ? `${v} pieces` : null),
  },
  {
    key: 'weight_lbs',
    label: 'Weight',
    Icon: Scale,
    format: (v) => (v != null ? `${v.toLocaleString()} lbs` : null),
  },
  {
    key: 'customer_reference',
    label: 'Reference #',
    Icon: Hash,
    format: (v) => v,
  },
];

function fieldValue(load, field) {
  if (field.isComputed) return field.format(load);
  return field.format(load[field.key]);
}

function fieldIsPresent(load, field) {
  if (field.key === 'final_delivery') return !!load.final_delivery_location_id;
  return load[field.key] != null && load[field.key] !== '';
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function RailCheckInSlip({ load, hasBolDocument = false, onVerifyChange }) {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // IMPORTANT: all hooks must be called unconditionally on every render
  // (React rules-of-hooks). The "is this slip even needed?" check must
  // therefore happen AFTER every hook call, as an early return at the
  // render stage — not before the hooks. Otherwise switching a load's
  // load_type would change the hook count and crash React.
  const fieldStatus = useMemo(
    () =>
      load
        ? SLIP_FIELDS.map((f) => ({ field: f, present: fieldIsPresent(load, f) }))
        : [],
    [load]
  );

  // Only Outbound and Export loads need the slip — anything else skips render
  if (!load || !['outbound', 'export'].includes(load.load_type)) return null;

  const isExport = load.load_type === 'export';
  const checkInLabel = isExport ? 'Port Check-In' : 'Rail Check-In';
  const venueLabel = isExport ? 'port' : 'rail';
  const VenueIcon = isExport ? Anchor : Train;

  // Derive state from the memoized field status
  const missingFields = fieldStatus.filter((s) => !s.present);
  const allFieldsPresent = missingFields.length === 0;
  const isVerified = !!load.rail_slip_verified_at;

  let state;
  if (isVerified) state = 'VERIFIED';
  else if (!allFieldsPresent) state = 'INCOMPLETE';
  else if (!hasBolDocument) state = 'NO_BOL';
  else state = 'PENDING';

  async function handleVerify() {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_rail_slip' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to verify slip');
      }
      onVerifyChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleUnverify() {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unverify_rail_slip' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to unverify slip');
      }
      onVerifyChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setVerifying(false);
    }
  }

  // Card outer styling depends on state
  const cardClasses = {
    VERIFIED: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-950/30',
    PENDING: 'border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/30',
    NO_BOL: 'border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-950/30',
    INCOMPLETE: 'border-gray-300 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900',
  }[state];

  return (
    <>
      <div className={`rounded-xl border-2 ${cardClasses} overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-slate-700 bg-white/40 dark:bg-slate-900/40">
          <div className="shrink-0 w-10 h-10 rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 flex items-center justify-center">
            <VenueIcon className="w-5 h-5 text-gray-700 dark:text-slate-200" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              {checkInLabel} Slip
            </div>
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              Driver hands this info to the {venueLabel} clerk at check-in
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            title="See exactly what the driver will see in their mobile app"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview as Driver
          </button>
        </div>

        {/* Field grid */}
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fieldStatus.map(({ field, present }) => {
            const value = fieldValue(load, field);
            const Icon = field.Icon;
            return (
              <div
                key={field.key}
                className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border ${
                  present
                    ? 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                    : 'border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/40'
                }`}
              >
                <Icon
                  className={`w-4 h-4 mt-0.5 shrink-0 ${
                    present
                      ? 'text-gray-400 dark:text-slate-500'
                      : 'text-amber-500 dark:text-amber-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                    {field.label}
                  </div>
                  {present ? (
                    <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">
                      {value}
                    </div>
                  ) : (
                    <div className="text-xs italic text-amber-700 dark:text-amber-300">
                      Not yet entered
                    </div>
                  )}
                </div>
                {present && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                )}
              </div>
            );
          })}
        </div>

        {/* BOL status row */}
        <div className="px-5 pb-3">
          <div
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${
              hasBolDocument
                ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/40'
                : 'border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/40'
            }`}
          >
            <FileCheck
              className={`w-4 h-4 shrink-0 ${
                hasBolDocument
                  ? 'text-emerald-500 dark:text-emerald-400'
                  : 'text-amber-500 dark:text-amber-400'
              }`}
            />
            <div className="flex-1 text-xs">
              {hasBolDocument ? (
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                  BOL document uploaded — ready to compare against prenote values
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">
                  <span className="font-semibold">BOL not yet uploaded</span>
                  &nbsp;— driver must upload the BOL before the slip can be verified.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Verification status + action */}
        <div className="px-5 pb-5 pt-1">
          {state === 'VERIFIED' && (
            <div className="rounded-lg bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 px-4 py-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    Cleared for {checkInLabel}
                  </div>
                  <div className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
                    Verified at {formatTime(load.rail_slip_verified_at)}
                    {load.verified_by_user?.name && ` by ${load.verified_by_user.name}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleUnverify}
                  disabled={verifying}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Unverify
                </button>
              </div>
            </div>
          )}

          {state === 'PENDING' && (
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-sm"
            >
              <CheckCircle2 className="w-5 h-5" strokeWidth={2.5} />
              {verifying ? 'Verifying…' : `Cleared for ${checkInLabel}`}
            </button>
          )}

          {state === 'NO_BOL' && (
            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-700 cursor-not-allowed"
              title="Driver must upload the BOL document before the slip can be verified."
            >
              <FileCheck className="w-5 h-5" />
              Awaiting BOL upload
            </button>
          )}

          {state === 'INCOMPLETE' && (
            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 cursor-not-allowed"
              title={`Missing: ${missingFields
                .map((s) => s.field.label)
                .join(', ')}`}
            >
              <AlertTriangle className="w-5 h-5" />
              Fill in {missingFields.length} missing field
              {missingFields.length === 1 ? '' : 's'} to enable verification
            </button>
          )}

          {error && (
            <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-700 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Preview as Driver modal */}
      {previewOpen && (
        <RailSlipPreviewModal
          load={load}
          isExport={isExport}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}
