import { MapPin, Package, Truck, CheckCircle2, XCircle, Clock } from 'lucide-react';
import {
  deriveState,
  STATE_BY_KEY,
  deriveContainerLoadedState,
  deriveCurrentLocationName,
} from '../../../lib/dispatcher-states';

/**
 * LoadStateBanner — prominent "Current State" panel at the top of the
 * Routing tab. Shows the derived fine-grained state of the load with its
 * current location, and (when applicable) whether the container is loaded
 * or empty.
 *
 * The banner is always derived from the underlying events, so it cannot
 * drift from reality. Replaces the per-move "PENDING / IN PROGRESS /
 * COMPLETED" pills that used to live in each ContainerMoveCard header.
 *
 * Example outputs:
 *   📦 Dropped — Loaded                    Yard - Richardsons
 *   🚚 Enroute To Pickup — Loaded          BNSF - HASLET
 *   ✅ Completed                           (no location)
 *
 * The color of the banner is pulled from tenantColors.state_colors (if
 * set) or the default palette in dispatcher-states.js. For dark mode we
 * composite the hex color onto slate-900 at low alpha the same way the
 * dispatcher board rows do, so tenant colors remain recognizable without
 * overwhelming the dark chrome.
 */

function compositeOverDark(hex, alpha) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return null;
  const clean = hex.slice(1);
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  const BG_R = 15;
  const BG_G = 23;
  const BG_B = 42; // slate-900
  const rr = Math.round(r * alpha + BG_R * (1 - alpha));
  const gg = Math.round(g * alpha + BG_G * (1 - alpha));
  const bb = Math.round(b * alpha + BG_B * (1 - alpha));
  return `rgb(${rr}, ${gg}, ${bb})`;
}

function pickIcon(stateKey) {
  if (!stateKey) return Clock;
  if (stateKey === 'completed') return CheckCircle2;
  if (stateKey === 'pending_completion') return Clock;
  if (stateKey === 'delivered') return CheckCircle2;
  if (stateKey === 'cancelled') return XCircle;
  if (stateKey === 'pending') return Clock;
  if (stateKey === 'dispatched') return Truck;
  if (stateKey.startsWith('arrived_drop') || stateKey === 'arrived_drop') return Package;
  if (stateKey.includes('drop')) return Package;
  return Truck;
}

export default function LoadStateBanner({
  load,
  events = [],
  moves = [],
  tenantColors = null,
  isDark = false,
}) {
  if (!load) return null;

  // Enrich each event with its move's started_at so deriveState() can tell
  // "dispatched" (driver assigned, no start signal) from "enroute" (driver
  // actively working). The dispatcher board API already nests this on events
  // via the loads GET handler; in the routing tab we have moves + events
  // as separate arrays so we merge them here before building the synthetic
  // load for state derivation.
  const movesById = {};
  for (const m of moves) {
    movesById[m.id] = m;
  }

  const sortedEvents = [...events]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map((e) => {
      const m = movesById[e.move_id];
      return {
        ...e,
        move: m ? { started_at: m.started_at, driver_id: m.driver_id } : e.move,
      };
    });

  const currentEvent = sortedEvents.find((e) => !e.departed_at) || null;

  const loadForState = {
    ...load,
    current_event: currentEvent,
    routing_events: sortedEvents, // so deriveState can check prior departures
  };
  const stateKey = deriveState(loadForState);
  const state = STATE_BY_KEY[stateKey] || STATE_BY_KEY.pending;

  const loadedState = deriveContainerLoadedState(load, sortedEvents);
  const locationName = deriveCurrentLocationName(load, sortedEvents);

  // Tenant color overrides (same source of truth as dispatcher board rows)
  const overrideColor = tenantColors?.state_colors?.[stateKey];
  const baseColor = overrideColor || state.defaultColor;
  const backgroundColor = isDark
    ? compositeOverDark(baseColor, 0.25) || baseColor
    : baseColor;
  const textColor = isDark ? '#f1f5f9' : state.textColor;
  const borderColor = isDark ? compositeOverDark(baseColor, 0.55) : state.textColor + '33';

  const Icon = pickIcon(stateKey);

  // Loaded/empty badge (only for import/export flows with a meaningful state)
  const loadedBadge = loadedState
    ? {
        label: loadedState === 'loaded' ? 'Loaded' : 'Empty',
        bg: loadedState === 'loaded'
          ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
          : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300',
      }
    : null;

  return (
    <div
      className="rounded-xl border px-5 py-4 flex items-center gap-4 transition-colors"
      style={{
        backgroundColor,
        color: textColor,
        borderColor,
      }}
    >
      <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
        <Icon className="w-5 h-5" strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider opacity-75">
            Current State
          </span>
          {loadedBadge && (
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${loadedBadge.bg}`}>
              {loadedBadge.label}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h3 className="text-lg font-semibold leading-tight truncate">
            {state.label}
          </h3>
          {locationName && (
            <span className="inline-flex items-center gap-1 text-sm opacity-90 truncate">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{locationName}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
