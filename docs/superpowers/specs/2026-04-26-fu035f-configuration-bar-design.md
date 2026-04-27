# FU-035-F: Document Designer — Configuration Bar (Customer/Doc Type Dropdowns + Colors)

**Status:** Design approved 2026-04-26 (brainstorm).
**Tracks:** FU-035-F. Builds on FU-035-A (foundation), FU-035-B (basic UI), FU-035-D (hierarchical sections), FU-035-E (live preview pane).
**Discovered during:** PortPro screenshot review at end of 2026-04-26 session, deferred from FU-035-D's scope.

## 1. Goal

Replace the current chooser + accordion-of-customer-overrides UX with PortPro's single-page dropdown-driven model. After this ships:

- One route: `/settings/document-designer`. Chooser page deleted.
- Configuration bar at top: **Customer dropdown** + **Document Type dropdown** + **Accent Color picker** + **Text Color picker**.
- Selecting a customer in the dropdown loads (or implicitly creates on save) that customer's override; "All Customers" loads/edits the tenant default.
- Real tenant company name + logo flow into the preview header (replacing the `"Your Company"` placeholder from FU-035-E sample data).
- Colors are stored per-template at `section_config.colors`; preview rendering tonight uses them, PDF rendering catches up in D2.

## 2. Scope

### In scope (this session)

- Page consolidation: delete `pages/settings/document-designer/index.js` (chooser) AND `pages/settings/document-designer/[type].js` (per-type editor); create new `pages/settings/document-designer/index.js` that is the unified editor.
- New `<ConfigurationBar>` component (4-control horizontal row + inline note slot).
- New `<CustomerDropdown>` component (lists All Customers + every customer org, with accent dot before customers that have an existing override row).
- New `<DocumentTypeDropdown>` component (entries from `DOCUMENT_TYPES` registry).
- Accent + Text color pickers (native `<input type="color">` + hex display).
- Storage extension: `section_config.colors = { accent, text }` with defaults applied when absent.
- Validator extension: accept + validate `colors` shape (hex strings).
- `<DocumentPreview>` accepts `colors` + `branding` props and pipes them down.
- Preview components consume `colors.accent` for blue bands / table headers and `colors.text` for body text.
- Page fetches `/api/tenant/me` on mount; populates real `tenantName` + `logo_url` into preview.
- URL query params: `?type=...&customer=...` — bookmark-able.
- Unsaved-changes guard: native `confirm()` when customer/doc-type dropdown changes while editor is dirty.
- Settings nav entry updated: route still `/settings/document-designer` (no `[type]` segment in the nav config).

### Out of scope (deferred)

- **Real address/phone/website wiring** — no API source yet. Stays placeholder strings (`"123 Main Street, …"` etc.). Separate FU when a Company Info settings page lands.
- **Color preset palettes** — native input is enough for v1.
- **Watermark + Disclaimer rich-text editor content** (FU-035-G).
- **"Save as new Configuration" named-config feature** (FU-035-G).
- **Per-doc-type child label remap** ("CUSTOMER" vs "Bill To") — FU-035-H1 when Invoice ships.
- **D2 PDF render layout** — colors flow into preview tonight; D2 makes the PDF use them too.
- **Tabbed Configuration / Designer split** — explicitly rejected during brainstorm; PortPro's actual UI is single-screen.

## 3. Page architecture

```
/settings/document-designer
└── pages/settings/document-designer/index.js     ← REPLACES old chooser AND old [type].js
    │
    ├── (state)
    │   ├── selectedDocType: string                  (URL: ?type=...)
    │   ├── selectedCustomerId: string | null        (URL: ?customer=...; null = All Customers)
    │   ├── currentTemplate: Template | null
    │   ├── existingOverrideCustomerIds: Set<string> (for accent dots)
    │   ├── customerList: Customer[]                 (for dropdown)
    │   ├── branding: { companyName, logo_url }      (from /api/tenant/me)
    │   ├── error: string | null
    │   └── loading: boolean
    │
    ├── <SettingsLayout>
    │   ├── Header (icon + title + description)
    │   ├── <Alert error={...} />                    (top of content if error)
    │   │
    │   ├── <ConfigurationBar>                       ← new, top of content
    │   │   ├── <CustomerDropdown>
    │   │   ├── <DocumentTypeDropdown>
    │   │   ├── Accent Color picker (native)
    │   │   ├── Text Color picker (native)
    │   │   └── (inline amber note when selectedCustomerId has no override yet)
    │   │
    │   └── <TemplateEditor template={currentTemplate} … />
    │       (Existing FU-035-D/E component — unchanged interface, but parent
    │        now passes `colors` and `branding` for preview wiring.)
    │
    └── <Alert success={...} />                       (after save)
```

