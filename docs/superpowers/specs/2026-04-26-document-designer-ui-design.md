# FU-035-B: Document Designer Settings UI — Design

**Status:** Design approved 2026-04-26 (brainstorm).
**Tracks:** FU-035-B (this session). Builds on FU-035-A (foundation).
**Discovered during:** FU-035 brainstorm tonight, immediately following FU-035-A's ship.

## 1. Goal

Build the visual editor for the per-tenant + per-customer document templates that FU-035-A's schema and resolver now support. After this ships, tenants can manage their Delivery Order templates from `Settings → Document Designer` without writing SQL.

## 2. Scope

### In scope (this session)

- New nav entry in `lib/settings-nav.js` under the "Operations" group, plus an entry in `pages/settings/index.js`'s `ITEM_DESCRIPTIONS` map.
- New page `pages/settings/document-designer/index.js` — document-type chooser (cards for Full DO and Next-Move DO).
- New page `pages/settings/document-designer/[type].js` — editor for a single document type. Renders:
  - Tenant Default panel at the top (always-on; if no row exists, save creates one)
  - Customer Overrides accordion list below
  - "+ Add Customer Override" button → inline customer picker → new override card
- Section-toggle UI: each toggleable section renders as a labeled checkbox row with its description; non-toggleable sections render as a disabled "always on" badge.
- Save / Delete / Reset semantics:
  - **Save** persists `section_config` via PUT (existing template) or POST (new template) on the FU-035-A endpoints.
  - **Delete** removes a customer override (cascade resolver falls back to tenant default).
  - **Reset** re-loads the persisted `section_config` from the server (revert unsaved changes).
- Flash success / error toast pattern using existing `Alert` and the dispatcher-style flash UX where applicable.

### Out of scope (deferred to FU-035-C or v2)

- **Section reordering** (drag-and-drop the section list).
- **Per-section options** (`perSection.equipment_details.show_seal` etc.) — toggles are the 80% case.
- **Live preview iframe** (render the actual PDF as the user toggles).
- **Diff view** between tenant default and customer overrides.
- **Multi-document-type bulk operations** (e.g., "copy this template to all customers").
- **Audit log** of template edits beyond the existing `created_by`/`updated_by` columns.

## 3. Routes + page responsibilities

```
/settings/document-designer
  └── index.js  →  Document type chooser (2 cards: Full DO, Next-Move DO).
                   Each card links to /settings/document-designer/[type].

/settings/document-designer/[type]
  └── [type].js →  Editor for one document type. URL example:
                   /settings/document-designer/delivery_order_full
                   Renders:
                     1. Header (doc type name + description)
                     2. Tenant Default panel (always shown)
                     3. Customer Overrides list + "+ Add" button
                   Validates `[type]` against isValidDocumentType; 404
                   page rendered if invalid.
```

Two pages total — keep the surface tight.

## 4. State + data flow

`[type].js` page-level state:

```jsx
{
  loading: boolean,
  error: string | null,
  tenantDefault: Template | null,        // server-fetched; null if not yet created
  customerOverrides: Template[],          // server-fetched
  expandedOverrideId: string | null,      // accordion state
  addingNew: { customerId, customerName, draftConfig } | null,
}

// Template = { id, customer_id (null for tenant default), document_type, section_config, created_at, updated_at }
```

On mount: `GET /api/tenant/document-templates?document_type=<type>` populates both `tenantDefault` (the row with `customer_id IS NULL`) and `customerOverrides` (rows with non-null `customer_id`).

Each editor panel (Tenant Default + each customer override) is a self-contained component (`<TemplateEditor template={...} onSave onDelete />`) with its own local-edit state (`workingConfig`) so multiple panels can have unsaved changes simultaneously without bleeding into each other.

Save semantics:
- Tenant default with no row → POST (creates).
- Tenant default with existing row → PUT.
- Customer override new → POST.
- Customer override existing → PUT.
- Customer override delete → DELETE → remove from list locally.

After every successful save, replace the local `template` prop with the response body's `template` so `created_at`/`updated_at` stay in sync.

## 5. UI structure

### `index.js` — chooser

```
SettingsLayout
├── Header (icon + "Document Designer" + description)
├── Description text:
│   "Customize how your printed documents look. Pick a document type to edit
│    its tenant default and add customer-specific overrides."
└── 2-column grid of cards:
    ├── Card: "Delivery Order — Full"
    │   "Entire routing across all moves."
    │   → /settings/document-designer/delivery_order_full
    └── Card: "Delivery Order — Next Move"
        "Just the next non-completed move."
        → /settings/document-designer/delivery_order_next_move
```

Cards use `DOCUMENT_TYPES` from `lib/constants/document-types.js` so adding new types auto-renders here.

### `[type].js` — editor

