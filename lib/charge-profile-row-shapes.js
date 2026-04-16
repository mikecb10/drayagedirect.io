// Row-shape constants and helpers for the charge-profile detail page editor.
//
// Originally inlined at the top of pages/settings/charge-profiles/[id].js.
// Moved to a shared lib in Plan G2 so the AP-side driver-tariffs editor
// (Plan G3) can consume the same shapes without copy-paste.
//
// Pure data + helpers. No React. No Next.js imports.

// ── Empty row templates per calculation mode ──────────────────
export const EMPTY_ROW_BASE = { amount_cents: 0, minimum_amount_cents: 0, free_units: 0 };

export const LOCATION_TYPES = [
  { value: 'org', label: 'Organization' },
  { value: 'city_state', label: 'City / State' },
  { value: 'zip', label: 'Zip Code' },
];

export const EMPTY_LANE_ROW = {
  ...EMPTY_ROW_BASE,
  origin_type: 'org', origin_id: null, origin_label: '', origin_value: '',
  dest_type: 'org', dest_id: null, dest_label: '', dest_value: '',
};

export const EMPTY_STATUS_ROW = { ...EMPTY_ROW_BASE, from_status: '', to_status: '' };

export const EMPTY_EVENT_ROW = {
  ...EMPTY_ROW_BASE, event_type: '',
  event_location_id: null, event_location_label: '',
  event_location_type: 'org', event_location_value: '',
};

export const EMPTY_MOVE_ROW = {
  ...EMPTY_ROW_BASE,
  move_events: [{ event: '', event_time: 'arrived', location_id: null, location_label: '', location_type: 'org', location_value: '' }],
  move_calc_from: 'first_event_arrived', move_calc_to: 'last_event_arrived',
};

export function emptyRowForMode(mode) {
  switch (mode) {
    case 'by_lane': return { ...EMPTY_LANE_ROW };
    case 'between_statuses': return { ...EMPTY_STATUS_ROW };
    case 'by_event': return { ...EMPTY_EVENT_ROW };
    case 'by_move': return JSON.parse(JSON.stringify(EMPTY_MOVE_ROW));
    default: return { ...EMPTY_ROW_BASE };
  }
}

export const EMPTY_VERSION = { label: '', effective_from: '', effective_to: '', rows: [] };

export function newVersion(mode, idx = 1) {
  return {
    ...JSON.parse(JSON.stringify(EMPTY_VERSION)),
    label: `Version ${idx}`,
    rows: [emptyRowForMode(mode)],
  };
}
