# FU-035-F Configuration Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chooser + customer-overrides-accordion model with PortPro's single-page dropdown-driven Document Designer. Adds Customer + Document Type dropdowns at the top of `/settings/document-designer`, accent + text color pickers, and wires real tenant company name + logo into the live preview.

**Architecture:** One unified page replaces both the chooser (`index.js`) and per-type editor (`[type].js`). New `<ConfigurationBar>` component with `<CustomerDropdown>` (accent dot for customers with existing override rows), `<DocumentTypeDropdown>`, native HTML color pickers. State lives in the page; flows down to existing FU-035-E `<TemplateEditor>` (now accepts `colors` + an `onDirtyChange` callback). Storage extension: `section_config.colors = { accent, text }` with defaults applied at read time. Validator updated to accept hex strings.

**Tech Stack:** Next.js 14, React, Tailwind CSS (with `dark:` variants), `lucide-react` icons, native Node test runner. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-04-26-fu035f-configuration-bar-design.md`](../specs/2026-04-26-fu035f-configuration-bar-design.md)

---

## Task 1: Allow SETTINGS permission to list organizations

**Files:**
- Modify: `pages/api/tenant/organizations/index.js`

The Document Designer page needs to list all customers for the dropdown. The current GET endpoint allows only `[ORDER_ENTRY, ACCOUNTS_RECEIVABLE, ALL]`. SETTINGS users (who manage Document Designer) should also be able to read the list. POST/PUT/DELETE permissions are unchanged — only read access widens.

- [ ] **Step 1: Apply the permission widening**

In `pages/api/tenant/organizations/index.js`, find the line inside the `if (req.method === 'GET')` block that calls `requirePermission`:

```js
if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;
```

Change it to:

```js
if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;
```

- [ ] **Step 2: Commit**

```bash
git add pages/api/tenant/organizations/index.js
git commit -m "feat(api): allow SETTINGS users to list organizations (FU-035-F)"
```

---

## Task 2: `extractColors` helper + tests

**Files:**
- Modify: `lib/constants/document-sections.js`
- Modify: `tests/document-sections-constants.test.mjs`

- [ ] **Step 1: Write failing tests**

Append to `tests/document-sections-constants.test.mjs` (after the existing `computeVisibility` tests):

```js
import { extractColors } from '../lib/constants/document-sections.js';

test('extractColors returns defaults when sectionConfig is empty/missing', () => {
  assert.deepEqual(extractColors(undefined), { accent: '#3B82F6', text: '#111827' });
  assert.deepEqual(extractColors(null), { accent: '#3B82F6', text: '#111827' });
  assert.deepEqual(extractColors({}), { accent: '#3B82F6', text: '#111827' });
  assert.deepEqual(extractColors({ visibility: {} }), { accent: '#3B82F6', text: '#111827' });
});

test('extractColors preserves provided values', () => {
  const cfg = { colors: { accent: '#FF0000', text: '#222222' } };
  assert.deepEqual(extractColors(cfg), { accent: '#FF0000', text: '#222222' });
});

test('extractColors fills only-accent or only-text with defaults', () => {
  assert.deepEqual(
    extractColors({ colors: { accent: '#00FF00' } }),
    { accent: '#00FF00', text: '#111827' }
  );
  assert.deepEqual(
    extractColors({ colors: { text: '#888888' } }),
    { accent: '#3B82F6', text: '#888888' }
  );
});
```

- [ ] **Step 2: Run tests, confirm fail**

Run: `node --test tests/document-sections-constants.test.mjs`
Expected: 3 new tests fail with `extractColors is not a function` (or similar import error).

- [ ] **Step 3: Implement `extractColors`**

In `lib/constants/document-sections.js`, append after the existing `computeVisibility` function:

```js
/**
 * Resolve the colors for a document, applying defaults when the section_config
 * has no `colors` key or omits one of {accent, text}.
 *
 * Defaults: accent = #3B82F6 (Tailwind blue-600), text = #111827 (Tailwind gray-900).
 */
