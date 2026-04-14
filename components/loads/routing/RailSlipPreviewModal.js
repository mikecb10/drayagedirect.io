import { useEffect } from 'react';
import {
  X,
  Train,
  Anchor,
  Container,
  Lock,
  Hash,
  Package,
  Scale,
  MapPin,
  CheckCircle2,
  Clock,
} from 'lucide-react';

/**
 * RailSlipPreviewModal — shows the dispatcher exactly what the driver
 * will see in their mobile app for the Rail/Port Check-In Slip.
 *
 * Rendered as a phone-sized portrait card centered on a backdrop.
 * Read-only — this is just a preview. The driver's actual mobile UI
 * will look like this and consume the same data via
 * GET /api/driver/loads/[id]/rail-slip.
 *
 * The styling here is intentionally simple + high-contrast because
 * drivers will be reading these fields out loud at a noisy rail/port
 * check-in window. Big text, clear labels, no decoration.
 */

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

function Field({ Icon, label, value, mono = false }) {
  return (
    <div className="px-5 py-3 border-b border-slate-700 last:border-b-0">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div
        className={`text-2xl font-bold text-white leading-tight ${
          mono ? 'font-mono tracking-tight' : ''
        }`}
      >
        {value || <span className="text-slate-600 italic text-base">— not set —</span>}
      </div>
    </div>
  );
}

export default function RailSlipPreviewModal({ load, isExport, onClose }) {
  const checkInLabel = isExport ? 'Port Check-In' : 'Rail Check-In';
  const venueIcon = isExport ? Anchor : Train;
  const VenueIcon = venueIcon;
  const verified = !!load.rail_slip_verified_at;
  const fd = load.final_delivery_org;
  const finalDestStr = fd
    ? [fd.name, [fd.city, fd.state].filter(Boolean).join(', ')]
        .filter(Boolean)
        .join(' — ')
    : null;

  // Close on Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Helper text above the phone */}
        <div className="text-center mb-4">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
            Preview as Driver
          </div>
          <div className="text-sm text-slate-300 mt-0.5">
            What {load.driver?.first_name || 'the driver'} will see in their mobile app
          </div>
        </div>

        {/* Phone frame */}
        <div className="relative w-full rounded-[2rem] border-[10px] border-slate-900 bg-slate-950 shadow-2xl overflow-hidden">
          {/* Phone status bar */}
          <div className="bg-slate-950 text-white text-[10px] flex items-center justify-between px-6 py-2">
            <span className="font-semibold">9:41</span>
            <div className="w-20 h-3 bg-slate-900 rounded-full" />
            <span className="font-semibold">100%</span>
          </div>

          {/* App header */}
          <div className="bg-blue-600 px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <VenueIcon className="w-6 h-6" strokeWidth={2} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider opacity-80">
                  {checkInLabel} Slip
                </div>
                <div className="text-base font-bold truncate">{load.order_number}</div>
              </div>
            </div>
          </div>

          {/* Verification banner */}
          {verified ? (
            <div className="bg-emerald-600 px-5 py-3 text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" strokeWidth={2.5} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold">CLEARED FOR {checkInLabel.toUpperCase()}</div>
                <div className="text-[10px] opacity-90 truncate">
                  Verified {formatTime(load.rail_slip_verified_at)}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-amber-600 px-5 py-3 text-white flex items-center gap-2">
              <Clock className="w-5 h-5 shrink-0" strokeWidth={2.5} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold">AWAITING DISPATCHER VERIFICATION</div>
                <div className="text-[10px] opacity-90">
                  Do not check in until cleared
                </div>
              </div>
            </div>
          )}

          {/* Slip fields */}
          <div className="bg-slate-900">
            <Field
              Icon={Container}
              label="Container Number"
              value={load.container_number}
              mono
            />
            <Field
              Icon={Lock}
              label="Seal Number"
              value={load.seal_number}
              mono
            />
            <Field
              Icon={MapPin}
              label="Final Destination"
              value={finalDestStr}
            />
            <Field
              Icon={Package}
              label="Piece Count"
              value={load.piece_count != null ? `${load.piece_count}` : null}
            />
            <Field
              Icon={Scale}
              label="Weight"
              value={
                load.weight_lbs != null
                  ? `${load.weight_lbs.toLocaleString()} lbs`
                  : null
              }
            />
            <Field
              Icon={Hash}
              label="Reference Number"
              value={load.customer_reference}
              mono
            />
          </div>

          {/* Footer */}
          <div className="bg-slate-950 px-5 py-3 text-center">
            <div className="text-[9px] uppercase tracking-wider text-slate-500">
              DrayageDirect Driver
            </div>
          </div>
        </div>

        {/* Close hint */}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Close preview (Esc)
        </button>
      </div>
    </div>
  );
}
