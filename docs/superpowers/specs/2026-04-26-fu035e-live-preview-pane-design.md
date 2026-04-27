# FU-035-E: Document Designer — Live Preview Pane Design

**Status:** Design approved 2026-04-26 (brainstorm).
**Tracks:** FU-035-E. Builds on FU-035-D (hierarchical sections + nested-toggle UI).
**Discovered during:** PortPro screenshot review at end of 2026-04-26 session, deferred from FU-035-D's scope.

## 1. Goal

Add a live HTML preview pane alongside the section toggle editor at `/settings/document-designer/[type]`. As tenants toggle sections / fields, the preview re-renders instantly to show what the document will look like. Mirrors PortPro's side-by-side editor + preview layout.

After this ships:
- Every active editor (tenant default + each expanded customer override) has a side-by-side preview pane.
- Preview is HTML simulacrum (not actual PDF) — fast, interactive, no debounce needed.
- Preview layout mirrors PortPro's eventual DO PDF (3-col addresses, Order Details grid, etc.) — the *target* for FU-035-D2's PDF rewrite.
- The actual printed PDF temporarily diverges from the preview (still uses pre-D2 layout). D2 brings them into sync.

## 2. Scope

### In scope (this session)

- New directory `components/settings/document-designer/preview/` with HTML preview components (one per section + an orchestrator).
- New module `lib/document-designer/sample-data.js` providing `ABC123`-style placeholder data shaped like `buildSectionData(doc)` from the composer.
- Refactor `components/settings/document-designer/TemplateEditor.js` to wrap toggles + preview in a side-by-side flex container.
- Preview consumes the same `{ visibility, fields }` shape `computeVisibility` returns — registry is single source of truth.
- Sticky preview pane scroll behavior.
- Mobile fallback: stack vertically below `lg:` breakpoint.

### Out of scope (deferred)

- **PDF render layout** (FU-035-D2): the actual printed PDF stays on its pre-D2 layout. Preview and PDF print diverge until D2 lands.
- **Customer dropdown / Doc Type dropdown** above the editor (FU-035-F).
- **Accent / Text color pickers** (FU-035-F).
- **Real tenant info wiring** — preview uses placeholder strings (`"Your Company"`, sample address). Real tenant info comes in F.
- **"Save as new Configuration"** named-config feature (FU-035-G).
- **Watermark / Disclaimer rich-text editor** content (FU-035-G).
- **Per-customer label remap** (e.g., "CUSTOMER" vs "Bill To" — F or H1).
- **Indeterminate parent toggle state** (still strict on/off from D).

## 3. Architecture

```
pages/settings/document-designer/[type].js  (unchanged)
└── <TemplateEditor template={...}>          (refactored to wrap both halves)
    ├── Internal state: { visibility, fields, busy, collapsed }   (unchanged from D)
    ├── <flex container>
    │   ├── Left 40% — existing toggle list (unchanged)
    │   └── Right 60% — <DocumentPreview visibility={...} fields={...} sections={...} />
    └── <button row>  — Save / Reset / Delete (unchanged)
```

The preview is a sibling of the toggle list, sharing the editor's local state. State doesn't lift to the page; the page is unchanged.

`<DocumentPreview>` orchestrates:
1. Reads sample data from `lib/document-designer/sample-data.js`.
2. Iterates the section registry in order.
3. For each section where `visibility[id] === true`, renders the corresponding preview component, passing `data` (subset from sample-data) and `opts.fields` (computed from `fields[id]`).
4. Skips sections where `visibility[id] === false`.

Preview components are pure: `(data, opts) => JSX`. No state, no effects.

## 4. Render strategy

**Parallel HTML preview components, not polymorphic with PDF.** Each section's PDF component (in `components/pdf/sections/`) gets a sibling HTML preview component (in `components/settings/document-designer/preview/`). Same input contract (`data`, `opts.fields`), different render output.