The old "Tenant Default panel + customer overrides accordion" structure is gone. The single editor below the configuration bar always reflects whatever the dropdowns select.

## 4. State + data flow

**On mount:**
1. Read `?type=...&customer=...` from `router.query`. Default `type` to `'delivery_order_full'`. Default `customer` to `null` (= All Customers).
2. Fetch in parallel:
   - `GET /api/tenant/me` → `branding`.
   - `GET /api/tenant/document-templates?document_type=<type>` → all templates for this doc type. Tenant default = the row with `customer_id IS NULL`. Override rows = others.
   - `GET /api/tenant/orgs?type=customer` (or current existing org-list endpoint — see §10) → customer list.
3. From the templates response, build `existingOverrideCustomerIds` (set of `customer_id` values from non-null rows).
4. Determine `currentTemplate`:
   - If `selectedCustomerId === null`: tenant default row, or stub `{ customer_id: null, document_type, section_config: {} }` if no row exists.
   - If `selectedCustomerId !== null`: find override row in templates list; if none, stub `{ customer_id: selectedCustomerId, document_type, section_config: {} }` (will become POST on first save).

**On dropdown change:**
1. If `<TemplateEditor>` is dirty (the editor reports dirty state via callback or via parent-managed state — see §5), `confirm("You have unsaved changes. Discard them?")`. Cancel = no-op.
2. Update `selectedCustomerId` or `selectedDocType` in state.
3. Update URL: `router.replace({ pathname, query: { type, customer } })`.
4. If doc type changed: re-fetch templates list (different doc type = different rows); reset `currentTemplate` per the new doc type.
5. If customer changed: just look up the new template from existing list (no re-fetch needed). Update `currentTemplate`.

**On color picker change:** updates the `colors` field of the editor's working state. Marks dirty. Save serializes `colors` to API along with `visibility` + `perSection`.

**On save success:** if this was a new override (no `template.id` previously), add the returned template's `customer_id` to `existingOverrideCustomerIds` so the dropdown immediately shows the dot. Replace `currentTemplate` with the response body.

**On delete success:** remove the template from `existingOverrideCustomerIds`. If the deleted one was the currently-selected customer, switch to "All Customers" (set `selectedCustomerId = null`, update URL).

## 5. Editor dirty-state surfacing

`<TemplateEditor>` currently holds its own dirty state internally. For the unsaved-changes guard in the parent page to work, the editor must surface this.

Two options, pick one in implementation:

**Option A — Lift dirty state via prop callback.** Editor calls `onDirtyChange?.(isDirty)` whenever `isDirty` flips. Parent page tracks the latest value.

**Option B — Lift the entire editor state to the parent.** Editor becomes controlled (`workingState` + `onChange` props). Parent owns it.

Recommend **A** — minimal change to the existing `<TemplateEditor>` component. Just add `onDirtyChange` prop and call it from a `useEffect` watching `isDirty`.

## 6. `<ConfigurationBar>` component

**Files:** `components/settings/document-designer/ConfigurationBar.js`

Props:
```js
{
  selectedDocType:      string,
  selectedCustomerId:   string | null,
  customerList:         { id, name }[],
  existingOverrideCustomerIds: Set<string>,
  colors:               { accent, text },
  onDocTypeChange:      (newType) => void,
  onCustomerChange:     (newCustomerId | null) => void,
  onColorsChange:       ({ accent, text }) => void,
  showNoOverrideNote:   boolean,
  disabled:             boolean,
}
```