export function extractColors(sectionConfig) {
  return {
    accent: sectionConfig?.colors?.accent || '#3B82F6',
    text:   sectionConfig?.colors?.text   || '#111827',
  };
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `node --test tests/document-sections-constants.test.mjs`
Expected: all 14 tests pass (11 from FU-035-D + 3 new for extractColors).

- [ ] **Step 5: Commit**

```bash
git add lib/constants/document-sections.js tests/document-sections-constants.test.mjs
git commit -m "feat(doc-sections): add extractColors helper with defaults (FU-035-F)"
```

---

## Task 3: Validator extension for `colors`

**Files:**
- Modify: `lib/pdf/validate-section-config.js`
- Create: `tests/validate-section-config.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/validate-section-config.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

const VALID_TYPE = 'delivery_order_full';

test('validateSectionConfig accepts a valid colors object', () => {
  const r = validateSectionConfig(
    { colors: { accent: '#3B82F6', text: '#111827' } },
    VALID_TYPE,
  );
  assert.equal(r.ok, true);
});

test('validateSectionConfig accepts colors with only accent or only text', () => {
  assert.equal(
    validateSectionConfig({ colors: { accent: '#FF0000' } }, VALID_TYPE).ok,
    true,
  );
  assert.equal(
    validateSectionConfig({ colors: { text: '#222222' } }, VALID_TYPE).ok,
    true,
  );
});

test('validateSectionConfig rejects non-hex colors', () => {
  const r1 = validateSectionConfig({ colors: { accent: 'red' } }, VALID_TYPE);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /accent/);

  const r2 = validateSectionConfig({ colors: { text: '#FFF' } }, VALID_TYPE); // 3-char hex not allowed
  assert.equal(r2.ok, false);
  assert.match(r2.error, /text/);
});

test('validateSectionConfig rejects unknown keys inside colors', () => {
  const r = validateSectionConfig(
    { colors: { accent: '#3B82F6', bogus: '#111827' } },
    VALID_TYPE,
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown key in colors/);
});

test('validateSectionConfig rejects non-object colors', () => {
  assert.equal(
    validateSectionConfig({ colors: '#3B82F6' }, VALID_TYPE).ok,
    false,
  );
  assert.equal(
    validateSectionConfig({ colors: ['#3B82F6'] }, VALID_TYPE).ok,
    false,
  );
});

test('validateSectionConfig still works without colors', () => {
  assert.equal(validateSectionConfig({}, VALID_TYPE).ok, true);
  assert.equal(
    validateSectionConfig({ visibility: {} }, VALID_TYPE).ok,
    true,
  );
});

test('validateSectionConfig still rejects unknown top-level keys', () => {
  const r = validateSectionConfig({ bogus: 1 }, VALID_TYPE);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown section_config key: bogus/);
});
```

- [ ] **Step 2: Run tests, confirm fail**

Run: `node --test tests/validate-section-config.test.mjs`
Expected: tests for `colors` fail because `validKeys` doesn't include `'colors'`.

- [ ] **Step 3: Extend the validator**

In `lib/pdf/validate-section-config.js`, change the `validKeys` Set:

```js
const validKeys = new Set(['visibility', 'order', 'perSection']);
```

to:

```js
const validKeys = new Set(['visibility', 'order', 'perSection', 'colors']);
```

Then, before the closing `return { ok: true };` line, add the colors validation block:

```js
  if (sectionConfig.colors !== undefined) {
    if (
      typeof sectionConfig.colors !== 'object' ||
      Array.isArray(sectionConfig.colors) ||
      sectionConfig.colors === null
    ) {
      return { ok: false, error: 'colors must be an object' };
    }
    const allowedColorKeys = new Set(['accent', 'text']);
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    for (const [k, v] of Object.entries(sectionConfig.colors)) {
      if (!allowedColorKeys.has(k)) {
        return { ok: false, error: `unknown key in colors: ${k}` };
      }
      if (typeof v !== 'string' || !hexRegex.test(v)) {
        return { ok: false, error: `colors.${k} must be a 6-digit hex string like #3B82F6` };
      }
    }
  }
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `node --test tests/validate-section-config.test.mjs`
Expected: 7/7 pass.

Also run the registry tests to verify no regression:

Run: `node --test tests/document-sections-constants.test.mjs`
Expected: 14/14 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/validate-section-config.js tests/validate-section-config.test.mjs
git commit -m "feat(doc-templates): validate colors object in section_config (FU-035-F)"
```

---

## Task 4: `<CustomerDropdown>` component

**Files:**
- Create: `components/settings/document-designer/CustomerDropdown.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/CustomerDropdown.js`:

```jsx
/**
 * Native <select> dropdown listing "All Customers" + every customer org.
 * Customers with an existing override row are prefixed with a Unicode bullet
 * (●) for visual distinction; customers without one have leading spaces for
 * alignment.
 *
 * Future upgrade: replace with a search-enabled OrgPicker if customer lists
 * grow large (>50 entries). Filed as out-of-scope follow-up.
 *
 * Props:
 *   value:                          string | null   (null = All Customers)
 *   customers:                      { id, name }[]
 *   existingOverrideCustomerIds:    Set<string>
 *   onChange:                       (newId: string | null) => void
 *   disabled:                       boolean
 */
