# FU-093: Bulk-Print Delivery Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the dispatcher bulk-action bar's Print button to generate a multi-page PDF — one page per selected load — containing each load's Delivery Order in two variants (FULL or NEXT MOVE).

**Architecture:** Section-based React-PDF composer (`DeliveryOrderTemplate.js`) iterates over leaf-level section components in `components/pdf/sections/*` driven by a `sectionConfig` (defaults from a section registry today; per-tenant + per-customer overrides plug in cleanly when FU-035 ships). `lib/pdf/render-delivery-order.js` fetches the full data shape; `render-bulk-delivery-orders.js` loops + renders to one buffer; new `pages/api/tenant/loads/bulk-print.js` endpoint serves it. Bulk-bar Print becomes a popover with two variant buttons.

**Tech Stack:** React-PDF (`@react-pdf/renderer`), Next.js API routes, Supabase service-role client, Node's built-in `node:test` for unit tests.

**Spec reference:** `docs/superpowers/specs/2026-04-26-bulk-print-delivery-order-design.md`. Read sections §3-§8 before starting Task 4 (the data shape and registries are the contract).

---

### Task 1: Document type & section registries (with tests)

**Files:**
- Create: `lib/constants/document-types.js`
- Create: `lib/constants/document-sections.js`
- Create: `tests/document-types-constants.test.mjs`
- Create: `tests/document-sections-constants.test.mjs`

- [ ] **Step 1: Write `lib/constants/document-types.js`**

```js
/**
 * Single source of truth for document types. Mirrors the shape of
 * lib/constants/load-types.js so the Document Designer (FU-035)
 * can iterate this list as its palette of available types.
 *
 * Adding a new document type:
 *   1. Append entry below
 *   2. If the type has its own section composition, register sections
 *      in lib/constants/document-sections.js
 */

export const DOCUMENT_TYPES = [
  {
    value: 'delivery_order_full',
    label: 'Delivery Order — Full',
    description: 'Entire routing across all moves',
    category: 'load',
  },
  {
    value: 'delivery_order_next_move',
    label: 'Delivery Order — Next Move',
    description: 'Only the next non-completed move',
    category: 'load',
  },
];

export const VALID_DOCUMENT_TYPES = DOCUMENT_TYPES.map((t) => t.value);
export const DOCUMENT_TYPE_LABELS = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.value, t.label])
);

export function getDocumentType(value) {
  return DOCUMENT_TYPES.find((t) => t.value === value) || null;
}

export function isValidDocumentType(value) {
  return VALID_DOCUMENT_TYPES.includes(value);
}
```

- [ ] **Step 2: Write `tests/document-types-constants.test.mjs`**

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DOCUMENT_TYPES,
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  getDocumentType,
  isValidDocumentType,
} from '../lib/constants/document-types.js';

test('DOCUMENT_TYPES contains the two delivery order variants', () => {
  const values = DOCUMENT_TYPES.map((t) => t.value).sort();
  assert.deepEqual(values, ['delivery_order_full', 'delivery_order_next_move']);
});

test('every DOCUMENT_TYPES entry has required fields', () => {
  for (const t of DOCUMENT_TYPES) {
    assert.equal(typeof t.value, 'string', `missing value: ${JSON.stringify(t)}`);
    assert.equal(typeof t.label, 'string', `missing label: ${t.value}`);
    assert.equal(typeof t.description, 'string', `missing description: ${t.value}`);
    assert.equal(typeof t.category, 'string', `missing category: ${t.value}`);
  }
});

test('VALID_DOCUMENT_TYPES is the value list', () => {
  assert.deepEqual(
    VALID_DOCUMENT_TYPES.sort(),
    DOCUMENT_TYPES.map((t) => t.value).sort()
  );
});

test('DOCUMENT_TYPE_LABELS maps value -> label', () => {
  for (const t of DOCUMENT_TYPES) {
    assert.equal(DOCUMENT_TYPE_LABELS[t.value], t.label);
  }
});

test('getDocumentType finds known types and returns null for unknown', () => {
  assert.equal(getDocumentType('delivery_order_full').value, 'delivery_order_full');
  assert.equal(getDocumentType('does_not_exist'), null);
});

test('isValidDocumentType true/false', () => {
  assert.equal(isValidDocumentType('delivery_order_full'), true);
  assert.equal(isValidDocumentType('delivery_order_next_move'), true);
  assert.equal(isValidDocumentType('not_a_type'), false);
  assert.equal(isValidDocumentType(null), false);
  assert.equal(isValidDocumentType(undefined), false);
  assert.equal(isValidDocumentType(''), false);
});
```

- [ ] **Step 3: Run the test, expect pass**

```bash
node --test tests/document-types-constants.test.mjs
```

Expected: all 6 tests pass.

- [ ] **Step 4: Write `lib/constants/document-sections.js`**

```js
/**
 * Section registries per document type. The Document Designer
 * (FU-035) uses these as the palette of available toggles.
 *
 * Section flags:
 *   defaultVisible: shown by default unless overridden in tenant config
 *   toggleable:     can be turned off in the Document Designer.
 *                   `false` means load-bearing — the document is
 *                   meaningless without it (e.g., move_block on a
 *                   Delivery Order is the routing itself).
 */

export const DELIVERY_ORDER_SECTIONS = [
  { id: 'load_metadata',       label: 'Load metadata',                defaultVisible: true,  toggleable: false },
  { id: 'bill_to',             label: 'Bill-to customer',             defaultVisible: true,  toggleable: true  },
  { id: 'customer_contact',    label: 'Customer phone / email',       defaultVisible: true,  toggleable: true  },
  { id: 'equipment_details',   label: 'Container / chassis details',  defaultVisible: true,  toggleable: true  },
  { id: 'hazmat_details',      label: 'Hazmat details',               defaultVisible: true,  toggleable: true  },
  { id: 'instructions',        label: 'Driver notes / instructions',  defaultVisible: true,  toggleable: true  },
  { id: 'appointment_details', label: 'Appointment #s / gate codes',  defaultVisible: true,  toggleable: true  },
  { id: 'move_block',          label: 'Routing (moves + events)',     defaultVisible: true,  toggleable: false },
  { id: 'driver_per_move',     label: 'Driver name per move',         defaultVisible: true,  toggleable: true  },
  { id: 'signature_block',     label: 'Signature block',              defaultVisible: false, toggleable: true  },
  { id: 'barcode',             label: 'Load # barcode',               defaultVisible: false, toggleable: true  },
  { id: 'footer',              label: 'Footer (timestamp, page #)',   defaultVisible: true,  toggleable: false },
];

export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
};

export function getSectionsForDocumentType(value) {
  return SECTIONS_BY_DOCUMENT_TYPE[value] || [];
}

