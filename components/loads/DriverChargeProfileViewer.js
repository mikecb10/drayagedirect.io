import { useEffect, useState } from 'react';
import { Sparkles, ExternalLink, X, Info } from 'lucide-react';

/**
 * DriverChargeProfileViewer
 *
 * Read-only summary modal for a driver charge profile. Opens inline on a load
 * when the user clicks the ✨ sparkles icon on an auto-applied pay line, so
 * dispatchers can confirm "yes, this is the correct rate" without leaving the
 * load or seeing the full editor form.
 *
 * Intentionally skips the heavy edit form. Shows:
 *   - Header: name + charge name + driver group
 *   - Setup grid: UOM, calculation mode, effective basis, auto-add flag
 *   - Amount tile: amount, minimum, free units (from the first tier)
 *   - Percentage block: what the percentage is based on (if UOM = percentage)
 *   - Mode-specific block: event / move / leg / between_statuses specifics
 *
 * If the user needs to actually edit the profile there's a link at the footer
 * that opens the full editor in a new tab.
 */

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CALC_MODE_LABEL = {
  by_event: 'By Event',
  by_move: 'By Move',
  by_leg: 'By Leg',
  between_statuses: 'Between Statuses',
};

const UOM_LABEL = {
  fixed: 'Fixed',
  percentage: 'Percentage',
  per_day: 'Per Day',
  per_hour: 'Per Hour',
  per_15min: 'Per 15 Min',
  per_30min: 'Per 30 Min',
  per_45min: 'Per 45 Min',
  per_pounds: 'Per Pound',
  per_miles: 'Per Mile',
  per_road_toll_miles: 'Per Road Toll Mile',
  radius_rate: 'Radius Rate',
};

const PERCENTAGE_BASED_ON_LABEL = {
  driver_pay: 'Driver Pay (base pay on load)',
  ar_invoice: 'Invoice / AR Line Items (customer charge)',
  oo_benchmark: 'Expected O/O Pay (benchmark)',
};

