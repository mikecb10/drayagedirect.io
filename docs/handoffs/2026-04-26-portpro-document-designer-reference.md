# Handoff — PortPro Document Designer reference (FU-035-D through FU-035-H9)

**Created:** 2026-04-26 end of session, after FU-035-A + FU-035-B shipped (commits `1ba77ef` + `e08e680`).

**Why this exists:** the v1 Document Designer we shipped is functional but represents roughly 30% of PortPro's design. The user shared screenshots of PortPro's Document Designer UI as the target UX. This handoff captures what we observed in those screenshots so the next session has a textual source of truth even if photos aren't re-attached.

**To the next session:** ideally re-attach the original PortPro screenshots (they were in the prior session's context only). If you can't, this document plus `memory/followups.md` entries FU-035-D through FU-035-H9 are detailed enough to work from.

---

## What PortPro's Document Designer shows

### Overall layout

- URL pattern: `app.portpro.io/company-settings/account-setup/document-designer`
- Lives under a top-level "Account Setup" tab alongside Accounting, Company Preferences, Connections, Embedded Email Inbox, Equipment, Finance, General, System Generated Emails, Tracking & Appointments
- Sub-tabs at the top of the Document Designer:
  - **Configuration** (default — settings for the document)
  - **Designer** (the visual builder — though our screenshots show the section-toggle list under this header)
- Top-right green button: **"Save as new Configuration"** with a `+` icon (suggests named configurations within a (customer, doc_type) tuple)
- Two-pane layout: left = controls/toggles, right = live preview that updates as you toggle

### Configuration tab (the "Designer" tab in our screenshots)

A vertical scroll of section groups, each with:
- A header row with a master on/off toggle for the section + the section name
- A collapsible body containing the section's child toggles

Visible section groups (top to bottom):

1. **Customer dropdown** at the very top — "All Customers" or pick a specific customer. Dictates whether you're editing the tenant default or a customer-specific override.
2. **Document Type dropdown** — pick which document this configuration applies to. Visible options in screenshot: `Invoice`. Our 10 target types: Invoice, Delivery Order, Proof of Delivery, Rate Confirmation, Combined Invoice, Statement, Credit Memo, Aging Report, Quote, Driver Settlement.
3. **Accent Color** — a color swatch picker (defaults to PortPro's blue `#3B82F6`-ish). Used for header bands, table header rows, the "Invoice #: reference_number" pill in the preview.
4. **Text Color** — a color swatch picker (defaults near-black). Body text color in the preview.
5. **Header section** — master toggle + children:
   - Logo
   - Address
   - Phone
   - Website
   - Company Name
6. **Invoice Details** (this section name will vary per doc type) — master toggle + children:
   - Invoice Number
   - Load Number
   - InvoiceDate
   - Terms
   - DueDate
7. **Address Details** — master toggle + children:
   - Bill To
   - Pick Up Location
   - Delivery Location
   - Return Location
   - Display Pickup Location for Operational Street Turns (special — when checked, shows the pickup org for street-turn moves)
8. **Move Events** — master toggle (no visible sub-toggles in the screenshot, but probably children for each event type)
9. **Order Details** — master toggle + 38+ children (this is the most granular section):
   - Reference #
   - Booking/BL
   - MBOL #
   - HBOL #
   - Pickup Appointment
   - Delivery Appointment
   - Last Free day
   - Per Diem Free Day
   - Pull Container Date
   - Deliver Load Date
   - Return Container Date
   - Container #
   - Container Size
   - Container Type
   - Purchase Order #
   - Hazmat
   - Shipment #
   - Pick Up #
   - Chassis #
   - Chassis Size
   - Chassis Type
   - Chassis Owner
   - Steamship Line
   - Seal #
   - Vessel Name
   - Voyage Name
   - Genset #
   - Appointment #
   - Return #
   - Reservation #
   - Chassis Pickup
   - Chassis Termination
   - Total Distance
   - Gray Pool Container #
   - Gray Pool Chassis #
   - Discharged Date
   - Ingate Date
   - Outgate Date
   - Trailer Number
   - Charge Set #
10. **Commodity Details** — master toggle + children:
    - Commodity
    - Description
    - Weight
    - Pallets
    - Pieces
11. **Charge Details** — master toggle + children:
    - Charge Name
    - Description
    - Units
    - Free Units
    - Rates
    - Charges
    - Hours
12. **Notes** — master toggle + children:
    - Driver Notes
    - Yard Notes
    - Customer Notes
    - Billing Notes
    - Load Notes
13. **Disclaimer** — master toggle + a rich-text editor (B/I/U/S, sub/super, font size selector, font selector, bullet list, numbered list, alignment, link, embedded link, file embed, emoji, image, format remover, undo/redo)
14. **Text to show as watermark for draft Invoice** — single boolean toggle; when on, exposes a text input for the watermark phrase (PortPro screenshot shows it off)

### Live preview pane (right side)

- Starts with company logo placeholder ("Choose your Logo" image dropzone) + tenant name ("PortPro") + tenant address (`805 S Gaffey St, San Pedro, CA 90731, USA`) + tenant phone (`1234567891`)
- Right-aligned: a blue band with `Invoice # : reference_number` (the accent color is applied here)
- Below: 4-column row — `Load # : reference_number` | `Invoice Date : MONTH D...` | `Terms : terms` | `Due Date : MONTH D...`
- 4-column row of address blocks with blue header bands: BILL TO / PICK UP LOCATION / DELIVERY LOCATION / RETURN LOCATION, each with `SAMPLE NAME` + `Sample Address`
- "Order Details" heading, then a 3-column grid of `Label : ABC123` pairs for every active toggle in the Order Details section
- "Commodity" table (5 columns: Commodity / Description / Weight / Pallets / Pieces) with one sample row (`ABC123` in each cell, weight cell shows `LBS` dropdown)
- "Charge Name" table (6 columns: Charge Name / Description / Units / Free Units / Rates / Charges) with one sample row of `ABC123`
- "Customer Notes: SAMPLE customerNotes" line
- "Disclaimer" rich-text editor placeholder area

### Sample data convention

Every value in the preview is `ABC123` or `SAMPLE` text. When toggling, the preview should update instantly (debounced) — no real DB fetches needed for the preview.

---

## What we shipped (FU-035-A + FU-035-B)

- `document_templates` table with cascade resolver (customer-specific → tenant default → system default)
- 12 flat section toggles for Delivery Order (no children, no field-level granularity)
- Accordion list of customer overrides (vs PortPro's single Customer dropdown)
- No live preview
- No color customization
- No watermark / disclaimer / Configuration tab split
- Only 2 document type variants (Full / Next Move Delivery Order); 8 of the 10 target types are not yet registered

The **architecture** is sound (DOCUMENT_TYPES registry, DELIVERY_ORDER_SECTIONS scaling pattern, cascade resolver, composer pattern, `perSection` config slot for field-level options), so the FU-035-D through H9 work is additive expansion, not a rewrite.

---

## Recommended next-session order

1. **FU-035-D** first — hierarchical section schema. Without this, every other FU is blocked.
2. **FU-035-E** preview pane — most usable feature for tenants once D is in.
3. **FU-035-F** Configuration tab + colors — replaces our accordion UX with PortPro's dropdown UX.
4. **FU-035-G** Watermark + Disclaimer (defer named configs unless a tenant asks).
5. **FU-035-H1..H9** new doc types, one at a time, prioritizing by print frequency: Invoice (H1) → Rate Con (H2) → POD (H4) → Statement (H5) → Combined Invoice (H3) → Driver Settlement (H9) → others.

---

## Files to reference in the next session

- `docs/superpowers/specs/2026-04-26-document-designer-ui-design.md` — what we shipped (foundation spec)
- `docs/superpowers/plans/2026-04-26-document-designer-ui.md` — implementation plan for what shipped
- `lib/constants/document-types.js` — registry to grow with new types
- `lib/constants/document-sections.js` — registry to grow with hierarchical children
- `components/settings/document-designer/TemplateEditor.js` — to refactor for nested toggles
- `pages/settings/document-designer/[type].js` — to refactor for Configuration/Designer tab split
- `components/pdf/DeliveryOrderTemplate.js` — composer that consumes section_config; needs to read `colors` and `watermark` once F+G land
- `lib/pdf/resolve-template-config.js` — cascade resolver, no changes needed for D-H

## Risks / sharp edges to know going in

- **Named "Configurations"** — PortPro's "Save as new Configuration" green button suggests N templates per (tenant, customer, doc_type). Our schema is 1 per tuple via partial unique indexes. If named configs are needed, schema migrates: add `name TEXT`, drop the existing partial unique indexes, add `(tenant_id, customer_id, document_type, name)` unique. Recommend asking the user before doing this — it might just be a save button without literal "named" semantics.
- **Existing Invoice + Rate Con templates** — these are hardcoded React-PDF templates today (`InvoiceTemplate.js`, `RateConTemplate.js`). Migrating them into the Document Designer system is the right call but needs care: existing flows (invoice send-email, rate-con send-email) must keep working during the transition.
- **Document Designer for Driver Settlement** is AP-domain, not AR. Mental model is different (period-based, driver-keyed, not load-keyed). Probably gets its own doc-type category, not just another row alongside Invoice.
- **Live preview HTML vs PDF render** — full PDF render on every toggle would be too slow. PortPro almost certainly renders an HTML simulacrum (using the same component shapes as the PDF). Building this means either (a) making each section component render either to React-PDF or to plain HTML based on a context flag, or (b) a parallel HTML version per section. (a) is more work upfront but DRYer; (b) is faster to ship.