/**
 * Compute the effective visibility map for a document type given an
 * optional sectionConfig override. Used by the composer.
 */
export function computeVisibility(sections, sectionConfig) {
  const out = {};
  for (const s of sections) {
    if (!s.toggleable) {
      out[s.id] = true;
      continue;
    }
    const override = sectionConfig?.visibility?.[s.id];
    out[s.id] = override === undefined ? s.defaultVisible : override;
  }
  return out;
}
```

- [ ] **Step 5: Write `tests/document-sections-constants.test.mjs`**

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DELIVERY_ORDER_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('DELIVERY_ORDER_SECTIONS has all entries with required fields', () => {
  for (const s of DELIVERY_ORDER_SECTIONS) {
    assert.equal(typeof s.id, 'string', `missing id: ${JSON.stringify(s)}`);
    assert.equal(typeof s.label, 'string', `missing label: ${s.id}`);
    assert.equal(typeof s.defaultVisible, 'boolean', `defaultVisible: ${s.id}`);
    assert.equal(typeof s.toggleable, 'boolean', `toggleable: ${s.id}`);
  }
});

test('move_block, load_metadata, footer are non-toggleable on Delivery Order', () => {
  const byId = Object.fromEntries(DELIVERY_ORDER_SECTIONS.map((s) => [s.id, s]));
  assert.equal(byId.move_block.toggleable, false);
  assert.equal(byId.load_metadata.toggleable, false);
  assert.equal(byId.footer.toggleable, false);
});

test('getSectionsForDocumentType returns the registry for both variants', () => {
  assert.equal(
    getSectionsForDocumentType('delivery_order_full'),
    DELIVERY_ORDER_SECTIONS
  );
  assert.equal(
    getSectionsForDocumentType('delivery_order_next_move'),
    DELIVERY_ORDER_SECTIONS
  );
});

test('getSectionsForDocumentType returns [] for unknown types', () => {
  assert.deepEqual(getSectionsForDocumentType('not_a_type'), []);
});

test('computeVisibility uses defaults when no config provided', () => {
  const v = computeVisibility(DELIVERY_ORDER_SECTIONS, undefined);
  assert.equal(v.bill_to, true);
  assert.equal(v.signature_block, false); // defaultVisible: false
  assert.equal(v.move_block, true); // non-toggleable, always true
});

test('computeVisibility honors override for toggleable sections', () => {
  const v = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    visibility: { bill_to: false, signature_block: true },
  });
  assert.equal(v.bill_to, false);
  assert.equal(v.signature_block, true);
});

test('computeVisibility ignores override on non-toggleable sections', () => {
  const v = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    visibility: { move_block: false }, // attempt to hide load-bearing section
  });
  assert.equal(v.move_block, true); // still on
});
```

- [ ] **Step 6: Run the section test**

```bash
node --test tests/document-sections-constants.test.mjs
```

Expected: all 7 tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/constants/document-types.js \
        lib/constants/document-sections.js \
        tests/document-types-constants.test.mjs \
        tests/document-sections-constants.test.mjs

git commit -m "$(cat <<'EOF'
feat(pdf): document type + section registries (FU-093 prep)

Two new constant files mirroring the shape of lib/constants/load-types.js:

- document-types.js: registers DELIVERY_ORDER_FULL and
  DELIVERY_ORDER_NEXT_MOVE as first-class document types.
- document-sections.js: registers the 12 sections that compose a
  Delivery Order, with defaultVisible + toggleable flags. Includes
  computeVisibility helper for the composer.

These power the bulk-print feature shipping in this FU and provide
the registry contract the Document Designer (FU-035) will consume.

Refs: FU-093

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: select-moves helper (with test)

**Files:**
- Create: `lib/pdf/select-moves.js`
- Create: `tests/select-moves.test.mjs`

- [ ] **Step 1: Write `lib/pdf/select-moves.js`**

```js
/**
 * Pick which moves render in a Delivery Order based on the variant.
 *
 * - delivery_order_full: all moves, sorted by move_index ascending
 * - delivery_order_next_move: the lowest-move_index move whose status
 *   is not 'completed' or 'cancelled'. Returns null if no eligible
 *   move exists (e.g., all moves are completed).
 *
 * Move statuses (per migration 090): unassigned | pending |
 * dispatched | in_progress | completed | cancelled.
 */
export function selectMoves(moves, variant) {
  const sorted = [...(moves || [])].sort(
    (a, b) => (a.move_index ?? 0) - (b.move_index ?? 0)
  );
  if (variant === 'delivery_order_full') return sorted;
  if (variant === 'delivery_order_next_move') {
    const next = sorted.find(
      (m) => m.status !== 'completed' && m.status !== 'cancelled'
    );
    return next ? [next] : null;
  }
  // Unknown variant — defensive default
  return sorted;
}
```

- [ ] **Step 2: Write `tests/select-moves.test.mjs`**

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { selectMoves } from '../lib/pdf/select-moves.js';

const MOVES = [
  { move_index: 1, status: 'completed' },
  { move_index: 2, status: 'in_progress' },
  { move_index: 3, status: 'unassigned' },
];

test('full returns all moves sorted by move_index', () => {
  // Pass in scrambled order
  const scrambled = [MOVES[2], MOVES[0], MOVES[1]];
  const out = selectMoves(scrambled, 'delivery_order_full');
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((m) => m.move_index), [1, 2, 3]);
});

test('next_move returns the first non-completed/cancelled move', () => {
  const out = selectMoves(MOVES, 'delivery_order_next_move');
  assert.equal(out.length, 1);
  assert.equal(out[0].move_index, 2);
  assert.equal(out[0].status, 'in_progress');
});

test('next_move skips cancelled moves', () => {
  const moves = [
    { move_index: 1, status: 'completed' },
    { move_index: 2, status: 'cancelled' },
    { move_index: 3, status: 'pending' },
  ];
  const out = selectMoves(moves, 'delivery_order_next_move');
  assert.equal(out.length, 1);
  assert.equal(out[0].move_index, 3);
});

test('next_move returns null when all moves are completed', () => {
  const moves = [
    { move_index: 1, status: 'completed' },
    { move_index: 2, status: 'completed' },
  ];
  const out = selectMoves(moves, 'delivery_order_next_move');
  assert.equal(out, null);
});

test('next_move returns null when all moves are cancelled', () => {
  const moves = [{ move_index: 1, status: 'cancelled' }];
  const out = selectMoves(moves, 'delivery_order_next_move');
  assert.equal(out, null);
});

test('next_move treats brand-new (unassigned) load as eligible', () => {
  const moves = [
    { move_index: 1, status: 'unassigned' },
    { move_index: 2, status: 'unassigned' },
  ];
  const out = selectMoves(moves, 'delivery_order_next_move');
  assert.equal(out.length, 1);
  assert.equal(out[0].move_index, 1);
});