export default function DriverChargeProfileViewer({ profileId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tenant/ap/charge-profiles/${profileId}`);
        if (!res.ok) throw new Error('Failed to load charge profile');
        const body = await res.json();
        if (!cancelled) setProfile(body.profile || null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    function onEsc(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onEsc);
    return () => {
      cancelled = true;
      document.removeEventListener('keydown', onEsc);
    };
  }, [profileId, onClose]);

  if (!profileId) return null;

  const version = profile?.versions?.[0];
  const tier = version?.tiers?.[0];
  const editorUrl = `/drivers?tab=pay_rates&subtab=charge_profiles&profile_id=${profileId}`;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 dark:bg-black/70 py-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl mx-4 rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-transparent dark:border-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-800">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 p-2">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">Charge Profile</div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 truncate">
                {profile?.name || (loading ? 'Loading…' : 'Unknown profile')}
              </h3>
              {profile?.charge_name && (
                <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                  Charge code: <span className="text-gray-700 dark:text-slate-200">{profile.charge_name}</span>
                  {profile.driver_group?.name && <> · Driver group: <span className="text-gray-700 dark:text-slate-200">{profile.driver_group.name}</span></>}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-sm">
          {loading && <div className="text-gray-400 dark:text-slate-500 text-center py-6">Loading…</div>}
          {error && <div className="text-red-600 dark:text-red-400">{error}</div>}

          {profile && (
            <>
              {/* Setup grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Unit of Measure" value={UOM_LABEL[profile.unit_of_measure] || profile.unit_of_measure} />
                <Field label="Calculation Mode" value={CALC_MODE_LABEL[profile.calculation_mode] || profile.calculation_mode} />
                <Field label="Effective Basis" value={(profile.effective_date_basis || 'Current Date').replace(/_/g, ' ')} />
                <Field label="Auto Add to Load" value={profile.auto_add ? 'Yes' : 'No'} />
              </div>

              {/* Amount block */}
              <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40 p-4">
                <div className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-2">
                  Pay Amounts {version?.label ? <span className="normal-case text-gray-400 dark:text-slate-500">· {version.label}</span> : null}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field
                    label={profile.unit_of_measure === 'percentage' ? 'Percentage' : 'Amount'}
                    value={profile.unit_of_measure === 'percentage'
                      ? `${((tier?.amount_cents || 0) / 100).toFixed(2)}%`
                      : formatCents(tier?.amount_cents)}
                    emphasis
                  />
                  <Field label="Minimum" value={formatCents(tier?.minimum_amount_cents)} />
                  <Field label="Free Units" value={tier?.free_units ?? '0'} />
                </div>
                {(version?.effective_from || version?.effective_to) && (
                  <div className="mt-3 text-xs text-gray-500 dark:text-slate-400">
                    Effective: {version.effective_from || '—'} → {version.effective_to || '—'}
                  </div>
                )}
              </div>

              {/* Percentage details */}
              {profile.unit_of_measure === 'percentage' && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 p-4">
                  <div className="text-xs uppercase tracking-wide font-semibold text-blue-600 dark:text-blue-400 mb-2">Percentage Based On</div>
                  <div className="text-gray-800 dark:text-slate-200">
                    {PERCENTAGE_BASED_ON_LABEL[profile.percentage_based_on] || profile.percentage_based_on || '(not set)'}
                  </div>
                  {profile.percentage_charge_code && (
                    <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                      Based on charge code: <span className="text-gray-700 dark:text-slate-200">{profile.percentage_charge_code}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Mode-specific details */}
              <ModeDetails profile={profile} tier={tier} />

              {profile.description && (
                <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 text-gray-700 dark:text-slate-200">
                  <div className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1">Description</div>
                  {profile.description}
                </div>
              )}

              {(profile.conditions?.length || 0) > 0 ? (
                <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
                  <div className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-2">Conditions</div>
                  <div className="text-xs text-gray-600 dark:text-slate-400">{profile.conditions.length} rule(s) configured — see full editor for details.</div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-800/30 p-3 text-xs text-gray-500 dark:text-slate-400">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>No conditions — this charge profile applies to all matching loads.</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40 rounded-b-xl">
          <a
            href={editorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          >
            Open in full editor
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, emphasis = false }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">{label}</div>
      <div className={`mt-0.5 ${emphasis ? 'text-base font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-800 dark:text-slate-200'}`}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function ModeDetails({ profile, tier }) {
  if (!tier) return null;

  if (profile.calculation_mode === 'by_event') {
    const loc = tier.event_location_value || tier.event_location_type || tier.event_location_id;
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
        <div className="text-xs uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-400 mb-2">By Event Trigger</div>
        <div className="text-gray-800 dark:text-slate-200">
          {tier.event_type ? <><strong>{tier.event_type.replace(/_/g, ' ')}</strong></> : '(event not set)'}
          {loc && <> at <span className="text-gray-600 dark:text-slate-300">{loc}</span></>}
        </div>
      </div>
    );
  }

  if (profile.calculation_mode === 'by_move') {
    const events = tier.move_events || [];
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
        <div className="text-xs uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-400 mb-2">By Move ({events.length} event{events.length !== 1 ? 's' : ''})</div>
        <ol className="list-decimal ml-5 space-y-1 text-gray-800 dark:text-slate-200">
          {events.map((e, i) => (
            <li key={i}>
              {e.event_type?.replace(/_/g, ' ') || '(unset)'} {e.location?.label ? <span className="text-gray-600 dark:text-slate-300">— {e.location.label}</span> : null}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (profile.calculation_mode === 'by_leg') {
    const fromTypes = tier.leg_from_types || (tier.leg_from ? [tier.leg_from] : []);
    const toTypes = tier.leg_to_types || (tier.leg_to ? [tier.leg_to] : []);
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-2">
        <div className="text-xs uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-400">By Leg</div>
        <div className="text-gray-800 dark:text-slate-200">
          <span className="font-medium">From:</span> {fromTypes.length ? fromTypes.map((t) => t.replace(/_/g, ' ')).join(', ') : '(unset)'}
          {tier.leg_from_location_value && <span className="text-gray-600 dark:text-slate-300"> @ {tier.leg_from_location_value}</span>}
        </div>
        <div className="text-gray-800 dark:text-slate-200">
          <span className="font-medium">To:</span> {toTypes.length ? toTypes.map((t) => t.replace(/_/g, ' ')).join(', ') : '(unset)'}
          {tier.leg_to_location_value && <span className="text-gray-600 dark:text-slate-300"> @ {tier.leg_to_location_value}</span>}
        </div>
      </div>
    );
  }

  if (profile.calculation_mode === 'between_statuses') {
    return (
      <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
        <div className="text-xs uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-400 mb-2">Between Statuses</div>
        <div className="text-gray-800 dark:text-slate-200">
          <span className="font-medium">{tier.status_from?.replace(/_/g, ' ') || '(unset)'}</span>
          {' → '}
          <span className="font-medium">{tier.status_to?.replace(/_/g, ' ') || '(unset)'}</span>
        </div>
      </div>
    );
  }

  return null;
}