**Why:** when FU-035-D2 rewrites the PDF layout, the preview components stay untouched. Clean separation between PDF render concerns and preview render concerns. Each preview component is small (30-80 LoC); duplication is tolerable.

**Why not polymorphic** (single component with `renderTarget: 'pdf' | 'html'` switch): requires building a primitive abstraction layer mapping `<View>` ↔ `<div>`, `<Text>` ↔ `<span>`, etc. Adds complexity. When D2 changes the PDF layout, polymorphic components have to handle both render targets in the same file. Awkward.

## 5. The preview component contract

Every preview component:
- Default-exports a function component named `<Section>Preview`.
- Takes `{ data, opts }` props matching the same shape the PDF component takes.
- Returns JSX of plain HTML elements styled with Tailwind.
- Reads `opts.fields?.[fieldId]` with default-true semantics for unspecified fields.
- Returns `null` if no data renders (matches PDF component behavior).

Example signatures:

```jsx
function HeaderPreview({ data, opts }) { ... }
function DeliveryOrderDetailsPreview({ data, opts }) { ... }
function AddressDetailsPreview({ data, opts }) { ... }
function OrderDetailsPreview({ data, opts }) { ... }
function CommodityDetailsPreview({ data, opts }) { ... }
function NotesPreview({ data, opts }) { ... }
function SignaturePreview({ data, opts }) { ... }
function DisclaimerPreview({ data, opts }) { ... }
```

Stub components from D (`CommodityDetails`, `Signature`, `Disclaimer`) become real here on the preview side — they render content. Their PDF counterparts stay stubbed until D2.

## 6. The orchestrator: `<DocumentPreview>`

```jsx
import sampleData from '../../../../lib/document-designer/sample-data';
import HeaderPreview              from './HeaderPreview';
import DeliveryOrderDetailsPreview from './DeliveryOrderDetailsPreview';
import AddressDetailsPreview      from './AddressDetailsPreview';
import OrderDetailsPreview        from './OrderDetailsPreview';
import CommodityDetailsPreview    from './CommodityDetailsPreview';
import NotesPreview               from './NotesPreview';
import SignaturePreview           from './SignaturePreview';
import DisclaimerPreview          from './DisclaimerPreview';

const PREVIEW_BY_SECTION_ID = {
  header:                 HeaderPreview,
  delivery_order_details: DeliveryOrderDetailsPreview,
  address_details:        AddressDetailsPreview,
  order_details:          OrderDetailsPreview,
  commodity_details:      CommodityDetailsPreview,
  notes:                  NotesPreview,
  signature:              SignaturePreview,
  disclaimer:             DisclaimerPreview,
  // move_events / barcode / footer intentionally absent — preview pane is a one-page snapshot, not a full multi-page render.
};

export default function DocumentPreview({ visibility, fields, sections }) {
  return (
    <div className="bg-white rounded-lg shadow-lg ring-1 ring-gray-200 p-8 text-sm text-gray-900">
      {sections.map((s) => {
        if (!visibility[s.id]) return null;
        const Component = PREVIEW_BY_SECTION_ID[s.id];
        if (!Component) return null;
        const data = sampleData[s.id];
        const opts = { fields: fields[s.id] || {} };
        return <Component key={s.id} data={data} opts={opts} />;
      })}
    </div>
  );
}
```

`move_events`, `barcode`, `footer` don't render in the preview pane (they'd be visual noise — preview is a one-page snapshot, not a multi-page document). The toggles still exist in the editor; they just don't show up in the preview. Acceptable.

## 7. Sample data shape

`lib/document-designer/sample-data.js`. **Important — keep this shape mirrored against `buildSectionData(doc)` in `components/pdf/DeliveryOrderTemplate.js`.** When the composer changes its data shape (likely in D2), sample-data.js needs to update in the same commit. Add a header comment at the top of the file: `// Mirror this shape against buildSectionData() in components/pdf/DeliveryOrderTemplate.js — drift here means preview shows different content than print.`

