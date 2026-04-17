import OrgPicker from '../../ui/OrgPicker';

/**
 * EventLocationPicker — per-event location match picker for the
 * advanced-route builder.
 *
 * Four modes (mirrors the spec's location_match.mode enum):
 *   - specific    → OrgPicker (scoped by orgType prop)
 *   - city_state  → city text input + state dropdown
 *   - state       → state dropdown
 *   - zip         → zip text input
 *
 * Value shape (stable across modes — unused fields null):
 *   { mode, org_id, org_label, city, state, zip }
 *
 * `org_label` is a UI-only denorm of the picked org's name so the
 * OrgPicker can render the selected-state label after a page reload
 * (it doesn't re-fetch the org by id). The server-side matcher only
 * looks at org_id; org_label is ignored there but persisted in JSONB.
 *
 * Emits onChange(nextValue) with that full shape on any edit.
 * Switching modes clears the other fields so stale data doesn't
 * persist into a saved template.
 */

const MODES = [
  { key: 'specific',   label: 'Specific' },
  { key: 'city_state', label: 'City + State' },
  { key: 'state',      label: 'State' },
  { key: 'zip',        label: 'Zip' },
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

const EMPTY_VALUE = {
  mode: 'specific',
  org_id: null,
  org_label: null,
  city: null,
  state: null,
  zip: null,
};

function normalizeForMode(mode) {
  return { ...EMPTY_VALUE, mode };
}

export default function EventLocationPicker({ value, onChange, orgType = 'customer' }) {
  const v = value && value.mode ? value : EMPTY_VALUE;

  function setMode(nextMode) {
    if (nextMode === v.mode) return;
    onChange(normalizeForMode(nextMode));
  }

  function setField(field, fieldValue) {
    onChange({ ...v, [field]: fieldValue });
  }

  return (
    <div className="flex-1">
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              v.mode === m.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {v.mode === 'specific' && (
        <OrgPicker
          type={orgType}
          placeholder={`Add ${orgType}...`}
          value={v.org_id || null}
          valueLabel={v.org_label || ''}
          onChange={(org) => {
            if (org) {
              onChange({ ...v, org_id: org.id, org_label: org.name });
            } else {
              onChange({ ...v, org_id: null, org_label: null });
            }
          }}
        />
      )}

      {v.mode === 'city_state' && (
        <div className="flex gap-2">
          <input
            type="text"
            value={v.city || ''}
            onChange={(e) => setField('city', e.target.value || null)}
            placeholder="City"
            className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-900 dark:text-slate-100"
          />
          <select
            value={v.state || ''}
            onChange={(e) => setField('state', e.target.value || null)}
            className="w-24 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-900 dark:text-slate-100"
          >
            <option value="">State</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {v.mode === 'state' && (
        <select
          value={v.state || ''}
          onChange={(e) => setField('state', e.target.value || null)}
          className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-900 dark:text-slate-100"
        >
          <option value="">Select a state</option>
          {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}

      {v.mode === 'zip' && (
        <input
          type="text"
          value={v.zip || ''}
          onChange={(e) => setField('zip', e.target.value || null)}
          placeholder="Zip code"
          pattern="\d{5}(-\d{4})?"
          className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-900 dark:text-slate-100"
        />
      )}
    </div>
  );
}