test('empty moves array returns empty array for full and null for next_move', () => {
  assert.deepEqual(selectMoves([], 'delivery_order_full'), []);
  assert.equal(selectMoves([], 'delivery_order_next_move'), null);
});

test('null moves arg is treated as empty', () => {
  assert.deepEqual(selectMoves(null, 'delivery_order_full'), []);
  assert.equal(selectMoves(null, 'delivery_order_next_move'), null);
});
```

- [ ] **Step 3: Run the test**

```bash
node --test tests/select-moves.test.mjs
```

Expected: all 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/pdf/select-moves.js tests/select-moves.test.mjs

git commit -m "$(cat <<'EOF'
feat(pdf): selectMoves helper for Delivery Order variant routing (FU-093 prep)

Pure helper that picks moves to render based on document variant:
- delivery_order_full: all moves sorted by move_index
- delivery_order_next_move: first move whose status is neither
  completed nor cancelled, or null if all moves are finished

The null return signals the bulk renderer to skip the load with a
"no remaining moves" reason. 8 unit tests cover full, next_move,
cancelled-skipping, all-done null, brand-new loads, empty input,
and scrambled input order.

Refs: FU-093

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Section components (presentational React-PDF)

**Files (all new under `components/pdf/sections/`):**
- `LoadMetadata.js`
- `BillTo.js`
- `CustomerContact.js`
- `EquipmentDetails.js`
- `HazmatDetails.js`
- `Instructions.js`
- `AppointmentDetails.js`
- `MoveBlock.js`
- `SignatureBlock.js`
- `BarcodeBlock.js`
- `DocumentFooter.js`

These have no unit tests (the codebase has no React-PDF testing harness — see spec §13). Each component reads its data slice and **returns null if the slice is empty**.

- [ ] **Step 1: Write `components/pdf/sections/LoadMetadata.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function LoadMetadata({ data }) {
  if (!data) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
      <View>
        <Text style={typography.label}>Load #</Text>
        <Text style={typography.value}>{data.load_number || '—'}</Text>
        {data.customer_reference ? (
          <>
            <Text style={typography.label}>Customer Ref</Text>
            <Text style={typography.value}>{data.customer_reference}</Text>
          </>
        ) : null}
      </View>
      <View style={{ minWidth: 180 }}>
        <Text style={typography.label}>Container #</Text>
        <Text style={typography.value}>{data.container_number || '—'}</Text>
        <Text style={typography.label}>Chassis #</Text>
        <Text style={typography.value}>{data.chassis_number || '—'}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Write `components/pdf/sections/BillTo.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function BillTo({ data }) {
  if (!data || !data.name) return null;
  const cityLine = [data.city, data.state, data.zip].filter(Boolean).join(', ');
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={typography.label}>Bill To</Text>
      <Text style={typography.value}>{data.name}</Text>
      {data.address_line1 ? <Text style={typography.value}>{data.address_line1}</Text> : null}
      {cityLine ? <Text style={typography.value}>{cityLine}</Text> : null}
    </View>
  );
}
```

- [ ] **Step 3: Write `components/pdf/sections/CustomerContact.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function CustomerContact({ data }) {
  if (!data || (!data.phone && !data.email)) return null;
  return (
    <View style={{ marginBottom: 8, flexDirection: 'row', gap: 16 }}>
      {data.phone ? (
        <View>
          <Text style={typography.label}>Phone</Text>
          <Text style={typography.value}>{data.phone}</Text>
        </View>
      ) : null}
      {data.email ? (
        <View>
          <Text style={typography.label}>Email</Text>
          <Text style={typography.value}>{data.email}</Text>
        </View>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 4: Write `components/pdf/sections/EquipmentDetails.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function EquipmentDetails({ data, opts }) {
  if (!data) return null;
  const showSeal = opts?.show_seal !== false;
  const fields = [
    ['Container Size', data.container_size],
    ['Container Type', data.container_type],
    ['Chassis Size', data.chassis_size],
    ['Chassis Type', data.chassis_type],
    showSeal ? ['Seal #', data.seal_number] : null,
    data.weight_lbs ? ['Weight', `${data.weight_lbs.toLocaleString()} lbs`] : null,
  ].filter((f) => f && f[1]);

  if (fields.length === 0) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={typography.label}>Equipment</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {fields.map(([label, value]) => (
          <View key={label} style={{ minWidth: 100 }}>
            <Text style={[typography.label, { fontSize: 8 }]}>{label}</Text>
            <Text style={typography.value}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Write `components/pdf/sections/HazmatDetails.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography, colors } from '../shared/typography';

export default function HazmatDetails({ data }) {
  if (!data || !data.hazmat_class) return null;
  return (
    <View
      style={{
        marginBottom: 12,
        padding: 8,
        border: `1pt solid ${colors.warning || '#dc2626'}`,
        backgroundColor: '#fef2f2',
      }}
    >
      <Text style={[typography.label, { color: '#dc2626', fontWeight: 'bold' }]}>HAZMAT</Text>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
        {data.un_code ? (
          <View>
            <Text style={[typography.label, { fontSize: 8 }]}>UN Code</Text>
            <Text style={typography.value}>{data.un_code}</Text>
          </View>
        ) : null}
        <View>
          <Text style={[typography.label, { fontSize: 8 }]}>Class</Text>
          <Text style={typography.value}>{data.hazmat_class}</Text>
        </View>
        {data.emergency_phone ? (
          <View>
            <Text style={[typography.label, { fontSize: 8 }]}>Emergency Phone</Text>
            <Text style={typography.value}>{data.emergency_phone}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
```

- [ ] **Step 6: Write `components/pdf/sections/Instructions.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function Instructions({ data }) {
  if (!data || (!data.driver_notes && !data.special_instructions)) return null;
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={typography.label}>Notes / Instructions</Text>
      {data.driver_notes ? (
        <Text style={typography.value}>{data.driver_notes}</Text>
      ) : null}
      {data.special_instructions ? (
        <Text style={[typography.value, { marginTop: 4 }]}>
          {data.special_instructions}
        </Text>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 7: Write `components/pdf/sections/AppointmentDetails.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function AppointmentDetails({ data }) {
  if (!data) return null;
  const rows = [];
  if (data.pickup_appt_number) rows.push(['Pickup Appt', data.pickup_appt_number]);
  if (data.delivery_appt_number) rows.push(['Delivery Appt', data.delivery_appt_number]);
  if (data.gate_codes?.pickup) rows.push(['Pickup Gate', data.gate_codes.pickup]);
  if (data.gate_codes?.delivery) rows.push(['Delivery Gate', data.gate_codes.delivery]);
  if (rows.length === 0) return null;
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={typography.label}>Appointments / Gate Codes</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ minWidth: 110 }}>
            <Text style={[typography.label, { fontSize: 8 }]}>{label}</Text>
            <Text style={typography.value}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
```

- [ ] **Step 8: Write `components/pdf/sections/MoveBlock.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography, colors } from '../shared/typography';

function formatDateTime(input) {
  if (!input) return 'TBD';
  const d = new Date(input);
  if (isNaN(d.getTime())) return 'TBD';
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatLocation(loc) {
  if (!loc) return '(TBD)';
  return [loc.name, loc.city, loc.state].filter(Boolean).join(', ');
}

export default function MoveBlock({ data, opts, isNextMoveOnly, totalMoves }) {
  if (!data || !data.moves || data.moves.length === 0) return null;
  const showDriver = opts?.show_driver !== false;

  return (
    <View style={{ marginBottom: 12 }}>
      {data.moves.map((move, idx) => {
        const driver = move.driver
          ? `${move.driver.first_name || ''} ${move.driver.last_name || ''}`.trim() || '(unassigned)'
          : '(unassigned)';
        const headerLabel = isNextMoveOnly
          ? `Next Move (Move ${move.move_index} of ${totalMoves || data.moves.length})`
          : `Move ${move.move_index} of ${totalMoves || data.moves.length}`;
        return (
          <View key={move.move_index ?? idx} style={{ marginBottom: 10 }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                borderBottom: `1pt solid ${colors.border || '#e5e7eb'}`,
                paddingBottom: 2,
                marginBottom: 4,
              }}
            >
              <Text style={[typography.label, { fontWeight: 'bold' }]}>{headerLabel}</Text>
              {showDriver ? (
                <Text style={typography.label}>Driver: {driver}</Text>
              ) : null}
            </View>
            {(move.events || []).map((ev, evIdx) => (
              <View
                key={ev.sequence ?? evIdx}
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}
              >
                <Text style={typography.value}>
                  {(evIdx + 1)}. {ev.event_type?.replace(/_/g, ' ') || '—'} @ {formatLocation(ev.location)}
                </Text>
                <Text style={[typography.value, typography.muted]}>
                  Sched: {formatDateTime(ev.scheduled_at)}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 9: Write `components/pdf/sections/SignatureBlock.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography, colors } from '../shared/typography';

export default function SignatureBlock() {
  return (
    <View style={{ marginTop: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <View style={{ borderTop: `1pt solid ${colors.border || '#000'}`, paddingTop: 4 }}>
          <Text style={typography.label}>Driver Signature</Text>
          <Text style={[typography.label, { fontSize: 8, marginTop: 14 }]}>Date / Time</Text>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ borderTop: `1pt solid ${colors.border || '#000'}`, paddingTop: 4 }}>
          <Text style={typography.label}>Customer Signature</Text>
          <Text style={[typography.label, { fontSize: 8, marginTop: 14 }]}>Date / Time</Text>
        </View>
      </View>
    </View>
  );
}
```

- [ ] **Step 10: Write `components/pdf/sections/BarcodeBlock.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * v1: monospace text rendering of the load number. Future iterations
 * may swap in a real barcode (Code 128 SVG via @react-pdf/renderer's
 * Svg component or a precomputed image).
 */
export default function BarcodeBlock({ data }) {
  if (!data?.load_number) return null;
  return (
    <View style={{ marginTop: 8, alignItems: 'center' }}>
      <Text style={[typography.value, { fontFamily: 'Courier', fontSize: 14, letterSpacing: 2 }]}>
        *{data.load_number}*
      </Text>
    </View>
  );
}
```

- [ ] **Step 11: Write `components/pdf/sections/DocumentFooter.js`**

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography, colors } from '../shared/typography';

function formatTimestamp() {
  return new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function DocumentFooter({ data }) {
  return (
    <View
      style={{
        position: 'absolute', bottom: 24, left: 36, right: 36,
        flexDirection: 'row', justifyContent: 'space-between',
        borderTop: `0.5pt solid ${colors.border || '#e5e7eb'}`,
        paddingTop: 4,
      }}
      fixed
    >
      <Text style={[typography.value, typography.muted, { fontSize: 8 }]}>
        {data?.tenant_name || ''} • Generated {formatTimestamp()}
      </Text>
      <Text
        style={[typography.value, typography.muted, { fontSize: 8 }]}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}
```

- [ ] **Step 12: Verify dev server compile**

The dev server should HMR-recompile after these new files land. Use `preview_logs` to confirm a `✓ Compiled` line appears with no errors. None of these files are imported yet, so they sit in the bundle but don't run.

- [ ] **Step 13: Commit**

```bash
git add components/pdf/sections/

git commit -m "$(cat <<'EOF'
feat(pdf): Delivery Order section components (FU-093 prep)

11 new presentational React-PDF components in components/pdf/sections/,
each with a single responsibility and a render-if-data-present guard:

- LoadMetadata: load #, customer ref, container, chassis
- BillTo: bill-to customer name + address
- CustomerContact: phone, email
- EquipmentDetails: container/chassis size+type, weight, seal #
- HazmatDetails: UN code, class, emergency phone (with red border)
- Instructions: driver notes + special instructions
- AppointmentDetails: appt #s, gate codes
- MoveBlock: routing — moves + events with locations and dates
- SignatureBlock: driver + customer signature lines
- BarcodeBlock: load # in monospace (v1; real barcode in future)
- DocumentFooter: tenant name + generated-at + page X of Y (fixed)

Each component takes only its data slice + optional opts; toggle/order
control lives in the composer (next commit). Render-if-data-present
means hazmat/signature/etc only show when the load actually has them.

Refs: FU-093

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Composer template

**Files:**
- Create: `components/pdf/DeliveryOrderTemplate.js`

- [ ] **Step 1: Write `components/pdf/DeliveryOrderTemplate.js`**

```jsx
import { Document, Page } from '@react-pdf/renderer';
import Header from './shared/Header';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
} from '../../lib/constants/document-sections';
import LoadMetadata from './sections/LoadMetadata';
import BillTo from './sections/BillTo';
import CustomerContact from './sections/CustomerContact';
import EquipmentDetails from './sections/EquipmentDetails';
import HazmatDetails from './sections/HazmatDetails';
import Instructions from './sections/Instructions';
import AppointmentDetails from './sections/AppointmentDetails';
import MoveBlock from './sections/MoveBlock';
import SignatureBlock from './sections/SignatureBlock';
import BarcodeBlock from './sections/BarcodeBlock';
import DocumentFooter from './sections/DocumentFooter';

/**
 * Maps section ID -> render function. New sections plug in by
 * adding an entry here and to the registry in
 * lib/constants/document-sections.js.
 */
function renderSection(sectionId, doc, opts, ctx) {
  switch (sectionId) {
    case 'load_metadata':       return <LoadMetadata data={doc.load_metadata} />;
    case 'bill_to':             return <BillTo data={doc.bill_to} />;
    case 'customer_contact':    return <CustomerContact data={doc.customer_contact} />;
    case 'equipment_details':   return <EquipmentDetails data={doc.equipment_details} opts={opts} />;
    case 'hazmat_details':      return <HazmatDetails data={doc.hazmat_details} />;
    case 'instructions':        return <Instructions data={doc.instructions} />;
    case 'appointment_details': return <AppointmentDetails data={doc.appointment_details} />;
    case 'move_block':
      return (
        <MoveBlock
          data={{ moves: doc.moves }}
          opts={opts}
          isNextMoveOnly={ctx.variant === 'delivery_order_next_move'}
          totalMoves={doc.total_moves_in_load}
        />
      );
    case 'driver_per_move':
      // Driver display is controlled inside MoveBlock via opts; the registry
      // entry is here so the Document Designer can toggle "show driver name".
      return null;
    case 'signature_block':     return <SignatureBlock />;
    case 'barcode':             return <BarcodeBlock data={doc.load_metadata} />;
    case 'footer':              return <DocumentFooter data={{ tenant_name: doc.tenant_name }} />;
    default:                    return null;
  }
}

export default function DeliveryOrderTemplate({ docs, variant, sectionConfig }) {
  const registrySections = getSectionsForDocumentType(variant);
  const visibility = computeVisibility(registrySections, sectionConfig);
  const order = sectionConfig?.order || registrySections.map((s) => s.id);

  // Driver visibility is a section-level toggle in the registry but
  // physically rendered inside MoveBlock; thread through opts.
  const moveOpts = {
    ...(sectionConfig?.perSection?.move_block || {}),
    show_driver: visibility.driver_per_move,
  };

  return (
    <Document>
      {(docs || []).map((doc) => (
        <Page key={doc.order_id} size="LETTER" style={typography.page} wrap>
          <Header
            tenantName={doc.tenant_name}
            title="DELIVERY ORDER"
            subtitle={variant === 'delivery_order_next_move' ? 'Next Move' : null}
          />
          {order.map((sectionId) => {
            if (!visibility[sectionId]) return null;
            const opts =
              sectionId === 'move_block'
                ? moveOpts
                : sectionConfig?.perSection?.[sectionId];
            const node = renderSection(sectionId, doc, opts, { variant });
            return node ? <React.Fragment key={sectionId}>{node}</React.Fragment> : null;
          })}
        </Page>
      ))}
    </Document>
  );
}
```

- [ ] **Step 2: Add the missing React import**

The `<React.Fragment>` usage at the bottom needs an explicit import. Add at the top:

```jsx
import React from 'react';
```

- [ ] **Step 3: Verify Header.js accepts a subtitle prop**

```bash
```

Read `components/pdf/shared/Header.js` and confirm it accepts `subtitle`. If it doesn't (likely — it was built for rate-con originally), inline-extend it: pass `subtitle` as a regular prop and let Header render it under the title. If Header doesn't currently accept it, modify Header.js to render the subtitle if provided:

```jsx
// Inside Header.js, after the title <Text>:
{subtitle ? (
  <Text style={[typography.value, typography.muted, { textAlign: 'center', marginTop: 2 }]}>
    {subtitle}
  </Text>
) : null}
```

(Read Header.js first to confirm the exact integration point — if it already supports it, skip.)

- [ ] **Step 4: Verify dev server compile**

`preview_logs` should show `✓ Compiled` for the new template. The template is still not imported by anything that runs (renderer comes next), so no runtime test yet.

- [ ] **Step 5: Commit**

```bash
git add components/pdf/DeliveryOrderTemplate.js components/pdf/shared/Header.js

git commit -m "$(cat <<'EOF'
feat(pdf): DeliveryOrderTemplate composer (FU-093 prep)

The composer iterates the section registry for the given variant and
renders each section in registry order, applying:

- visibility from computeVisibility(registry, sectionConfig)
- per-section opts from sectionConfig.perSection[sectionId]
- order override from sectionConfig.order if provided

For v1, sectionConfig is undefined and the composer uses registry
defaults. The Document Designer (FU-035) will populate sectionConfig
from a per-tenant + per-customer cascade resolver — the composer code
does not change.

driver_per_move is a section-level toggle but physically renders
inside MoveBlock; thread it through opts so the Designer can hide
driver names without restructuring the routing block.

Header.js gained a subtitle prop so the NEXT MOVE variant can render
"Next Move" under the title.

Refs: FU-093

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Data fetch + bulk renderer

**Files:**
- Create: `lib/pdf/render-delivery-order.js`
- Create: `lib/pdf/render-bulk-delivery-orders.js`

- [ ] **Step 1: Write `lib/pdf/render-delivery-order.js`**

```js
import { selectMoves } from './select-moves';

/**
 * Fetch the full data shape for a single Delivery Order. Returns null
 * if NEXT_MOVE variant has no eligible move (signals the bulk renderer
 * to skip this load).
 *
 * @param {SupabaseClient} svc - service-role client
 * @param {string} orderId
 * @param {string} tenantId
 * @param {string} variant - 'delivery_order_full' | 'delivery_order_next_move'
 * @returns {Promise<object|null>}
 */
export async function fetchDeliveryOrderData(svc, orderId, tenantId, variant) {
  // 1. Fetch the order with all relevant joins
  const { data: order, error: orderErr } = await svc
    .from('orders')
    .select(`
      id, order_number, customer_reference, container_number, chassis_number,
      load_notes, driver_notes, special_instructions,
      pickup_appt_number, delivery_appt_number,
      pickup_apt_from, delivery_apt_from,
      hazmat, hazmat_un, hazmat_class, hazmat_emergency_phone,
      container_size_label, container_type_label, chassis_size_label, chassis_type_label,
      seal_number, weight_lbs,
      customer_id,
      customer:customers!orders_customer_id_fkey(
        id, name, address_line1, city, state, zip, phone, email
      )
    `)
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderErr) throw new Error(`Order fetch failed: ${orderErr.message}`);
  if (!order) throw new Error(`Order not found: ${orderId}`);

  // 2. Fetch moves with driver + events
  const { data: moves, error: movesErr } = await svc
    .from('order_container_moves')
    .select(`
      id, move_index, move_type, status,
      driver:drivers(id, first_name, last_name, phone),
      events:order_routing_events(
        id, sequence, event_type, status,
        scheduled_at, arrived_at, departed_at,
        location:customers(id, name, city, state)
      )
    `)
    .eq('order_id', orderId)
    .eq('tenant_id', tenantId)
    .order('move_index', { ascending: true });

  if (movesErr) throw new Error(`Moves fetch failed: ${movesErr.message}`);

  // 3. Apply variant filter
  const totalMoves = (moves || []).length;
  const selectedMoves = selectMoves(moves || [], variant);
  if (selectedMoves === null) return null; // NEXT_MOVE: nothing to render

  // 4. Sort events within each selected move by sequence
  for (const m of selectedMoves) {
    if (Array.isArray(m.events)) {
      m.events.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    }
  }

  // 5. Tenant name
  const { data: tenant } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  // 6. Build the data shape per spec §8
  return {
    order_id: order.id,
    tenant_name: tenant?.name || '',
    bill_to_customer_id: order.customer_id, // FU-035 cascade resolver hook
    load_metadata: {
      load_number: order.order_number,
      customer_reference: order.customer_reference,
      container_number: order.container_number,
      chassis_number: order.chassis_number,
    },
    bill_to: order.customer
      ? {
          name: order.customer.name,
          address_line1: order.customer.address_line1,
          city: order.customer.city,
          state: order.customer.state,
          zip: order.customer.zip,
        }
      : null,
    customer_contact: order.customer
      ? { phone: order.customer.phone, email: order.customer.email }
      : null,
    equipment_details: {
      container_size: order.container_size_label,
      container_type: order.container_type_label,
      chassis_size: order.chassis_size_label,
      chassis_type: order.chassis_type_label,
      seal_number: order.seal_number,
      weight_lbs: order.weight_lbs,
    },
    hazmat_details: order.hazmat
      ? {
          un_code: order.hazmat_un,
          hazmat_class: order.hazmat_class,
          emergency_phone: order.hazmat_emergency_phone,
        }
      : null,
    instructions: {
      driver_notes: order.driver_notes,
      special_instructions: order.special_instructions || order.load_notes,
    },
    appointment_details: {
      pickup_appt_number: order.pickup_appt_number,
      delivery_appt_number: order.delivery_appt_number,
      gate_codes: null, // not modeled today; leave null so section short-circuits
    },
    moves: selectedMoves,
    total_moves_in_load: totalMoves,
  };
}
```

**Note on field names**: the column list above is best-effort against the schema as documented. If any column doesn't exist (e.g., `driver_notes` may be `notes` or split differently), the `.select()` will fail at runtime — fix by checking `supabase/migrations/` for the actual `orders` schema and adjusting the select. The shape returned to consumers stays the same; only the column names in the SQL differ.

- [ ] **Step 2: Validate column names against schema**

```bash
```

Read `supabase/migrations/001_initial_schema.sql` (and any later migrations that altered `orders`) and confirm: `order_number`, `customer_reference`, `container_number`, `chassis_number`, `customer_id`, `hazmat`, `hazmat_un`, `hazmat_class`, `hazmat_emergency_phone`, `container_size_label`, `container_type_label`, `chassis_size_label`, `chassis_type_label`, `seal_number`, `weight_lbs`, `driver_notes`, `special_instructions`, `load_notes`, `pickup_appt_number`, `delivery_appt_number`. Drop columns that don't exist; fall back to `null` in the data shape (sections short-circuit).

- [ ] **Step 3: Write `lib/pdf/render-bulk-delivery-orders.js`**

```js
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { fetchDeliveryOrderData } from './render-delivery-order';
import DeliveryOrderTemplate from '../../components/pdf/DeliveryOrderTemplate';

/**
 * Render a multi-page PDF with one page per order id. Skips orders
 * that NEXT_MOVE variant deems ineligible (no remaining moves).
 *
 * Returns { buffer, skipped } where:
 *   buffer: Buffer | null  (null if every order was skipped)
 *   skipped: string[]      (order ids that were skipped)
 *
 * FU-035 will inject per-doc sectionConfig (resolved per
 * bill_to_customer_id) via a future cascade resolver. v1 passes
 * undefined so the composer uses registry defaults.
 */
export async function renderBulkDeliveryOrdersPdf(svc, orderIds, tenantId, variant) {
  const docs = [];
  const skipped = [];
  for (const id of orderIds) {
    try {
      const data = await fetchDeliveryOrderData(svc, id, tenantId, variant);
      if (data === null) {
        skipped.push(id);
        continue;
      }
      docs.push(data);
    } catch (e) {
      console.error(`bulk-print: order ${id} fetch failed:`, e.message);
      skipped.push(id);
    }
  }

  if (docs.length === 0) return { buffer: null, skipped };

  // FU-035 hook (intentionally commented; ship in that FU):
  // const perDocConfigs = await Promise.all(
  //   docs.map(d => resolveTemplateConfig(svc, tenantId, d.bill_to_customer_id, variant))
  // );

  const buffer = await renderToBuffer(
    React.createElement(DeliveryOrderTemplate, {
      docs,
      variant,
      sectionConfig: undefined,
    })
  );

  return { buffer, skipped };
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/pdf/render-delivery-order.js lib/pdf/render-bulk-delivery-orders.js

git commit -m "$(cat <<'EOF'
feat(pdf): Delivery Order data fetch + bulk renderer (FU-093 prep)

- render-delivery-order.js: fetchDeliveryOrderData(svc, orderId,
  tenantId, variant) joins orders + customer + moves + events +
  drivers + tenant, applies selectMoves to filter for the variant,
  returns the data shape per spec §8 (or null when NEXT_MOVE has
  no eligible move). Returns bill_to_customer_id alongside the
  data so FU-035's cascade resolver has the key it needs.

- render-bulk-delivery-orders.js: loops over order ids, accumulates
  rendered docs + skipped ids, renders one multi-page PDF buffer
  via React-PDF's renderToBuffer. Catches per-order fetch failures
  and skips the offending load rather than failing the entire bulk.

The FU-035 hook (per-doc sectionConfig from a customer-aware
resolver) is left as a commented stub on the renderer's loop body
so the integration is mechanical when that FU lands.

Refs: FU-093

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: API endpoint

**Files:**
- Create: `pages/api/tenant/loads/bulk-print.js`

- [ ] **Step 1: Write `pages/api/tenant/loads/bulk-print.js`**

```js
import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';
import { renderBulkDeliveryOrdersPdf } from '../../../../lib/pdf/render-bulk-delivery-orders';
import { isValidDocumentType } from '../../../../lib/constants/document-types';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (
    !requirePermission(
      ctx,
      [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
      res
    )
  ) {
    return;
  }

  const { ids, variant } = req.body || {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (ids.some((id) => typeof id !== 'string' || id.length === 0)) {
    return res.status(400).json({ error: 'ids must contain non-empty strings' });
  }
  if (!isValidDocumentType(variant)) {
    return res.status(400).json({ error: `invalid variant: ${variant}` });
  }
  // Allow only the delivery_order_* variants; future doc types
  // bound to this endpoint would be added explicitly.
  if (!variant.startsWith('delivery_order_')) {
    return res.status(400).json({ error: `unsupported variant for this endpoint: ${variant}` });
  }

  const svc = getServiceClient();

  try {
    const { buffer, skipped } = await renderBulkDeliveryOrdersPdf(
      svc,
      ids,
      ctx.tenantId,
      variant
    );

    if (buffer === null) {
      return res.status(422).json({
        error: 'No printable loads',
        skipped,
        skippedCount: skipped.length,
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="delivery-orders-${variant}-${Date.now()}.pdf"`
    );
    res.setHeader('X-Skipped-Count', String(skipped.length));
    if (skipped.length > 0) {
      res.setHeader('X-Skipped-Load-Ids', skipped.join(','));
    }
    return res.send(buffer);
  } catch (e) {
    console.error('bulk-print failed:', e);
    return res.status(500).json({ error: e.message || 'Render failed' });
  }
}
```

- [ ] **Step 2: Verify the route compiles**

`preview_logs` should show `✓ Compiled /api/tenant/loads/bulk-print` after the next request to the route or after the next dev-server pass. No runtime test until the bulk-bar wires up to it.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/loads/bulk-print.js

git commit -m "$(cat <<'EOF'
feat(api): bulk-print endpoint for Delivery Orders (FU-093)

POST /api/tenant/loads/bulk-print
Body: { ids: string[], variant: 'delivery_order_full' | 'delivery_order_next_move' }
Permission: DISPATCHING | ORDER_ENTRY | ALL

Returns:
- 200 application/pdf — buffer of multi-page Delivery Order PDF
  Headers: X-Skipped-Count (always), X-Skipped-Load-Ids (when nonzero)
- 400 if ids invalid or variant invalid/unsupported
- 422 if every load was skipped (NEXT_MOVE with all completed)
- 500 on render failure

Validates variant against the document-types registry; rejects
non-delivery_order variants explicitly so future document types
can be added with deliberate wiring rather than implicit acceptance.

Refs: FU-093

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Bulk-bar UI

**Files:**
- Modify: `components/dispatcher/BulkActionBar.js` — change Print menu item from `onClick: handleStub` to `hasPopover: true`; add `PrintForm` component.

- [ ] **Step 1: Find the Print menu entry and the popover-render switch**

```bash
```

Read `components/dispatcher/BulkActionBar.js` to confirm:
- Line ~172: `{ key: 'print', label: 'Print', icon: Printer, onClick: () => handleStub('Print') }`
- The conditional render that maps `hasPopover: true` items to their popover bodies (look for the existing `equipment` popover binding around line 261).

- [ ] **Step 2: Replace the Print menu entry**

Find:

```js
    { key: 'print', label: 'Print', icon: Printer, onClick: () => handleStub('Print') },
```

Replace with:

```js
    { key: 'print', label: 'Print', icon: Printer, hasPopover: true },
```

- [ ] **Step 3: Wire `PrintForm` into the popover render switch**

Find the `equipment` popover binding (around line 261, looks like):

```jsx
            <EquipmentInfoForm onSubmit={applyAndClose} />
```

Add a sibling block for `print` that renders `<PrintForm />` when the active popover key is `'print'`. The exact integration depends on how popovers are dispatched in this file — match the existing pattern. If popovers are dispatched via a switch/map keyed on `activeKey`, add a new branch:

```jsx
{activeKey === 'print' && (
  <PrintForm
    selectedIds={Array.from(selectedIds)}
    onClose={() => setActiveKey(null)}
    onFlash={onFlash}
  />
)}
```

(Use the existing prop names — `selectedIds`, `setActiveKey`, `onFlash` — from the surrounding code; substitute exact names after reading.)

- [ ] **Step 4: Add the `PrintForm` component near the bottom of `BulkActionBar.js`**

Place after the existing form components (e.g., after `EquipmentInfoForm`):

```jsx
function PrintForm({ selectedIds, onClose, onFlash }) {
  const [busy, setBusy] = useState(false);

  async function handlePrint(variant) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/tenant/loads/bulk-print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, variant }),
      });
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          errMsg = body.error || errMsg;
        } catch (_) {}
        onFlash?.(`Print failed: ${errMsg}`, 'error');
        setBusy(false);
        return;
      }
      const skippedCount = parseInt(res.headers.get('X-Skipped-Count') || '0', 10);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Revoke on a delay so the new tab has time to load it
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

      if (skippedCount > 0) {
        const printedCount = selectedIds.length - skippedCount;
        onFlash?.(
          `Printed ${printedCount} of ${selectedIds.length} loads (${skippedCount} skipped — no remaining moves)`,
          'warning'
        );
      } else {
        onFlash?.(`Printed ${selectedIds.length} load${selectedIds.length === 1 ? '' : 's'}`, 'success');
      }
      onClose?.();
    } catch (e) {
      onFlash?.(`Print failed: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const buttonClass =
    'w-full text-left rounded-lg border border-gray-300 dark:border-slate-600 ' +
    'bg-white dark:bg-slate-900 px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

  return (
    <div className="flex flex-col gap-2 p-2 min-w-[260px]">
      <div className="text-[11px] font-medium text-gray-600 dark:text-slate-300">
        Print which?
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => handlePrint('delivery_order_full')}
        className={buttonClass}
      >
        <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
          Full Delivery Order
        </div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
          Entire routing across all moves
        </div>
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => handlePrint('delivery_order_next_move')}
        className={buttonClass}
      >
        <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
          Next Move Only
        </div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
          Just the upcoming non-completed move
        </div>
      </button>
      {busy ? (
        <div className="text-[11px] text-gray-500 dark:text-slate-400 italic mt-1">
          Generating PDF…
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Verify the dev server compiles**

`preview_logs` should show `✓ Compiled` after the BulkActionBar edit. No errors.

- [ ] **Step 6: Commit**

```bash
git add components/dispatcher/BulkActionBar.js

git commit -m "$(cat <<'EOF'
feat(bulk-bar): wire Print to bulk Delivery Order endpoint (FU-093)

The Print menu item changes from `onClick: handleStub('Print')` (which
showed a "coming soon" toast) to `hasPopover: true`. The new PrintForm
component shows two buttons:

- Full Delivery Order: entire routing across all moves
- Next Move Only: just the upcoming non-completed move

Each button POSTs to /api/tenant/loads/bulk-print with the variant,
opens the returned PDF blob in a new tab via createObjectURL +
window.open, and surfaces a success / partial-skip / error toast
based on response status + X-Skipped-Count header.

Resolves: FU-093

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verification + ledger update

**Files:**
- Touch: none (verification + ledger only)

- [ ] **Step 1: Dispatch a static-verification subagent**

Spawn an Explore subagent with this brief:

```
Verify FU-093 — bulk-print Delivery Order feature.

1. Confirm registries:
   - lib/constants/document-types.js exports DOCUMENT_TYPES with two
     entries (delivery_order_full, delivery_order_next_move) plus
     getDocumentType + isValidDocumentType.
   - lib/constants/document-sections.js exports DELIVERY_ORDER_SECTIONS
     with 12 entries; move_block, load_metadata, footer have
     toggleable: false; signature_block + barcode have
     defaultVisible: false.

2. Confirm helper: lib/pdf/select-moves.js exports selectMoves; full
   returns sorted moves; next_move skips completed/cancelled and
   returns null when nothing eligible.

3. Confirm tests pass:
   node --test tests/document-types-constants.test.mjs
   node --test tests/document-sections-constants.test.mjs
   node --test tests/select-moves.test.mjs
   All three suites should pass with 0 failures.

4. Confirm composer + sections:
   - components/pdf/DeliveryOrderTemplate.js imports all 11 sections
     from components/pdf/sections/.
   - Each section file exists and exports a default function.
   - DeliveryOrderTemplate uses computeVisibility from the section
     registry.

5. Confirm renderer:
   - lib/pdf/render-delivery-order.js fetches orders + moves +
     events; returns the data shape with bill_to_customer_id at the
     top level (FU-035 cascade hook).
   - lib/pdf/render-bulk-delivery-orders.js loops, accumulates
     skipped, returns { buffer, skipped }.

6. Confirm endpoint: pages/api/tenant/loads/bulk-print.js validates
   ids + variant, calls renderBulkDeliveryOrdersPdf, returns 200 +
   PDF or 4xx/5xx.

7. Confirm bulk-bar wiring: BulkActionBar.js Print menu item is
   hasPopover: true; new PrintForm component is present with the
   two variant buttons; PrintForm uses fetch + URL.createObjectURL +
   window.open.

8. Build check: preview_logs (serverId from preview_list) shows
   ✓ Compiled with no errors related to any of the new files.

Report PASS/FAIL per check. Under 350 words.
```

Expected: subagent returns all checks PASS.

- [ ] **Step 2: Run dd-qa**

Invoke the dd-qa skill. Anticipated:
- Field Consistency: N/A (no orders columns added).
- Enum & Reference Data: N/A.
- API Endpoint Shape: pass (new endpoint validates inputs, returns documented shape).
- Routing Logic: N/A.
- UI Pattern Compliance: pass (PrintForm uses standard Tailwind classes; popover follows the existing equipment-form pattern; no overflow-hidden introduced).

Address any issue surfaced. Likely none.

- [ ] **Step 3: Manual browser test (user does this)**

The user, with a real dispatcher session:
1. Opens dispatcher
2. Selects 1-3 loads
3. Clicks Print in the bulk-bar
4. Picks "Full Delivery Order" — confirms PDF opens in a new tab with one page per load, full routing visible
5. Closes that tab, picks "Next Move Only" — confirms PDF shows only one move per load (or fewer pages if some loads have no eligible move + a yellow toast about skipped loads)

If anything looks wrong, report and fix; if good, proceed.

- [ ] **Step 4: Update FU-093 in followups.md**

Move the FU-093 entry from "Open" to "Recently resolved" under `## 2026-04-26`. Match the existing entry format:

```markdown
### FU-093: [bulk-bar] Wire Print stub
- **Resolved:** 2026-04-26 in `<sha>` — bulk-bar Print now generates a multi-page Delivery Order PDF (one page per load) in two variants: FULL (entire routing) and NEXT_MOVE (upcoming non-completed move). Section-based React-PDF composer in `components/pdf/DeliveryOrderTemplate.js` driven by registries in `lib/constants/document-{types,sections}.js`; per-tenant + per-customer template overrides plug in cleanly when FU-035 (Document Designer) ships. Endpoint `/api/tenant/loads/bulk-print` validates inputs, returns PDF buffer with X-Skipped-Count header. ~900 LoC across 22 files; spec at `docs/superpowers/specs/2026-04-26-bulk-print-delivery-order-design.md`.
```

- [ ] **Step 5: Update MEMORY.md count line**

Bump open count -1, recently-resolved +1. Update HEAD SHA to the latest commit (the bulk-bar wiring commit from Task 7, since that's the one with the `Resolves: FU-093` trailer).

- [ ] **Step 6: Final commit (spec + plan + ledger)**

```bash
git add docs/superpowers/specs/2026-04-26-bulk-print-delivery-order-design.md \
        docs/superpowers/plans/2026-04-26-bulk-print-delivery-order.md
git add -- "C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md"
git add -- "C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/MEMORY.md"

git commit -m "$(cat <<'EOF'
docs(fu093): spec + plan + ledger update

Companion docs for the bulk-print Delivery Order feature shipped
across the prior 6 commits. Spec walks through the section-based
composer architecture and the FU-035 cascade resolution contract
(customer-specific -> tenant default -> system default). Ledger
moves FU-093 to recently-resolved.

Refs: FU-093

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- §3 document type registry → Task 1 ✓
- §4 section registry + computeVisibility → Task 1 ✓
- §5 section-based composition (composer + 11 section components) → Tasks 3 + 4 ✓
- §6 cascade resolution contract → documented in code comments at Task 5 step 3 (commented FU-035 hook), Task 5 returns `bill_to_customer_id` ✓
- §7 NEXT_MOVE selection → Task 2 ✓
- §8 data fetch shape → Task 5 step 1 ✓
- §9 bulk renderer → Task 5 step 3 ✓
- §10 endpoint → Task 6 ✓
- §11 bulk-bar UI → Task 7 ✓
- §12 error handling → Tasks 6 (server) + 7 (client) ✓
- §13 testing — unit tests in Tasks 1, 2; subagent + manual browser in Task 8 ✓

**Placeholder scan:** Task 7 step 3 says "match the existing pattern" and Task 5 step 2 says "validate column names against schema". These are intentional — the exact integration shape can't be determined without reading the file at the time of the edit, so the engineer is directed to read first. Not "implement later" placeholders.

**Type consistency:** The data shape returned by `fetchDeliveryOrderData` (Task 5) matches what each section component expects (Task 3). `selectMoves` return type matches what the renderer's null-check expects. Endpoint's `variant` validation matches `isValidDocumentType` from Task 1's registry.