```js
const sampleData = {
  header: {
    tenantName: 'Your Company',
    tenantInfo: {
      logo_url: null,            // no logo by default — toggle on demonstrates the slot
      address: '123 Main Street, City, ST 12345, USA',
      phone: '555-555-1212',
      website: 'www.yourcompany.com',
    },
  },
  delivery_order_details: {
    delivery_order_number: 'ABC123',
    pickup_number: 'ABC123',
    driver_name: 'John Driver',
    delivery_appointment: 'ABC123',
    reference_number: 'ABC123',
  },
  address_details: {
    customer: {
      name: 'SAMPLE CUSTOMER',
      address_line1: '1210 Corbin Street',
      city: 'Elizabeth',
      state: 'NJ',
      zip: '07201',
      phone: '555-123-4567',
      email: 'customer@example.com',
    },
    pickup_location: {
      name: 'SAMPLE PICKUP',
      address_line1: '1210 Corbin Street',
      city: 'Elizabeth',
      state: 'NJ',
      zip: '07201',
    },
    delivery_location: {
      name: 'SAMPLE DELIVERY',
      address_line1: '1210 Corbin Street',
      city: 'Elizabeth',
      state: 'NJ',
      zip: '07201',
    },
    return_location: {
      name: 'SAMPLE RETURN',
      address_line1: '1210 Corbin Street',
      city: 'Elizabeth',
      state: 'NJ',
      zip: '07201',
    },
    appointment_times: { pickup: 'MONTH DD, YYYY h:mm', delivery: 'MONTH DD, YYYY h:mm' },
    is_operational_street_turn: false,
  },
  order_details: {
    reference_number: 'ABC123',
    booking_bl: 'ABC123',
    mbol: 'ABC123',
    hbol: 'ABC123',
    container_number: 'ABC123',
    container_size: 'ABC123',
    container_type: 'ABC123',
    chassis_number: 'ABC123',
    chassis_size: 'ABC123',
    chassis_type: 'ABC123',
    chassis_owner: 'ABC123',
    steamship_line: 'ABC123',
    seal: 'ABC123',
    hazmat: 'ABC123',
    pickup_number: 'ABC123',
    pull_container_date: 'ABC123',
    return_container_date: 'ABC123',
    last_free_day: 'ABC123',
    per_diem_free_day: 'ABC123',
  },
  commodity_details: {
    commodity: 'ABC123',
    description: 'ABC123',
    weight: 'ABC123 LBS',
    pallets: 'ABC123',
    pieces: 'ABC123',
  },
  notes: {
    driver_notes:   'SAMPLE driver notes',
    yard_notes:     'SAMPLE yard notes',
    customer_notes: 'SAMPLE customer notes',
    billing_notes:  'SAMPLE billing notes',
    load_notes:     'SAMPLE load notes',
  },
  signature: {
    print_name: 'ABC123',
    signature: 'ABC123',
    time_in: 'MONTH DD, YYYY h:mm',
    time_out: 'MONTH DD, YYYY h:mm',
    date: 'MONTH DD, YYYY',
  },
  disclaimer: {
    text: 'Disclaimer',
  },
};

export default sampleData;
```

Tenant info is hardcoded `"Your Company"` for now. Real tenant info wiring (`/api/tenant/me`) is FU-035-F's job.

## 8. PortPro-mirror layout in `<DocumentPreview>`