```
SettingsLayout
├── Breadcrumb: Settings → Document Designer → <Doc Type Label>
├── Header (icon + label + description from registry)
├── Error/success Alert (top)
│
├── ─── Tenant Default ─────────────────────────────────
│   Description: "Applied to every load that doesn't have a customer-
│                 specific override."
│   [TemplateEditor template={tenantDefault} ...] (always-expanded)
│
├── ─── Customer Overrides ──────────────────────────────
│   Description: "Customer-specific templates take priority over the
│                 tenant default for loads with that bill-to customer."
│   [+ Add Customer Override] button
│
│   ── Inline new-override form (when adding) ──
│   [OrgPicker (filter: customer)] [Cancel] [Add]
│   On Add: creates a row in DB with default config, expands its editor.
│
│   ── Accordion list of existing overrides ──
│   ▼ Acme Logistics  [Edit] [Delete]
│      [TemplateEditor template={...}]
│   ▶ Walmart Distribution (collapsed)
│   ▶ Target Logistics (collapsed)
```

### `<TemplateEditor template={...} onSave onDelete />` — shared

```
[Section toggles list]
  ├── For each section in DELIVERY_ORDER_SECTIONS:
  │     ├── If toggleable: <Checkbox checked={visibility} onChange={...}> + label + description
  │     └── If !toggleable: greyed-out row with "Always on" badge
[Buttons row]
  ├── [Save] (disabled if no unsaved changes)
  ├── [Reset] (disabled if no unsaved changes)
  └── [Delete] (only on customer overrides; not on tenant default)
```

`workingConfig` is initialized from `template.section_config?.visibility ?? {}` merged with registry defaults. Toggling a checkbox mutates `workingConfig.visibility[sectionId]`. `Save` PUTs the full `{ visibility: workingConfig }` shape (omitting `order` and `perSection` for v1 since we don't edit them).

## 6. New shared components

`components/settings/document-designer/TemplateEditor.js` — the editor sub-component above. Used in both the Tenant Default panel and every Customer Override accordion item.

No other new shared components — using existing primitives:
- `SettingsLayout` (page wrapper)
- `Alert` (errors / success)
- `Button` (Save / Delete / Reset / Add)
- `OrgPicker` (customer search) — already used in umbrellas + multiple AR pages
- Lucide icons: `FileText`, `Plus`, `ChevronDown`, `Trash2`, `RotateCcw`, `Save`

## 7. Permissions

All pages gate behind the same permission used by the FU-035-A API: `SETTINGS | ALL`. The settings-nav entry's `requiredPermission` is set to `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]` — matching peer entries like `dispatcher_colors`, `document_validation`, `equipment_reference`.

If a user without the permission lands on the page directly, the API returns 403 and the page surfaces a "Permission denied" `Alert`.

## 8. Error handling

| Case | Behavior |
|---|---|
| Initial GET fails | Top `Alert` with the error; page shows nothing else; user can refresh. |
| Save POST/PUT 4xx | Inline error in the editor; button re-enables; preserve `workingConfig`. |
| Save 409 (unique violation) | Specific "A template already exists for this scope" error — should never happen for tenant default (idempotent via update path) but possible for customer override if user clicks Add twice. Surface clearly. |
| Save 500 | Generic "Save failed" with `error.message`. |
| Delete failure | Inline error in the override card; card stays in place. |
| Validation 400 | The `validateSectionConfig` helper returns specific messages — surface them verbatim. |
| Permission denied 403 | Page-level `Alert` ("You don't have permission..."). |

## 9. Testing

**Unit tests** — none new. The cascade logic is tested in FU-035-A's `tests/resolve-template-config.test.mjs`. Validation is tested via the API's behavior (404/400/409/500 mapping). UI components don't have a test harness in this codebase.

**Integration / live verification:**

- Subagent static check that the new pages exist, route correctly, import `TemplateEditor`, and call the FU-035-A endpoints with the right shape.
- **Manual browser test by the user** is the primary functional gate: navigate to `/settings/document-designer`, click into Full DO, save the tenant default with one section disabled, check that the next bulk-print run reflects the change.

## 10. File list + LoC estimate

| File | Action | Approx LoC |
|---|---|---|
| `lib/settings-nav.js` | modify (add entry under Operations) | +6 |
| `pages/settings/index.js` | modify (add `ITEM_DESCRIPTIONS` entry) | +1 |
| `pages/settings/document-designer/index.js` | new | 80 |
| `pages/settings/document-designer/[type].js` | new | 200 |
| `components/settings/document-designer/TemplateEditor.js` | new | 130 |

**Total:** ~420 LoC across 5 files. Realistic 1.5-2 hour build including the verification.

## 11. Risk and rollback

**Risk:** moderate — Settings UIs have judgment calls about layout density and copy. Mitigations:
1. Following the `umbrellas` page conventions (same `SettingsLayout` shape, same alert/button primitives).
2. Saving on explicit click only (no auto-save) — fewer surprise side effects.
3. Editor state is local per-panel (not global) so unsaved changes in one customer override don't pollute another.

**Rollback:** revert the commit. Settings sidebar item disappears. The endpoints from FU-035-A keep working — admin SQL remains a viable path.

## 12. Forward path (FU-035-C)

When FU-035-C lands, what changes:
- New section reordering UI in `TemplateEditor.js` (drag-and-drop the toggleable rows).
- Per-section options panels — each section's `perSection` config gets its own small inline form (e.g., a checkbox for `equipment_details.show_seal`).
- Live preview iframe alongside the editor (calls `/api/tenant/loads/bulk-print` with a sample load id).

The `TemplateEditor` component becomes the natural extension point — additive, not restructuring.