Renders a horizontal flex row:
```
┌──────────────┬───────────────┬──────────────┬──────────────┐
│ Customer ▾   │ Doc Type ▾    │ Accent ◼ #..  │ Text ◼ #..   │
└──────────────┴───────────────┴──────────────┴──────────────┘
   (if showNoOverrideNote: amber inline note below)
```

At narrow widths (`<sm:`), wraps to a 2x2 grid.

`showNoOverrideNote` is `true` when `selectedCustomerId !== null && !existingOverrideCustomerIds.has(selectedCustomerId)` AND the editor hasn't saved yet. Once the editor saves the new override, the parent flips `showNoOverrideNote` to false (and adds the customer to the existing-overrides set).

## 7. `<CustomerDropdown>` component

**Files:** `components/settings/document-designer/CustomerDropdown.js`

Native `<select>` for v1 (consistent + accessible; can upgrade to a search-enabled custom dropdown later if customer lists grow large). Each `<option>` for an override-customer is prefixed with `●` (a visible dot) in its label text:

```jsx
<option value="">All Customers</option>
{customerList.map((c) => (
  <option key={c.id} value={c.id}>
    {existingOverrideCustomerIds.has(c.id) ? '● ' : '   '}{c.name}
  </option>
))}
```

The leading whitespace for non-override customers keeps visual alignment. Color the dot via CSS isn't possible in `<option>` text — using a Unicode bullet character is the simplest portable approach.

If the customer list grows past ~50 entries, this becomes unwieldy and should be replaced with `<OrgPicker>` (the existing search-enabled component used in the rest of the app). Out of scope for v1 — flag in the comments.

## 8. `<DocumentTypeDropdown>` component

**Files:** `components/settings/document-designer/DocumentTypeDropdown.js`

Native `<select>` reading from `DOCUMENT_TYPES` registry:

```jsx
<select value={selectedDocType} onChange={(e) => onDocTypeChange(e.target.value)}>
  {DOCUMENT_TYPES.map((t) => (
    <option key={t.value} value={t.value}>{t.label}</option>
  ))}
</select>
```

Currently 2 entries (`delivery_order_full`, `delivery_order_next_move`). Future H1+ entries auto-appear when added to the registry.

## 9. Color pickers

Inline native `<input type="color">` + hex display + label. No external library.

```jsx
<label className="flex items-center gap-2">
  <span className="text-xs text-gray-700 dark:text-slate-300">Accent</span>
  <input
    type="color"
    value={colors.accent}
    onChange={(e) => onColorsChange({ ...colors, accent: e.target.value })}
    className="w-8 h-8 rounded border border-gray-300 dark:border-slate-600"
  />
  <span className="text-xs font-mono text-gray-600 dark:text-slate-400">
    {colors.accent.toUpperCase()}
  </span>
</label>
```

Same shape for the Text color.

Defaults applied at the page level: `colors = template.section_config.colors || { accent: '#3B82F6', text: '#111827' }`.

## 10. Customer list endpoint

Confirm the existing endpoint that `<OrgPicker>` uses for customer searches. If it's `GET /api/tenant/orgs?type=customer&active=true` (typical pattern), reuse. If a paginated/searched endpoint is the only option, we still get the FIRST page (or use a non-paginated variant if it exists).

If no suitable list endpoint exists, add one: `GET /api/tenant/orgs?type=customer&list=true` returning `{ id, name }` for active customers. Out of strict scope but a tiny addition (~30 LoC).

Mark this as a **pre-implementation check**: the implementer Tasks the customer-list fetch first, sees what's available, and either uses it directly or files a tiny adjacent task.

## 11. Storage shape change

`section_config` gains optional `colors`:

```jsonc
{
  "visibility": { ... },
  "perSection": { ... },
  "colors": { "accent": "#3B82F6", "text": "#111827" }
}
```

`computeVisibility` is unchanged. A new helper `extractColors(sectionConfig)` returns the resolved color object with defaults:

```js
export function extractColors(sectionConfig) {
  return {
    accent: sectionConfig?.colors?.accent || '#3B82F6',
    text:   sectionConfig?.colors?.text   || '#111827',
  };
}
```

Lives in `lib/constants/document-sections.js` next to `computeVisibility`.