The preview pane renders a paper-like document with sections in this fixed order:
1. Header (logo + name + address + phone + website on left; document title on right with accent band)
2. Delivery Order Details (5-col flex row: Delivery Order # / Pickup # / Driver / Delivery Appt / Reference #)
3. Address Details (3- or 4-col flex grid of address blocks: Customer / Pickup / Delivery / Return; phone+email row; appointment-times row; street-turn flag)
4. Order Details (3-col label-value grid of all 19 toggleable fields, only rendering the visible ones)
5. Commodity Details (5-col table: Commodity / Description / Weight / Pallets / Pieces)
6. Notes (vertical list of 5 toggleable note types, each with label + body)
7. Signature (signature block at bottom: Print Name / Receiver Signature / Time In / Time Out / Date)
8. Disclaimer (italicized footer text)

Order is fixed in the orchestrator's switch — the registry's `cfg.order` is ignored at this stage (D2 considers reordering).

## 9. Layout details

Side-by-side flex container:
- `.flex.gap-6` at `lg:` breakpoint and above.
- Editor: `lg:w-2/5` (40%).
- Preview: `lg:w-3/5` (60%).
- Below `lg:`: `flex-col`, preview stacks below editor.

Sticky preview:
- `lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto` on the preview container.
- Stays visible as the toggle list scrolls.

Visual:
- White background (`bg-white`), rounded corners (`rounded-lg`), shadow (`shadow-lg`), subtle ring (`ring-1 ring-gray-200`).
- Padding `p-8` inside the preview to feel paper-like.
- Text: `text-sm text-gray-900` (forced black-on-white even in dark mode — a real document is white).

**Transient-state banner.** Above the preview pane (visible until D2 ships), render a small dismissible info banner:

> *Preview reflects the upcoming document layout. Printed PDFs use the current layout until the rendering update ships.*

Styled subtle (`bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200 text-xs px-3 py-1.5 rounded`). Not dismissible — disappears in the same commit that rewrites the PDF layout (D2). Eliminates the "I toggled something but my printed PDF looks different" confusion.

Dark mode:
- Editor side respects `dark:` classes per `dev_dark_mode_convention`.
- Preview side stays light (`bg-white text-gray-900`) — printed documents don't have dark mode.

## 10. Re-render strategy

No debounce. Each toggle change triggers a setState in `TemplateEditor`, which re-renders the editor + the embedded `<DocumentPreview>`. Preview components are cheap pure functions; ~50 toggles + ~10 sections = imperceptible cost.

If perf becomes an issue (it won't at this scale), `React.memo` on individual preview components is a 1-line fix.

## 11. Customer override behavior

Per Q2 (β): every active editor gets side-by-side preview.

- Tenant Default panel: always expanded, always shows side-by-side editor + preview.
- Customer Override accordion items:
  - Collapsed: just the customer name row (existing behavior).
  - Expanded: full TemplateEditor renders, automatically including the side-by-side flex layout with preview.
- Multiple customer overrides can be expanded simultaneously, each with its own preview. The preview pane is always tied to its own editor's local state — no cross-bleed.

This works for free because the preview lives inside `TemplateEditor`. The page-level layout is unchanged.

## 12. Permissions

Unchanged from FU-035-A/B. Page-level gate at `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` already covers preview rendering.

## 13. Error handling

| Case | Behavior |
|---|---|
| Sample data has a typo / missing key | Preview component receives `data = undefined` → `if (!data) return null;` → that section silently doesn't render. Catches typos visually. |
| Section in registry but no preview component (move_events, barcode, footer) | Orchestrator's switch returns null for those. Editor toggles still work; preview just doesn't show that section. |
| `visibility[id]` undefined | `computeVisibility` always populates every section ID, so this shouldn't happen. If it does, falsy → not rendered. |
| `fields[id]` undefined for a section with fields | Preview component reads `opts.fields?.[fieldId] !== false` (default-true). Defaults all visible. |

## 14. Testing

**Unit tests:** none new. Preview components are pure JSX with no logic worth unit-testing in this codebase's testing patterns. The real verification is visual (browser).

**Live verification:**
- Manual browser test by user: navigate to `/settings/document-designer/delivery_order_full`, observe side-by-side layout, toggle a child field on/off, watch preview update instantly.
- Toggle parent section off, verify the section disappears from preview while staying in the editor (greyed children).
- Resize browser to mobile width, verify preview stacks below editor.
- Expand a customer override accordion item, verify it gets its own side-by-side preview.

**Static check:**
- Subagent review that all 8 preview components import correctly, follow the `({ data, opts })` contract, and export defaults.
- Subagent review that DocumentPreview's switch case handles all section IDs.

## 15. File list + LoC estimate

| File | Action | LoC |
|---|---|---|
| `lib/document-designer/sample-data.js` | New | ~80 |
| `components/settings/document-designer/preview/DocumentPreview.js` | New (orchestrator) | ~80 |
| `components/settings/document-designer/preview/HeaderPreview.js` | New | ~50 |
| `components/settings/document-designer/preview/DeliveryOrderDetailsPreview.js` | New | ~40 |
| `components/settings/document-designer/preview/AddressDetailsPreview.js` | New | ~80 |
| `components/settings/document-designer/preview/OrderDetailsPreview.js` | New | ~70 |
| `components/settings/document-designer/preview/CommodityDetailsPreview.js` | New | ~60 |
| `components/settings/document-designer/preview/NotesPreview.js` | New | ~40 |
| `components/settings/document-designer/preview/SignaturePreview.js` | New | ~60 |
| `components/settings/document-designer/preview/DisclaimerPreview.js` | New | ~30 |
| `components/settings/document-designer/TemplateEditor.js` | Modify (wrap with flex + import DocumentPreview) | +30 |

**Total:** 10 new files, 1 modified, ~620 LoC. ~3 hours realistic.

## 16. Risk and rollback

**Risks:**
1. **Preview layout drifts from D2's PDF layout** when D2 ships. Mitigation: when implementing D2, treat the preview HTML components as the spec — D2's React-PDF components should render the same visual structure. Reference the preview file directly in D2's task descriptions (e.g., "OrderDetails.js layout should match OrderDetailsPreview.js").
2. **Long-term component duplication drift.** Every section now has a PDF component AND a preview component (e.g., `OrderDetails.js` + `OrderDetailsPreview.js`). Six months from now, a developer changing one and forgetting the other creates silent visual regressions. Mitigations: (a) extract shared constants — field labels, section ordering — into a constants module both components import, so a label rename touches one file; (b) when D2 ships, audit that PDF components and preview components render the same data shape and same visible labels; (c) consider a smoke test in `tests/` that diffs the strings rendered by each pair (deferred — manual eye-check is fine for v1).
3. **Sample data shape mismatch with PDF data** — preview shows things differently from how the actual print would. Mitigation: sample-data.js mirrors the shape of `buildSectionData(doc)` from `DeliveryOrderTemplate.js`, with a header comment marking the coupling explicitly (see §7). When the composer is updated in D2, the same data flow informs both renders.
4. **Side-by-side breaks at narrow widths.** Mitigation: explicit `flex-col` fallback below `lg:` breakpoint.
5. **Preview pane sticky scroll glitches** when the editor body has horizontally-clipped content (e.g., a long section name). Mitigation: rely on standard Tailwind `sticky top-4` + `max-h-[calc(100vh-2rem)] overflow-y-auto`; test in browser; adjust if jank shows up.
6. **User confusion when printed PDF differs from preview.** Mitigation: transient-state banner above the preview (see §9) explicitly tells the user the preview reflects the upcoming layout and the printed PDF still uses the current one. Banner is removed in the same commit as D2.

**Rollback:** revert the commit. The TemplateEditor refactor falls back to its FU-035-D state (just the toggle list, no preview pane). No data migration involved — preview is purely additive UI.

## 17. Forward path

What's left after E ships, in order of value:
- **F** — Configuration tab + Customer/Doc Type dropdowns + accent/text color pickers. Ties the preview to the chosen template (via dropdown) and applies user-chosen colors. Real tenant info wiring lives here.
- **D2** — PDF render layout rewrite. Brings actual print output into sync with the preview built in E.
- **G** — Watermark + Disclaimer rich-text editor + named "Configurations".
- **H1-H9** — Other doc types (Invoice, Rate Confirmation, POD, etc.). Each gets its own per-doc-type registry + section components + preview components following the same pattern E established.

E + D2 + F together complete the PortPro-mirror Document Designer experience for Delivery Order. H1+ extends the experience to other doc types.