export default function CustomerDropdown({
  value,
  customers,
  existingOverrideCustomerIds,
  onChange,
  disabled,
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-700 dark:text-slate-300">
        Customer
      </span>
      <select
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className="px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="">All Customers</option>
        {customers.map((c) => {
          const hasOverride = existingOverrideCustomerIds.has(c.id);
          return (
            <option key={c.id} value={c.id}>
              {hasOverride ? '● ' : '   '}
              {c.name}
            </option>
          );
        })}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/CustomerDropdown.js
git commit -m "feat(doc-designer): CustomerDropdown with override-existence dots (FU-035-F)"
```

---

## Task 5: `<DocumentTypeDropdown>` component

**Files:**
- Create: `components/settings/document-designer/DocumentTypeDropdown.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/DocumentTypeDropdown.js`:

```jsx
import { DOCUMENT_TYPES } from '../../../lib/constants/document-types';

/**
 * Native <select> for document type. Reads entries from DOCUMENT_TYPES
 * registry — adding new types (Invoice, RateCon, POD, etc., from FU-035-H1+)
 * just adds dropdown entries with no other changes here.
 *
 * Props:
 *   value:    string                   (matches a DOCUMENT_TYPES.value)
 *   onChange: (newType: string) => void
 *   disabled: boolean
 */
export default function DocumentTypeDropdown({ value, onChange, disabled }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-700 dark:text-slate-300">
        Document Type
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {DOCUMENT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/DocumentTypeDropdown.js
git commit -m "feat(doc-designer): DocumentTypeDropdown driven by registry (FU-035-F)"
```

---

## Task 6: `<ConfigurationBar>` component

**Files:**
- Create: `components/settings/document-designer/ConfigurationBar.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/ConfigurationBar.js`:

```jsx
import CustomerDropdown from './CustomerDropdown';
import DocumentTypeDropdown from './DocumentTypeDropdown';

/**
 * Top-of-page bar that hosts Customer + Document Type dropdowns and the
 * accent + text color pickers. Renders a wrap-able horizontal flex row.
 *
 * Below the row, when `showNoOverrideNote` is true, an amber inline note
 * tells the user that selecting an override-less customer + saving will
 * implicitly create a new override row.
 *
 * Props:
 *   selectedDocType:                string
 *   selectedCustomerId:             string | null
 *   customers:                      { id, name }[]
 *   existingOverrideCustomerIds:    Set<string>
 *   colors:                         { accent: string, text: string }
 *   onDocTypeChange:                (newType) => void
 *   onCustomerChange:               (newCustomerId | null) => void
 *   onColorsChange:                 ({ accent, text }) => void
 *   showNoOverrideNote:             boolean
 *   disabled:                       boolean
 */
export default function ConfigurationBar({
  selectedDocType,
  selectedCustomerId,
  customers,
  existingOverrideCustomerIds,
  colors,
  onDocTypeChange,
  onCustomerChange,
  onColorsChange,
  showNoOverrideNote,
  disabled,
}) {
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[180px]">
          <CustomerDropdown
            value={selectedCustomerId}
            customers={customers}
            existingOverrideCustomerIds={existingOverrideCustomerIds}
            onChange={onCustomerChange}
            disabled={disabled}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <DocumentTypeDropdown
            value={selectedDocType}
            onChange={onDocTypeChange}
            disabled={disabled}
          />
        </div>
        <ColorPickerField
          label="Accent"
          value={colors.accent}
          onChange={(accent) => onColorsChange({ ...colors, accent })}
          disabled={disabled}
        />
        <ColorPickerField
          label="Text"
          value={colors.text}
          onChange={(text) => onColorsChange({ ...colors, text })}
          disabled={disabled}
        />
      </div>
      {showNoOverrideNote ? (
        <div className="px-3 py-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200 text-xs">
          This customer doesn't have an override yet. Saving creates one.
        </div>
      ) : null}
    </div>
  );
}

function ColorPickerField({ label, value, onChange, disabled }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-700 dark:text-slate-300">
        {label}
      </span>
      <div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900">
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span className="text-xs font-mono text-gray-600 dark:text-slate-400 uppercase">
          {value}
        </span>
      </div>
    </label>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/ConfigurationBar.js
git commit -m "feat(doc-designer): ConfigurationBar with dropdowns + color pickers (FU-035-F)"
```

---

## Task 7: Update preview components to consume `colors` + `branding`

**Files:**
- Modify: `components/settings/document-designer/preview/HeaderPreview.js`
- Modify: `components/settings/document-designer/preview/AddressDetailsPreview.js`
- Modify: `components/settings/document-designer/preview/OrderDetailsPreview.js`
- Modify: `components/settings/document-designer/preview/CommodityDetailsPreview.js`

This task touches 4 preview components, adding a `colors` prop (and for HeaderPreview, a `branding` override mechanism). Changes are minimal — switch hardcoded color classes to inline styles where needed.

- [ ] **Step 1: Modify `HeaderPreview.js`**

Replace `components/settings/document-designer/preview/HeaderPreview.js` with:

```jsx
/**
 * HTML preview of the Header section. Mirrors components/pdf/sections/Header.js
 * but renders to plain HTML for the live preview pane in the Document Designer.
 *
 * Two-column layout: left = tenant identity (logo / company name / address /
 * phone / website); right = document title in the accent-colored band.
 *
 * `data.tenantName` and `data.tenantInfo.logo_url` may be overridden by the
 * page's real `branding` payload (from /api/tenant/me). When present in
 * `data` they take priority over the sample-data defaults.
 *
 * `opts.fields`: { logo, address, phone, website, company_name }.
 * Default-true except `website` (matches registry).
 *
 * `colors.accent`: hex color for the right-side document-title band.
 * `colors.text`:   hex color for body text.
 */
export default function HeaderPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const textColor = colors?.text || '#111827';
  const showLogo        = fields.logo        !== false;
  const showAddress     = fields.address     !== false;
  const showPhone       = fields.phone       !== false;
  const showWebsite     = fields.website === true;
  const showCompanyName = fields.company_name !== false;

  const logoUrl = data.tenantInfo?.logo_url;
  const address = data.tenantInfo?.address;
  const phone   = data.tenantInfo?.phone;
  const website = data.tenantInfo?.website;

  return (
    <div className="flex justify-between items-start mb-6 pb-4 border-b border-gray-200">
      <div className="flex gap-3 items-start">
        {showLogo ? (
          logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" className="w-16 h-16 object-contain" />
          ) : (
            <div className="w-16 h-16 rounded border border-dashed border-gray-300 flex items-center justify-center text-[10px] text-gray-400">
              Logo
            </div>
          )
        ) : null}
        <div>
          {showCompanyName ? (
            <div className="text-base font-semibold" style={{ color: textColor }}>
              {data.tenantName || 'Company'}
            </div>
          ) : null}
          {showAddress && address ? (
            <div className="text-xs text-gray-600 mt-0.5">{address}</div>
          ) : null}
          {showPhone && phone ? (
            <div className="text-xs text-gray-600">{phone}</div>
          ) : null}
          {showWebsite && website ? (
            <div className="text-xs text-gray-600">{website}</div>
          ) : null}
        </div>
      </div>
      <div className="text-right">
        <div
          className="inline-block px-3 py-1.5 text-white rounded text-xs font-semibold"
          style={{ backgroundColor: accent }}
        >
          Delivery Order # : ABC123
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modify `AddressDetailsPreview.js`**

The four address blocks have a colored header strip. Switch the `bg-blue-600` to inline `style={{ backgroundColor: accent }}`.

In `components/settings/document-designer/preview/AddressDetailsPreview.js`:

Find the inner `AddressBlock` function. Change its signature from `function AddressBlock({ label, org })` to `function AddressBlock({ label, org, accent })`.

Then change the header strip's className + add inline style:
```jsx
      <div className="px-2 py-1 bg-blue-600 text-white text-[10px] uppercase tracking-wider font-semibold rounded-t">
        {label}
      </div>
```
to:
```jsx
      <div
        className="px-2 py-1 text-white text-[10px] uppercase tracking-wider font-semibold rounded-t"
        style={{ backgroundColor: accent }}
      >
        {label}
      </div>
```

Then change `AddressDetailsPreview`'s signature from `({ data, opts })` to `({ data, opts, colors })` and add at the top of the function body:

```js
  const accent = colors?.accent || '#3B82F6';
```

In each spot where `<AddressBlock ... />` is rendered (4 places — customer, pickup, delivery, return), add `accent={accent}`:

```jsx
    blocks.push(<AddressBlock key="customer" label="Customer" org={data.customer} accent={accent} />);
```

- [ ] **Step 3: Modify `OrderDetailsPreview.js`**

In `components/settings/document-designer/preview/OrderDetailsPreview.js`, change `OrderDetailsPreview`'s signature from `({ data, opts })` to `({ data, opts, colors })`. At the top of the function body:

```js
  const textColor = colors?.text || '#111827';
```

Find the heading line:
```jsx
      <div className="text-[10px] uppercase tracking-wider font-bold text-gray-700 mb-2">
        Order Details
      </div>
```

Change to:
```jsx
      <div
        className="text-[10px] uppercase tracking-wider font-bold mb-2"
        style={{ color: textColor }}
      >
        Order Details
      </div>
```

The body row text stays `text-[11px] text-gray-900` — the spec calls for accent on bands and text color for "body text" but the per-row labels are already gray-900 which reads correctly with any reasonable text color override. Leaving them unchanged keeps the diff small.

- [ ] **Step 4: Modify `CommodityDetailsPreview.js`**

In `components/settings/document-designer/preview/CommodityDetailsPreview.js`, change `CommodityDetailsPreview`'s signature from `({ data, opts })` to `({ data, opts, colors })`. At the top of the function body:

```js
  const accent = colors?.accent || '#3B82F6';
```

Find the table header `<th>` className:
```jsx
              <th
                key={key}
                className="px-2 py-1.5 bg-blue-600 text-white text-[10px] uppercase tracking-wider font-semibold text-left border border-blue-700"
              >
```

Change to:
```jsx
              <th
                key={key}
                className="px-2 py-1.5 text-white text-[10px] uppercase tracking-wider font-semibold text-left"
                style={{ backgroundColor: accent, border: `1px solid ${accent}` }}
              >
```

(The `border-blue-700` doesn't have an obvious darker-shade equivalent inline; we set the same accent for the border. Visually fine.)

- [ ] **Step 5: Verify tests still pass**

Run: `node --test tests/document-sections-constants.test.mjs tests/validate-section-config.test.mjs`
Expected: 14 + 7 = 21 pass.

- [ ] **Step 6: Commit**

```bash
git add components/settings/document-designer/preview/HeaderPreview.js \
        components/settings/document-designer/preview/AddressDetailsPreview.js \
        components/settings/document-designer/preview/OrderDetailsPreview.js \
        components/settings/document-designer/preview/CommodityDetailsPreview.js
git commit -m "feat(doc-designer): preview components consume colors prop (FU-035-F)"
```

---

## Task 8: Update `<DocumentPreview>` to accept and pass `colors` + `branding`

**Files:**
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

- [ ] **Step 1: Modify the orchestrator**

Replace `components/settings/document-designer/preview/DocumentPreview.js` with:

```jsx
import sampleData from '../../../../lib/document-designer/sample-data';
import HeaderPreview               from './HeaderPreview';
import DeliveryOrderDetailsPreview from './DeliveryOrderDetailsPreview';
import AddressDetailsPreview       from './AddressDetailsPreview';
import OrderDetailsPreview         from './OrderDetailsPreview';
import CommodityDetailsPreview     from './CommodityDetailsPreview';
import NotesPreview                from './NotesPreview';
import SignaturePreview            from './SignaturePreview';
import DisclaimerPreview           from './DisclaimerPreview';

/**
 * Maps section ID → its HTML preview component. Sections without preview
 * components (move_events / barcode / footer) are intentionally absent —
 * the preview pane is a one-page snapshot, not a multi-page render.
 */
const PREVIEW_BY_SECTION_ID = {
  header:                 HeaderPreview,
  delivery_order_details: DeliveryOrderDetailsPreview,
  address_details:        AddressDetailsPreview,
  order_details:          OrderDetailsPreview,
  commodity_details:      CommodityDetailsPreview,
  notes:                  NotesPreview,
  signature:              SignaturePreview,
  disclaimer:             DisclaimerPreview,
};

/**
 * Live HTML preview of the document. Iterates the section registry, renders
 * each visible section through its corresponding preview component, passing
 * sample data + resolved field-visibility map + per-template colors.
 *
 * `visibility`: { [sectionId]: boolean }
 * `fields`:     { [sectionId]: { [fieldId]: boolean } }
 * `sections`:   the section registry array
 * `colors`:     { accent, text } — per-template colors with defaults applied
 * `branding`:   { tenantName, logo_url } — overrides sample-data values for the header section
 */
export default function DocumentPreview({ visibility, fields, sections, colors, branding }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] px-3 py-1.5 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200">
        Preview reflects the upcoming document layout. Printed PDFs use the current layout until the rendering update ships.
      </div>
      <div className="bg-white rounded-lg shadow-lg ring-1 ring-gray-200 p-8 text-sm text-gray-900">
        {sections.map((s) => {
          if (!visibility[s.id]) return null;
          const Component = PREVIEW_BY_SECTION_ID[s.id];
          if (!Component) return null;
          let data = sampleData[s.id];
          // Apply branding override to the header section's data.
          if (s.id === 'header' && branding) {
            data = {
              ...data,
              tenantName: branding.tenantName || data.tenantName,
              tenantInfo: {
                ...data.tenantInfo,
                logo_url: branding.logo_url || data.tenantInfo?.logo_url,
              },
            };
          }
          const opts = { fields: fields[s.id] || {} };
          return <Component key={s.id} data={data} opts={opts} colors={colors} />;
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): DocumentPreview accepts colors + branding props (FU-035-F)"
```

---

## Task 9: Update `<TemplateEditor>` — controlled colors + `onDirtyChange` + branding

**Files:**
- Modify: `components/settings/document-designer/TemplateEditor.js`

The editor needs four changes:
1. Accept `colors` and `onColorsChange` as controlled props (page owns the state — enables bidirectional flow with the ConfigurationBar's color pickers).
2. Accept `branding` prop and pass it through to `<DocumentPreview>`.
3. Include `colors` in `isDirty` comparison so dirty state is correct when colors change.
4. Surface `isDirty` to parent via `onDirtyChange` callback.

The internal `useState` keeps `{ visibility, fields }` as before — colors are NOT in internal state. They're a prop.

- [ ] **Step 1: Read the current structure**

Run: `wc -l components/settings/document-designer/TemplateEditor.js`
Expected: ~270 lines.

The current state shape is `{ visibility, fields }`; we're keeping that, and adding `colors` as a prop alongside.

- [ ] **Step 2: Update imports**

In `components/settings/document-designer/TemplateEditor.js`, after the existing `import { getSectionsForDocumentType } from '../../../lib/constants/document-sections';` line, add:

```js
import { extractColors } from '../../../lib/constants/document-sections';
```

- [ ] **Step 3: Update component signature to accept new props**

Find:

```js
export default function TemplateEditor({
  template,
  onSaved,
  onDeleted,
  showDelete = false,
  onError,
}) {
```

Change to:

```js
export default function TemplateEditor({
  template,
  onSaved,
  onDeleted,
  showDelete = false,
  onError,
  onDirtyChange,
  branding,
  colors,
  onColorsChange,
}) {
```

- [ ] **Step 4: Update `savedState` to include colors snapshot**

The `savedState` represents the last-saved server values. It needs to include the colors that were saved with `template.section_config` so we can detect when the working colors prop has drifted from saved.

Find:

```js
  const [savedState, setSavedState] = useState(() =>
    buildInitialState(sections, template.section_config)
  );
```

Change to:

```js
  const [savedState, setSavedState] = useState(() => {
    const init = buildInitialState(sections, template.section_config);
    return {
      visibility: init.visibility,
      fields: init.fields,
      colors: extractColors(template.section_config),
    };
  });
```

- [ ] **Step 5: Update `isDirty` to account for colors**

Find:

```js
  const isDirty =
    JSON.stringify({ visibility, fields }) !== JSON.stringify(savedState);
```

Change to:

```js
  const isDirty =
    JSON.stringify({ visibility, fields, colors }) !==
    JSON.stringify({
      visibility: savedState.visibility,
      fields: savedState.fields,
      colors: savedState.colors,
    });
```

- [ ] **Step 6: Add `onDirtyChange` effect**

After the `isDirty` line, add this `useEffect` (the `useEffect` import is already present from FU-035-D):

```js
  useEffect(() => {
    if (typeof onDirtyChange === 'function') {
      onDirtyChange(isDirty);
    }
  }, [isDirty, onDirtyChange]);
```

- [ ] **Step 7: Update `useEffect` that re-syncs on template prop change**

Find:

```js
  useEffect(() => {
    const initial = buildInitialState(sections, template.section_config);
    setState(initial);
    setSavedState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.section_config, template.id]);
```

Change to:

```js
  useEffect(() => {
    const initial = buildInitialState(sections, template.section_config);
    const savedColors = extractColors(template.section_config);
    setState({ visibility: initial.visibility, fields: initial.fields });
    setSavedState({
      visibility: initial.visibility,
      fields: initial.fields,
      colors: savedColors,
    });
    if (typeof onColorsChange === 'function') {
      onColorsChange(savedColors);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.section_config, template.id]);
```

This makes the editor authoritative on "fresh template loaded" — the page-level `liveColors` state syncs to the new template's saved colors when the user switches customers.

- [ ] **Step 8: Update `reset()` to also reset colors via `onColorsChange`**

Find:

```js
  function reset() {
    setState(savedState);
  }
```

Change to:

```js
  function reset() {
    setState({ visibility: savedState.visibility, fields: savedState.fields });
    if (typeof onColorsChange === 'function') {
      onColorsChange(savedState.colors);
    }
  }
```

- [ ] **Step 9: Update `save()` to serialize colors and update savedState correctly**

In the existing `save()` function, find:

```js
      const sectionConfigToSend = {
        visibility: visibilityToSend,
        perSection: perSectionToSend,
      };
```

Change to:

```js
      const sectionConfigToSend = {
        visibility: visibilityToSend,
        perSection: perSectionToSend,
        colors,
      };
```

Then, after the successful save, find:

```js
      setSavedState(visibility);
      onSaved?.(data.template);
```

(The exact line is the one that was set in FU-035-D Task 10. It may currently be `setSavedState(visibility)` — that was a bug from FU-035-D; the savedState should be the full state. Check the actual contents of your file around the `setSavedState` call inside `save()`.)

Change to:

```js
      setSavedState({ visibility, fields, colors });
      onSaved?.(data.template);
```

- [ ] **Step 10: Pass `colors` and `branding` to `<DocumentPreview>`**

Find the preview pane JSX (right column of the side-by-side flex):

```jsx
        <DocumentPreview
          visibility={visibility}
          fields={fields}
          sections={sections}
        />
```

Change to:

```jsx
        <DocumentPreview
          visibility={visibility}
          fields={fields}
          sections={sections}
          colors={colors}
          branding={branding}
        />
```

- [ ] **Step 11: Sanity check that all the new pieces are present**

Run: `node -e "const fs=require('fs'); const c=fs.readFileSync('components/settings/document-designer/TemplateEditor.js','utf8'); console.log({onDirtyChange: c.includes('onDirtyChange'), branding: c.includes('branding'), colorsProp: c.includes('colors,\n  onColorsChange'), extractColors: c.includes('extractColors'), savedStateColors: c.includes('savedState.colors')});"`

Expected: all five values are `true`.

- [ ] **Step 12: Run registry tests as a regression check**

Run: `node --test tests/document-sections-constants.test.mjs tests/validate-section-config.test.mjs`
Expected: 21/21 pass.

- [ ] **Step 13: Commit**

```bash
git add components/settings/document-designer/TemplateEditor.js
git commit -m "feat(doc-designer): TemplateEditor controlled colors + onDirtyChange + branding (FU-035-F)"
```

---

## Task 10: Replace the page — unified editor with dropdowns

**Files:**
- Replace: `pages/settings/document-designer/index.js` (was the chooser; becomes the unified editor)
- Delete: `pages/settings/document-designer/[type].js`

This is the keystone task. The new page combines:
- The settings layout / header / breadcrumb (kept from the old `[type].js`).
- The new `<ConfigurationBar>` at the top.
- The existing `<TemplateEditor>` below (now with side-by-side preview from FU-035-E).
- Real tenant info fetch + customer list fetch + URL state + unsaved-changes guard.

- [ ] **Step 1: Replace `pages/settings/document-designer/index.js`**

Replace the file contents with:

```jsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { FileText } from 'lucide-react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Alert from '../../../components/ui/Alert';
import TemplateEditor from '../../../components/settings/document-designer/TemplateEditor';
import ConfigurationBar from '../../../components/settings/document-designer/ConfigurationBar';
import {
  isValidDocumentType,
  getDocumentType,
  DOCUMENT_TYPES,
} from '../../../lib/constants/document-types';

const DEFAULT_DOC_TYPE = DOCUMENT_TYPES[0]?.value || 'delivery_order_full';
const DEFAULT_COLORS = { accent: '#3B82F6', text: '#111827' };

export default function DocumentDesignerPage() {
  const router = useRouter();

  const [selectedDocType, setSelectedDocType] = useState(DEFAULT_DOC_TYPE);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);

  const [templates, setTemplates] = useState([]); // all templates for current doc type
  const [customers, setCustomers] = useState([]); // [{id, name}]
  const [branding, setBranding] = useState(null); // {tenantName, logo_url}

  const [liveColors, setLiveColors] = useState(DEFAULT_COLORS);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editorIsDirty, setEditorIsDirty] = useState(false);

  // Sync state from URL on first render and on subsequent route changes.
  useEffect(() => {
    if (!router.isReady) return;
    const t = typeof router.query.type === 'string' && isValidDocumentType(router.query.type)
      ? router.query.type
      : DEFAULT_DOC_TYPE;
    const c = typeof router.query.customer === 'string' && router.query.customer
      ? router.query.customer
      : null;
    setSelectedDocType(t);
    setSelectedCustomerId(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.type, router.query.customer]);

  // Fetch /api/tenant/me for branding once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tenant/me');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setBranding({
          tenantName: data.branding?.companyName || data.branding?.tenantName || null,
          logo_url: data.branding?.logoSmall || data.branding?.logoLarge || null,
        });
      } catch { /* ignore — preview falls back to placeholders */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch customer list once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tenant/organizations?type=customer');
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;
        setCustomers(
          (data.organizations || []).map((o) => ({ id: o.id, name: o.name })),
        );
      } catch (e) {
        if (!cancelled) setError(`Customer list: ${e.message}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch templates whenever doc type changes.
  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/tenant/document-templates?document_type=${encodeURIComponent(selectedDocType)}`,
        );
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) setTemplates(data.templates || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router.isReady, selectedDocType]);

  // Resolve the current template based on selectedCustomerId.
  const tenantDefault = templates.find((t) => t.customer_id === null);
  const currentOverride = selectedCustomerId
    ? templates.find((t) => t.customer_id === selectedCustomerId)
    : null;

  const currentTemplate = selectedCustomerId === null
    ? (tenantDefault || { customer_id: null, document_type: selectedDocType, section_config: {} })
    : (currentOverride || { customer_id: selectedCustomerId, document_type: selectedDocType, section_config: {} });

  const existingOverrideCustomerIds = new Set(
    templates.filter((t) => t.customer_id !== null).map((t) => t.customer_id),
  );

  const showNoOverrideNote =
    selectedCustomerId !== null && !existingOverrideCustomerIds.has(selectedCustomerId);

  const docTypeMeta = getDocumentType(selectedDocType);

  function confirmDiscard() {
    if (!editorIsDirty) return true;
    return confirm('You have unsaved changes. Discard them?');
  }

  function updateUrl(newType, newCustomer) {
    const query = { type: newType };
    if (newCustomer) query.customer = newCustomer;
    router.replace(
      { pathname: '/settings/document-designer', query },
      undefined,
      { shallow: true },
    );
  }

  function handleDocTypeChange(newType) {
    if (!confirmDiscard()) return;
    setSelectedDocType(newType);
    updateUrl(newType, selectedCustomerId);
  }

  function handleCustomerChange(newCustomerId) {
    if (!confirmDiscard()) return;
    setSelectedCustomerId(newCustomerId);
    updateUrl(selectedDocType, newCustomerId);
  }

  function handleSaved(savedTemplate) {
    setTemplates((arr) => {
      const existing = arr.find((t) => t.id === savedTemplate.id);
      if (existing) {
        return arr.map((t) => (t.id === savedTemplate.id ? savedTemplate : t));
      }
      return [...arr, savedTemplate];
    });
  }

  function handleDeleted() {
    setTemplates((arr) => arr.filter((t) => t.customer_id !== selectedCustomerId));
    setSelectedCustomerId(null);
    updateUrl(selectedDocType, null);
  }

  return (
    <SettingsLayout title="Document Designer">
      <div className="max-w-7xl">
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Document Designer
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Customize how your printed documents look. Pick a customer to edit
              that customer's override, or "All Customers" for the tenant default.
              {docTypeMeta?.description ? ` Currently editing: ${docTypeMeta.label}.` : ''}
            </p>
          </div>
        </div>

        {error && <Alert type="error" message={error} className="mb-4" />}

        <ConfigurationBar
          selectedDocType={selectedDocType}
          selectedCustomerId={selectedCustomerId}
          customers={customers}
          existingOverrideCustomerIds={existingOverrideCustomerIds}
          colors={liveColors}
          onDocTypeChange={handleDocTypeChange}
          onCustomerChange={handleCustomerChange}
          onColorsChange={setLiveColors}
          showNoOverrideNote={showNoOverrideNote}
          disabled={loading}
        />

        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <TemplateEditor
            template={currentTemplate}
            showDelete={selectedCustomerId !== null}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onError={setError}
            onDirtyChange={setEditorIsDirty}
            branding={branding}
            colors={liveColors}
            onColorsChange={setLiveColors}
            key={`${selectedDocType}-${selectedCustomerId || 'tenant'}`}
          />
        )}
      </div>
    </SettingsLayout>
  );
}
```

The `key` prop on `<TemplateEditor>` forces a remount when the customer or doc type changes — that re-runs the editor's `useState` initializers AND fires its `onColorsChange` callback (from Task 9 step 7), syncing `liveColors` to the new template's saved colors.

- [ ] **Step 2: Delete the old `[type].js` page**

```bash
rm pages/settings/document-designer/[type].js
```

If your shell needs the brackets escaped on bash:
```bash
rm "pages/settings/document-designer/[type].js"
```

- [ ] **Step 3: Verify the file structure**

Run: `ls pages/settings/document-designer/`
Expected: only `index.js` (no `[type].js`).

Run: `node --test tests/document-sections-constants.test.mjs tests/validate-section-config.test.mjs`
Expected: 21/21 pass.

- [ ] **Step 4: Commit**

```bash
git add pages/settings/document-designer/index.js components/settings/document-designer/TemplateEditor.js
git rm pages/settings/document-designer/[type].js
git commit -m "feat(doc-designer): unified page with Configuration Bar (FU-035-F)"
```

---

## Task 11: Manual browser verification

**Files:** none changed (verification only)

- [ ] **Step 1: Browser test**

Tell the user verbatim:

> "Implementation complete. Please open `http://localhost:51146/settings/document-designer` and verify:
>
> 1. The page loads with: page header at top → Configuration Bar (Customer dropdown / Document Type dropdown / Accent color picker / Text color picker) → side-by-side TemplateEditor (toggles + preview).
> 2. The Customer dropdown shows 'All Customers' first, then every customer org. Customers with existing overrides are prefixed with a `●` (Unicode bullet).
> 3. The Document Type dropdown shows 'Delivery Order — Full' and 'Delivery Order — Next Move'.
> 4. The preview's tenant name and logo come from your real tenant settings (replacing the 'Your Company' placeholder).
> 5. Change accent color to red — preview's blue bands turn red instantly.
> 6. Change Customer dropdown to a customer that doesn't have an override yet — amber inline note appears: 'This customer doesn't have an override yet. Saving creates one.' Editor loads with default values.
> 7. Toggle a section/field, then click Save. The amber note disappears and a `●` appears next to that customer in the dropdown.
> 8. Toggle another field (don't save), then change the customer dropdown — confirm dialog appears: 'You have unsaved changes. Discard them?'. Cancel keeps you on the current customer; OK switches and discards.
> 9. URL updates as you change dropdowns: `?type=delivery_order_next_move&customer=<id>`.
> 10. Open `http://localhost:51146/settings/document-designer?type=delivery_order_next_move&customer=<existing-customer-id>` directly — it loads that customer's override for that doc type.
> 11. Resize browser narrow — Configuration Bar wraps to 2 columns; editor + preview stack vertically.
> 12. The old `/settings/document-designer/delivery_order_full` URL is gone (404). The settings sidebar entry still points to `/settings/document-designer` (root).
>
> Reply 'verified' or screenshot anything off."

- [ ] **Step 2: Address any issues**

If the user reports issues, fix them inline. Common likely issues:
- Color picker doesn't update the preview → check the `onColorsChange` chain from ConfigurationBar through to TemplateEditor.
- Customer dropdown is empty → check `/api/tenant/organizations?type=customer` returns data and Task 1's permission widening was deployed.
- Tenant name in preview is still 'Your Company' → check `/api/tenant/me` returned `branding.companyName`; if not, the tenant_settings row may not have `company_display_name` set yet.
- Unsaved changes dialog never appears → check that `onDirtyChange` is firing in TemplateEditor (add a temporary console.log if needed).
- Confirm dialog appears even on identical state → check the `isDirty` calculation in TemplateEditor for a JSON.stringify ordering issue (object keys in different order can be falsely flagged dirty).

- [ ] **Step 3: Update `memory/followups.md`**

Mark FU-035-F as `Status: RESOLVED 2026-04-26 (HEAD: <last-commit-sha>)`. Note remaining work: FU-035-D2 (PDF render layout), FU-035-G (watermark/disclaimer/named configs), FU-035-H1+ (other doc types), and the validate-section-config field-ID validation follow-up still pending.

Run: invoke the `update-followups` skill if the user has it configured.

- [ ] **Step 4: Final commit (only if Step 2 produced fixes)**

```bash
git status
# If clean, no commit needed.
# If fixes applied:
git add <files> && git commit -m "fix(doc-designer): <specific fix> (FU-035-F)"
```

---

## Notes for the implementing agent

- **Task 9 makes `<TemplateEditor>` use controlled colors** (`colors` + `onColorsChange` props from the page). The internal `useState` keeps only `{ visibility, fields }`; `colors` flows in from the page via prop. The `useEffect` that re-syncs on template prop change calls `onColorsChange(savedColors)` so the page's `liveColors` stays consistent with whichever template just loaded.
- **Task 1 (permission change) MUST land before the page** — the customer list fetch fails otherwise.
- **No new dependencies, no migrations.** Everything is additive to existing data shapes.
- **Conventions:** `dev_dark_mode_convention` (every gray/white/border class needs a `dark:` variant on the editor side; preview pane stays light). `dev_pricing_detail_restructure` doesn't apply.
- **No test harness for React UI components** — verification is unit tests for pure functions (Tasks 2 + 3) and manual browser check (Task 11) for the rest. This is the codebase pattern.
- **The `tenants` and `tenant_settings` rows must already exist** for `/api/tenant/me` to return useful branding. If a tenant has no `tenant_settings` row, `companyName` falls back to `tenants.name`. Logo URLs may be `null` — preview falls back to its placeholder logo box, that's expected.