## 12. Validator extension

`lib/pdf/validate-section-config.js`:

- Add `'colors'` to the `validKeys` set.
- Validate `colors` is an object with optional `accent` and `text` keys, each a string matching `/^#[0-9a-fA-F]{6}$/`.

Keeps the API rejecting malformed payloads without burying validation in the page.

## 13. Preview wiring

`<DocumentPreview>` gets two new props:

```js
{
  visibility,
  fields,
  sections,
  colors,    // { accent, text }
  branding,  // { tenantName, logo_url }
}
```

`branding` is passed into the `header` component's `data` parameter, overriding the sample-data values. `colors` is passed as a context-style prop OR threaded directly into each preview component that needs it (Header for the accent band, AddressDetails for blue header strips, OrderDetails-section title, Commodity table headers).

Direct prop threading is simpler than React Context for this scope. ~5 components consume `colors`.

`HeaderPreview` example:
```jsx
<div style={{ backgroundColor: colors.accent }} className="px-3 py-1.5 rounded text-white text-xs font-semibold">
  Delivery Order # : ABC123
</div>
```

`OrderDetailsPreview`:
```jsx
<div style={{ color: colors.text }} className="...">
  Order Details
</div>
```

The `text` color governs body text; the `accent` color governs every blue background / band / table header strip.

## 14. URL routing

```
/settings/document-designer                            → type=delivery_order_full, customer=null
/settings/document-designer?type=delivery_order_full   → customer=null (same as above)
/settings/document-designer?customer=<uuid>            → type=delivery_order_full, customer=<uuid>
/settings/document-designer?type=X&customer=Y          → both set
```

Driven by `router.query`. On dropdown change, call `router.replace({ pathname: '/settings/document-designer', query: { type, customer } })` — `replace` (not `push`) so back button doesn't trap the user in dropdown changes.

`customer` is omitted from the query when `null` (cleaner URLs for the common "tenant default" case).

## 15. Unsaved-changes guard

`<TemplateEditor>` exposes its `isDirty` via a new `onDirtyChange?: (boolean) => void` prop. Parent page tracks `editorIsDirty` in state via this callback.

Wrapper `confirmDiscard()`:

```js
function confirmDiscard() {
  if (!editorIsDirty) return true;
  return confirm('You have unsaved changes. Discard them?');
}
```

Wraps every dropdown change handler:
```js
function handleCustomerChange(newCustomerId) {
  if (!confirmDiscard()) return;
  setSelectedCustomerId(newCustomerId);
  // … URL update, currentTemplate update
}
```

Browser native `confirm()` is fine for v1 (no custom modal needed). Note: as the user types in color pickers, `editorIsDirty` flips true; same guard applies if they then change customer. Acceptable.

## 16. Permissions

Unchanged: `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]`. The `lib/settings-nav.js` entry stays put.

## 17. Settings nav update

Update `lib/settings-nav.js` Document Designer entry:
- `route` field: change from a route that includes `[type]` (if any) to `'/settings/document-designer'`.
- No other changes — the entry already exists from FU-035-B.

## 18. File impact

| File | Action | LoC |
|---|---|---|
| `pages/settings/document-designer/index.js` | Replace (was chooser; becomes unified editor) | ~270 |
| `pages/settings/document-designer/[type].js` | Delete | -290 |
| `components/settings/document-designer/ConfigurationBar.js` | New | ~140 |
| `components/settings/document-designer/CustomerDropdown.js` | New | ~50 |
| `components/settings/document-designer/DocumentTypeDropdown.js` | New | ~30 |
| `components/settings/document-designer/TemplateEditor.js` | Modify (add `onDirtyChange` prop, accept `colors` from parent, surface them to preview) | +30 |
| `components/settings/document-designer/preview/DocumentPreview.js` | Modify (accept `colors` + `branding` props) | +15 |
| `components/settings/document-designer/preview/HeaderPreview.js` | Modify (consume `branding`, accent for blue band) | +10 |
| `components/settings/document-designer/preview/AddressDetailsPreview.js` | Modify (accent for header strips) | +10 |
| `components/settings/document-designer/preview/OrderDetailsPreview.js` | Modify (text color for body) | +5 |
| `components/settings/document-designer/preview/CommodityDetailsPreview.js` | Modify (accent for table header) | +5 |
| `lib/constants/document-sections.js` | Add `extractColors` helper | +15 |
| `lib/pdf/validate-section-config.js` | Extend validator (`colors` key + hex validation) | +25 |
| `lib/settings-nav.js` | Trim route to `/settings/document-designer` | ~2 |

