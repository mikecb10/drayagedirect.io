# FU-035-D2: Document Designer — PDF Render Layout Rewrite

**Status:** Design approved 2026-04-26 (brainstorm).
**Tracks:** FU-035-D2. Builds on FU-035-D (registry), FU-035-E (preview), FU-035-F (configuration bar).
**Discovered during:** PortPro screenshot review at end of 2026-04-26 session, deferred from FU-035-D's scope.

## 1. Goal

Make the printed Delivery Order PDF visually match the FU-035-E preview (PortPro layout). After this ships:

- The transient amber banner ("preview reflects upcoming layout") is removed from the preview pane — print and preview render the same structure.
- Customer-saved field toggles take real effect on print (currently many toggles are "soft" and don't change the PDF).
- Tenant company info (logo, address, phone, website) flows from `tenant_settings` to both preview and print.
- Load-level pickup / delivery / return addresses appear at the top of the document, derived from move events.
- Three previously-stubbed PDF section components (CommodityDetails / Signature / Disclaimer) become real renderers.
- Section ordering on print matches the registry order (already correct from FU-035-D's composer rewrite).
- Eight legacy PDF section components (BillTo, EquipmentDetails, etc.) are deleted.

## 2. Scope

### In scope

- **Migration 110** to add `tenant_settings` columns: `address_line1`, `address_line2`, `city`, `state`, `zip`, `phone`, `website`.
- **Data fetcher** (`lib/pdf/render-delivery-order.js`) extended to:
  - Pull tenant_settings branding columns into a `tenant_info` payload on the returned doc.
  - Derive load-level pickup/delivery/return location objects from the moves array via a `deriveLoadLevelLocations` helper.
- **Composer** (`components/pdf/DeliveryOrderTemplate.js`) updates:
  - `buildSectionData` populates `address_details.{pickup_location, delivery_location, return_location}` from `doc.load_level_locations`.
  - `buildSectionData` populates `header.tenantInfo` from `doc.tenant_info`.
  - `buildSectionData` populates `commodity_details` (sample-data only — no real source yet), `signature` (empty fields for paper-signing), `disclaimer` (from `cfg.disclaimer` if present).
  - `colors` from `extractColors(cfg)` threaded through `renderSection` to each section component.
- **Three real PDF section components** (replace stubs):
  - `CommodityDetails.js` — 5-col table with accent header.
  - `Signature.js` — 5-field signature block at bottom (Print Name / Receiver Sig / Time In / Time Out / Date).
  - `Disclaimer.js` — italicized footer text.
- **Existing PDF section components** updated to consume `colors` (Header, AddressDetails, OrderDetails, CommodityDetails, Signature, Disclaimer where applicable).
- **Remove transient banner** from `DocumentPreview.js`.
- **Delete 8 legacy PDF section components.**

### Out of scope (deferred)

- **Real commodity data sourcing** — `commodities` table doesn't exist; CommodityDetails renders sample/empty values until a future FU adds the data.
- **Real signature image upload** — POD work / FU-035-H4. Signature renders empty signature lines for paper-signing in v1.
- **Disclaimer rich-text editor + content storage** — FU-035-G. Disclaimer renders text from `section_config.disclaimer.text` if set; default empty.
- **Watermark for draft state** — FU-035-G.
- **Per-doc-type label remap** ("CUSTOMER" vs "Bill To") — FU-035-H1.
- **Other doc types** (Invoice, RateCon, POD, etc.) — FU-035-H1+.

## 3. Migration 110: tenant_settings branding columns

`supabase/migrations/110_tenant_settings_branding.sql`:

```sql
-- 110_tenant_settings_branding.sql
-- Adds branding columns to tenant_settings for printed-document headers.
-- All columns nullable; tenants can populate via a future Company Info settings page.

BEGIN;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

Idempotent via `IF NOT EXISTS`. No data migration needed — new columns default to NULL.

## 4. Data fetcher: tenant_info + load-level locations

### 4a. Tenant info fetch

In `lib/pdf/render-delivery-order.js`, in `fetchDeliveryOrderData`, alongside the existing `tenants.name` query, fetch `tenant_settings`:

```js
// Existing tenant fetch:
const { data: tenant } = await svc
  .from('tenants').select('name').eq('id', tenantId).maybeSingle();

// NEW: tenant_settings branding fetch
const { data: settings } = await svc
  .from('tenant_settings')
  .select(`
    company_display_name, logo_small_url, logo_large_url,
    address_line1, address_line2, city, state, zip, phone, website
  `)
  .eq('tenant_id', tenantId)
  .maybeSingle();
```

Compose `tenant_info` for the returned doc:

```js
const tenant_info = {
  logo_url: settings?.logo_large_url || settings?.logo_small_url || null,
  address: [
    settings?.address_line1,
    settings?.address_line2,
    [settings?.city, settings?.state, settings?.zip].filter(Boolean).join(', '),
  ].filter(Boolean).join(', ') || null,
  phone: settings?.phone || null,
  website: settings?.website || null,
};
```

### 4b. Load-level location derivation

Helper function in the same file (top-level, not inside fetchDeliveryOrderData):

```js
/**
 * Derive load-level pickup / delivery / return location objects from the
 * full event sequence across all moves. Used by the PDF composer to render
 * a 3-or-4-col address summary at the top of the document, mirroring
 * PortPro's DO layout.
 *
 * Rules (match drayage industry conventions):
 *   - load pickup    = first event with event_type === 'pull'
 *   - load delivery  = last event with event_type === 'deliver'
 *   - load return    = last event with event_type === 'return'
 *   - any of the three may be null if no matching event exists yet
 *     (typical for a new load with no events scheduled, or a one-way
 *     drayage with no return leg)
 */
function deriveLoadLevelLocations(moves) {
  const allEvents = (moves || [])
    .flatMap((m) => m.events || [])
    .sort((a, b) => a.sequence - b.sequence);

  const orgFromEvent = (e) => {
    if (!e || !e.location) return null;
    return {
      name: e.location.name || null,
      address_line1: null, // event row doesn't carry street address; future enrichment
      city: e.location.city || null,
      state: e.location.state || null,
      zip: null,
    };
  };

  const firstPull = allEvents.find((e) => e.event_type === 'pull');
  const lastDeliver = [...allEvents].reverse().find((e) => e.event_type === 'deliver');
  const lastReturn = [...allEvents].reverse().find((e) => e.event_type === 'return');

  return {
    pickup_location: orgFromEvent(firstPull),
    delivery_location: orgFromEvent(lastDeliver),
    return_location: orgFromEvent(lastReturn),
  };
}
```

### 4c. Returned doc shape additions

`fetchDeliveryOrderData` returns these new keys at the top level:

```js
return {
  // ... existing keys ...
  tenant_info,             // NEW (§4a)
  load_level_locations: deriveLoadLevelLocations(selectedMoves),  // NEW (§4b)
};
```

## 5. Composer changes (`components/pdf/DeliveryOrderTemplate.js`)

### 5a. `buildSectionData` populates new keys

Update `buildSectionData(doc)`:

```js
return {
  header: {
    tenantName: doc.tenant_name,
    tenantInfo: doc.tenant_info || {},
  },
  delivery_order_details: { /* unchanged */ },
  address_details: {
    customer: doc.bill_to ? { /* unchanged */ } : null,
    pickup_location:   doc.load_level_locations?.pickup_location   || null,
    delivery_location: doc.load_level_locations?.delivery_location || null,
    return_location:   doc.load_level_locations?.return_location   || null,
    appointment_times: { /* unchanged */ },
    is_operational_street_turn: doc.is_operational_street_turn || false,
  },
  order_details: { /* unchanged */ },
  commodity_details: null,  // No real source yet — reads sample only via preview's substitution
  notes: { /* unchanged */ },
  signature: {
    print_name: '',
    signature: '',
    date: '',
    time_in: '',
    time_out: '',
  },
  disclaimer: doc.section_config?.disclaimer?.enabled
    ? { text: doc.section_config.disclaimer.text || '' }
    : null,
};
```

For `commodity_details: null` — PDF render of the section returns null, so commodity table doesn't appear on actual prints. But preview pane uses sample-data so the section IS visible there. Tenants who toggle Commodity Details ON in the editor see it in preview but won't see it on print until a real commodity data source lands. **This is an acceptable preview/print divergence for v1 because Commodity Details defaults OFF and tenants who turn it on for a load-with-no-commodity-table-data shouldn't be surprised — the section just doesn't render.** The amber banner is gone but this specific section legitimately has no PDF data to show.

### 5b. Colors threading

Import + use `extractColors`:

```js
import {
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../../lib/constants/document-sections';
```

In the page-rendering loop:

```js
const { visibility, fields } = computeVisibility(registrySections, cfg);
const colors = extractColors(cfg);
// ... existing code ...
const node = renderSection(sectionId, doc, sectionData, opts, ctx, colors);
```

`renderSection` signature gains `colors`:

```js
function renderSection(sectionId, doc, sectionData, opts, ctx, colors) {
  switch (sectionId) {
    case 'header':
      return <Header /* ... */ opts={opts} colors={colors} />;
    case 'address_details':
      return <AddressDetails data={...} opts={opts} colors={colors} />;
    case 'order_details':
      return <OrderDetails data={...} opts={opts} colors={colors} />;
    case 'commodity_details':
      return <CommodityDetails data={...} opts={opts} colors={colors} />;
    case 'signature':
      return <Signature data={...} colors={colors} />;
    case 'disclaimer':
      return <Disclaimer data={...} colors={colors} />;
    // others unchanged
  }
}
```

DeliveryOrderDetails / Notes / MoveBlock don't visually consume colors right now — the spec leaves them text-defaulted. Easy to extend later if needed.

## 6. New PDF section components

### 6a. `components/pdf/sections/CommodityDetails.js`

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

const COL_ORDER = [
  ['commodity',   'Commodity'],
  ['description', 'Description'],
  ['weight',      'Weight'],
  ['pallets',     'Pallets'],
  ['pieces',      'Pieces'],
];

export default function CommodityDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const cols = COL_ORDER.filter(([key]) => fields[key] !== false);
  if (cols.length === 0) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', backgroundColor: accent }}>
        {cols.map(([key, label]) => (
          <View key={key} style={{ flex: 1, padding: 4 }}>
            <Text style={[typography.label, { color: 'white', fontSize: 8 }]}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', borderBottom: '1pt solid #ccc', borderLeft: '1pt solid #ccc', borderRight: '1pt solid #ccc' }}>
        {cols.map(([key]) => (
          <View key={key} style={{ flex: 1, padding: 4, borderRight: '1pt solid #eee' }}>
            <Text style={typography.value}>{data[key] || '—'}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
```

### 6b. `components/pdf/sections/Signature.js`

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

const SIG_FIELDS = [
  ['print_name', 'Print Name'],
  ['signature',  'Receiver Signature'],
  ['date',       'Date'],
  ['time_in',    'Time In'],
  ['time_out',   'Time Out'],
];

export default function Signature({ data }) {
  if (!data) return null;
  return (
    <View style={{ marginTop: 18, paddingTop: 10, borderTop: '1pt solid #ccc' }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        {SIG_FIELDS.map(([key, label]) => (
          <View key={key} style={{ flex: 1, minWidth: 100 }}>
            <View style={{ height: 18, borderBottom: '1pt solid #444' }}>
              <Text style={typography.value}>{data[key] || ''}</Text>
            </View>
            <Text style={[typography.label, { fontSize: 7, marginTop: 2 }]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
```

### 6c. `components/pdf/sections/Disclaimer.js`

```jsx
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

export default function Disclaimer({ data }) {
  if (!data || !data.text) return null;
  return (
    <View style={{ marginTop: 12, paddingTop: 8, borderTop: '1pt solid #eee' }}>
      <Text style={[typography.muted, { fontSize: 8, fontStyle: 'italic' }]}>{data.text}</Text>
    </View>
  );
}
```

## 7. Existing PDF section components — colors pass-through

### 7a. `Header.js`

The accent-banded "DELIVERY ORDER" title on the right currently uses `typography.h1`. Add a colored band wrapper with `style={{ backgroundColor: accent }}`. Match the HTML preview's structure:

```jsx
{/* old */}
<Text style={typography.h1}>{title}</Text>

{/* new */}
<View style={{ backgroundColor: accent, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 2 }}>
  <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
    {title}{ctx.subtitle ? ` — ${ctx.subtitle}` : ''}
  </Text>
</View>
```

The Header signature gains `colors` prop. Existing fields-driven gating stays.

### 7b. `AddressDetails.js`

Each address block has a header strip. Currently those are plain text. Switch to accent-color band like the HTML preview:

```jsx
{/* old */}
<Text style={typography.label}>{label}</Text>

{/* new */}
<View style={{ backgroundColor: accent, paddingHorizontal: 4, paddingVertical: 2 }}>
  <Text style={{ color: 'white', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase' }}>{label}</Text>
</View>
```

### 7c. `OrderDetails.js`

Section heading "Order Details" gets `colors.text` applied via inline style. Body remains text-default.

## 8. Preview pane: remove transient banner

In `components/settings/document-designer/preview/DocumentPreview.js`, delete the amber banner block:

```jsx
{/* DELETE: */}
<div className="text-[11px] px-3 py-1.5 rounded bg-amber-50 ...">
  Preview reflects the upcoming document layout...
</div>
```

The preview now visually matches the print, so the disclaimer is no longer needed.

## 9. Delete legacy components

Verify no remaining imports first:

```bash
grep -rn "from.*sections/\(BillTo\|CustomerContact\|EquipmentDetails\|HazmatDetails\|Instructions\|AppointmentDetails\|LoadMetadata\|SignatureBlock\)" components/ pages/ lib/
```

Expected: only `DeliveryOrderTemplate.js` should match (and only because Task 9 of FU-035-D removed live wiring; lingering imports may exist if any). After confirming, delete:

```
components/pdf/sections/BillTo.js
components/pdf/sections/CustomerContact.js
components/pdf/sections/EquipmentDetails.js
components/pdf/sections/HazmatDetails.js
components/pdf/sections/Instructions.js
components/pdf/sections/AppointmentDetails.js
components/pdf/sections/LoadMetadata.js
components/pdf/sections/SignatureBlock.js
```

If any other file imports them, remove that import line in the same task.

## 10. Permissions

Unchanged. The `bulk-print` API endpoint and the `/api/tenant/document-templates` endpoints already handle permissions.

## 11. Error handling

| Case | Behavior |
|---|---|
| `tenant_settings` row doesn't exist for tenant | All branding fields null; preview/print fall back to placeholder strings (`"Your Company"` etc.) — no errors. |
| `tenant_settings` row exists but new columns are NULL | Same as above — graceful degradation. |
| Load has no events yet | `load_level_locations` returns `{ pickup: null, delivery: null, return: null }` → AddressDetails section renders only the customer block (or hides if no customer either). |
| Load has events but no `pull`/`deliver`/`return` types | Same as above — those slots null, only customer renders. |
| One-way drayage (no return leg) | `return_location` null → 3-col layout instead of 4-col. AddressDetails component handles variable column count. |
| Multi-move with multiple `pull` events (re-positioning) | First pull wins per the rule. Acceptable — represents "where the load originally came from". |
| Migration 110 runs on a DB that already has those columns | `IF NOT EXISTS` makes it a no-op. |

## 12. Testing

**Unit tests** — extend `tests/document-sections-constants.test.mjs` or add `tests/derive-load-level-locations.test.mjs`:

```js
test('deriveLoadLevelLocations finds first pull / last deliver / last return', () => {
  const moves = [
    { events: [
      { sequence: 1, event_type: 'pull',    location: { name: 'PORT A', city: 'Newark', state: 'NJ' } },
      { sequence: 2, event_type: 'deliver', location: { name: 'WAREHOUSE A', city: 'Edison', state: 'NJ' } },
    ] },
    { events: [
      { sequence: 3, event_type: 'pull',    location: { name: 'WAREHOUSE A', city: 'Edison', state: 'NJ' } },
      { sequence: 4, event_type: 'deliver', location: { name: 'CUSTOMER B', city: 'Trenton', state: 'NJ' } },
      { sequence: 5, event_type: 'return',  location: { name: 'PORT A', city: 'Newark', state: 'NJ' } },
    ] },
  ];
  const result = deriveLoadLevelLocations(moves);
  assert.equal(result.pickup_location.name, 'PORT A');      // first pull
  assert.equal(result.delivery_location.name, 'CUSTOMER B'); // last deliver
  assert.equal(result.return_location.name, 'PORT A');       // last return
});
```

Plus tests for empty events, no return leg, missing locations.

**Live verification** — manual:
- Migration 110 applied in Supabase SQL Editor.
- Open `/settings/document-designer/delivery_order_full`, verify preview pane no longer shows the amber banner.
- Bulk-print a real Delivery Order PDF with 1+ moves. Verify:
  - Header has tenant logo + name + address + phone + website (assuming tenant_settings is populated; otherwise just name).
  - 5-field Delivery Order Details row appears.
  - 3- or 4-col address blocks at top — Customer + Pickup + Delivery + Return per the load's events.
  - Move Events section appears below address blocks (multi-move detail).
  - Order Details 3-col grid with the 19 toggleable fields.
  - Commodity Details: not visible (no data).
  - Signature block: 5 empty signature lines at bottom.
  - Disclaimer: not visible (no content).
  - Footer always-on at the very bottom.
- Toggle Order Details > Seal # off in editor, save, re-print. Seal # row missing from PDF.
- Change accent color in editor, save, re-print. Header band + table headers + address block strips reflect the new color.

## 13. File impact

| File | Action | LoC |
|---|---|---|
| `supabase/migrations/110_tenant_settings_branding.sql` | New | ~20 |
| `lib/pdf/render-delivery-order.js` | Modify (tenant_settings fetch + deriveLoadLevelLocations + new doc keys) | +60 |
| `components/pdf/DeliveryOrderTemplate.js` | Modify (buildSectionData + colors threading) | +30 |
| `components/pdf/sections/CommodityDetails.js` | Replace stub | +50 (net +42) |
| `components/pdf/sections/Signature.js` | Replace stub | +30 (net +18) |
| `components/pdf/sections/Disclaimer.js` | Replace stub | +20 (net +12) |
| `components/pdf/sections/Header.js` | Modify (colors-banded title) | +10 |
| `components/pdf/sections/AddressDetails.js` | Modify (colors on block strips) | +5 |
| `components/pdf/sections/OrderDetails.js` | Modify (colors.text on heading) | +5 |
| `components/settings/document-designer/preview/DocumentPreview.js` | Remove banner | -3 |
| 8 legacy section components | Delete | -250 |
| `tests/derive-load-level-locations.test.mjs` | New | +60 |

**Total:** 1 migration, 9 modified files, 8 deleted, 1 new test file. **~37 net LoC**, with -250 from deletions and +287 from additions. ~5-6 hr realistic.

## 14. Risk and rollback

**Risks:**
1. **Migration 110 timing.** Implementation can land before migration; the data fetcher's SELECT will fail or return null for the new columns. Mitigation: implement migration first and apply BEFORE landing the data fetcher changes.
2. **Tenants without `tenant_settings` rows.** `.maybeSingle()` returns null; downstream code uses `?.` chaining and falls back to placeholders. Tested.
3. **Loads with unusual event sequences.** First-pull / last-deliver / last-return rules cover the common drayage patterns but may produce surprising output for edge cases (e.g., a load with only `drop`/`hook` events and no `pull`/`deliver`). Mitigation: AddressDetails section handles null fields gracefully (just doesn't render that block).
4. **Visual regression on existing tenant PDFs.** Tenants who have already saved customized templates will see their preferences reflected on print starting now (previously many were soft-toggled). This is a positive change but represents user-visible behavior change. Mitigation: tenants can re-toggle anything they don't want. The change is in the direction of "things finally work as the editor implied".
5. **Color contrast issues on prints.** A tenant could pick a yellow accent color and have white text on yellow header bands → unreadable. Out-of-scope to validate accessibility; product decision is "user picks their own colors and owns their choices for v1". Future FU could add a contrast warning.

**Rollback:** revert the commit. Migration 110 is non-destructive (only ADDs columns); no down-migration needed unless a tenant has populated the new columns AND we want to preserve those values (unlikely in the immediate-rollback case). The 8 deleted legacy components can be restored from git history if any remaining import surfaces.

## 15. Forward path

After D2 ships:
- **F-followup**: real address/phone/website inputs in a Company Info settings page, so tenants can populate tenant_settings.address_line1 etc. via UI rather than SQL. Small FU.
- **FU-035-G**: Watermark + Disclaimer rich-text editor. Wires `section_config.watermark` (toggle + text) and `section_config.disclaimer` (HTML rich text) into the PDF render path established here.
- **FU-035-H1+**: Other doc types (Invoice, RateCon, POD, Statement, etc.). Each ships as its own per-doc-type registry + section components + composer + data fetcher.
- **Real commodity data sourcing**: when a `commodities` table exists, hook it into the data fetcher.
- **POD signature image upload**: FU-035-H4 territory.

E + F + D2 together complete the core PortPro-mirror DO experience. The Document Designer feature is feature-complete for Delivery Order after D2 ships.