**Total:** 1 page replaced, 1 page deleted, 3 new components, 8 modified files. ~315 net LoC. ~3-4 hours.

## 19. Testing

**Unit tests:**
- `lib/pdf/validate-section-config.test.mjs` — extend with cases for `colors` (valid hex, invalid hex, missing one of {accent, text}, extra keys).
- `lib/constants/document-sections-constants.test.mjs` — add `extractColors` tests (empty config → defaults; partial config → mixes defaults + provided; full config → both provided).

**Live verification:** manual browser test (Task in plan):
1. Load `/settings/document-designer` — defaults to delivery_order_full + All Customers.
2. Change Document Type dropdown to "Delivery Order — Next Move" → editor reloads, URL updates.
3. Change Customer dropdown to a customer with no existing override → amber inline note appears, editor shows tenant-default values, save → note disappears, dot appears next to customer in dropdown.
4. Change accent color to red → preview's blue bands turn red instantly.
5. Edit a toggle, then try to switch customer dropdown → confirm dialog, cancel → stays put. Confirm → switches and discards edit.
6. Open `/settings/document-designer?type=delivery_order_next_move&customer=<id>` directly → loads correctly.
7. Save a template, refresh page → values persist, colors persist.

## 20. Risk and rollback

**Risks:**
1. **Customer list endpoint compatibility.** If the existing OrgPicker endpoint is paginated/searched, our dropdown can't easily list all customers. Mitigation: pre-implementation check (Task 1); add a small list endpoint if needed.
2. **Native `<select>` UX with many customers.** A tenant with 200+ customers will see a long unsearchable dropdown. Mitigation: scope-limit warning in the component's JSDoc; future upgrade to `<OrgPicker>`-style search if needed.
3. **Color picker default behavior.** Some browsers' color inputs reset to `#000000` when cleared. Defaults are applied at parent state level so cleared values just snap back to default on next interaction. No data corruption risk since the validator rejects empty strings.
4. **URL-state desync.** If router.replace is delayed or cancelled (e.g., back button mid-change), state and URL could diverge briefly. Mitigation: read `router.query` as the source of truth on every render; component state mirrors it.
5. **Confirm dialog UX.** Native `confirm()` is functional but ugly. Acceptable for v1; design system has no shared modal component for this case.
6. **Migration path for existing rows.** Existing rows have no `colors` key — `extractColors` returns defaults. No DB migration needed. Rollback is also clean — old code paths just ignore the new key.

**Rollback:** revert the commit. The pages directory is back to chooser + per-type editor. Existing `section_config` rows that gained a `colors` key are silently ignored by the old code (extra key in JSON is harmless — the old validator only rejected unknown keys at write time, not read time, and `validKeys` is the only place that would refuse them — but writes don't happen on rollback paths anyway).

## 21. Forward path

After F ships:
- **D2 (PDF render layout)** picks up the `colors` from `section_config` and applies them to the React-PDF Header band, Order Details title, Commodity table header, etc. — the printed PDF starts matching the preview.
- **G (watermark + disclaimer rich text + named configurations)** adds a watermark toggle + text input + a TipTap editor for disclaimer. Named configs ("Save as new Configuration" green button in PortPro) is a separate sub-decision deferred.
- **H1-H9 (other doc types)** plug in by:
  1. Adding the type to `DOCUMENT_TYPES` (auto-appears in the dropdown).
  2. Adding its section registry to `SECTIONS_BY_DOCUMENT_TYPE`.
  3. Adding its data fetcher + composer + section components.
  4. Optionally per-doc-type label remap (e.g., "CUSTOMER" vs "Bill To") — solved when needed, not preemptively.

E + F + D2 together complete the core PortPro-mirror DO experience.
