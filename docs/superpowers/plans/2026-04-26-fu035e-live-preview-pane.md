# FU-035-E Live Preview Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a side-by-side HTML preview pane to the Document Designer editor at `/settings/document-designer/[type]`. As tenants toggle sections / fields, the preview re-renders instantly to show what the document will look like — mirroring PortPro's editor + preview UX. Preview pane lives inside `<TemplateEditor>` so every active editor (tenant default + each expanded customer override) automatically gets its own side-by-side preview.

**Architecture:** Parallel HTML preview components in `components/settings/document-designer/preview/` (one per data-rich section). Each preview component takes `{ data, opts }` matching its PDF counterpart's shape. A `<DocumentPreview>` orchestrator iterates the section registry, looks up the preview component for each visible section, and passes resolved `opts.fields` from `computeVisibility`. Sample data lives in `lib/document-designer/sample-data.js` with explicit shape coupling to `buildSectionData(doc)` from the composer.

**Tech Stack:** Next.js 14, React, Tailwind CSS (with `dark:` variants required), `lucide-react` icons. ES modules. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-04-26-fu035e-live-preview-pane-design.md`](../specs/2026-04-26-fu035e-live-preview-pane-design.md)

---

## Task 1: Sample data module

**Files:**
- Create: `lib/document-designer/sample-data.js`

- [ ] **Step 1: Create the sample-data module**

Write `lib/document-designer/sample-data.js`:

```js
// Mirror this shape against buildSectionData() in components/pdf/DeliveryOrderTemplate.js —
// drift here means the preview shows different content than the printed PDF.
//
// Sample data uses ABC123 placeholders for fields and "Your Company" / sample address
// for tenant info. Real tenant info wiring is FU-035-F (fetches from /api/tenant/me).

const sampleData = {
  header: {
    tenantName: 'Your Company',
    tenantInfo: {
      logo_url: null,
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
    text: 'Disclaimer text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
```

- [ ] **Step 2: Commit**

```bash
git add lib/document-designer/sample-data.js
git commit -m "feat(doc-designer): sample data module for live preview pane (FU-035-E)"
```

---

## Task 2: `HeaderPreview` component

**Files:**
- Create: `components/settings/document-designer/preview/HeaderPreview.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/preview/HeaderPreview.js`:

```jsx
/**
 * HTML preview of the Header section. Mirrors components/pdf/sections/Header.js
 * but renders to plain HTML for the live preview pane in the Document Designer.
 *
 * Two-column layout: left = tenant identity (logo / company name / address /
 * phone / website); right = document title + optional subtitle in an accent band.
 *
 * `opts.fields`: { logo, address, phone, website, company_name }.
 * Default-true except `website` (matches registry).
 */
export default function HeaderPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
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
            <div className="text-base font-semibold text-gray-900">
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
        <div className="inline-block px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold">
          Delivery Order # : ABC123
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/HeaderPreview.js
git commit -m "feat(doc-designer): HeaderPreview HTML component (FU-035-E)"
```

---

## Task 3: `DeliveryOrderDetailsPreview` component

**Files:**
- Create: `components/settings/document-designer/preview/DeliveryOrderDetailsPreview.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/preview/DeliveryOrderDetailsPreview.js`:

```jsx
/**
 * HTML preview of the Delivery Order Details section. Mirrors
 * components/pdf/sections/DeliveryOrderDetails.js as a 5-col flex row of
 * label-value pairs.
 *
 * `opts.fields`: { delivery_order_number, pickup_number, driver_name,
 *                  delivery_appointment, reference_number }
 */
export default function DeliveryOrderDetailsPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const rows = [
    fields.delivery_order_number !== false && data.delivery_order_number
      ? ['Delivery Order #', data.delivery_order_number] : null,
    fields.pickup_number !== false && data.pickup_number
      ? ['Pickup #', data.pickup_number] : null,
    fields.driver_name !== false && data.driver_name
      ? ['Driver', data.driver_name] : null,
    fields.delivery_appointment !== false && data.delivery_appointment
      ? ['Delivery Appt', data.delivery_appointment] : null,
    fields.reference_number !== false && data.reference_number
      ? ['Reference #', data.reference_number] : null,
  ].filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4 pb-3 border-b border-gray-200">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-[100px]">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
            {label}
          </div>
          <div className="text-xs text-gray-900">{value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/DeliveryOrderDetailsPreview.js
git commit -m "feat(doc-designer): DeliveryOrderDetailsPreview HTML component (FU-035-E)"
```

---

## Task 4: `AddressDetailsPreview` component

**Files:**
- Create: `components/settings/document-designer/preview/AddressDetailsPreview.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/preview/AddressDetailsPreview.js`:

```jsx
function AddressBlock({ label, org }) {
  if (!org || !org.name) return null;
  const cityLine = [org.city, org.state, org.zip].filter(Boolean).join(', ');
  return (
    <div>
      <div className="px-2 py-1 bg-blue-600 text-white text-[10px] uppercase tracking-wider font-semibold rounded-t">
        {label}
      </div>
      <div className="px-2 py-1.5 border border-gray-200 border-t-0 rounded-b">
        <div className="text-xs font-semibold text-gray-900">{org.name}</div>
        {org.address_line1 ? (
          <div className="text-[11px] text-gray-700">{org.address_line1}</div>
        ) : null}
        {cityLine ? <div className="text-[11px] text-gray-700">{cityLine}</div> : null}
      </div>
    </div>
  );
}

/**
 * HTML preview of the Address Details section. Mirrors
 * components/pdf/sections/AddressDetails.js. Renders 1-4 address blocks in
 * a horizontal grid (Customer / Pickup / Delivery / Return), then optional
 * contact + appointment-times rows below.
 *
 * `opts.fields`: { customer, pickup_location, delivery_location,
 *                  return_location, appointment_times,
 *                  display_pickup_for_operational_street_turns }
 */
export default function AddressDetailsPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const showCustomer  = fields.customer          !== false;
  const showPickup    = fields.pickup_location   !== false;
  const showDelivery  = fields.delivery_location !== false;
  const showReturn    = fields.return_location   !== false;
  const showApptTimes = fields.appointment_times !== false;
  const showStreetTurn = fields.display_pickup_for_operational_street_turns === true;

  const blocks = [];
  if (showCustomer && data.customer) {
    blocks.push(<AddressBlock key="customer" label="Customer" org={data.customer} />);
  }
  if (showPickup && data.pickup_location) {
    blocks.push(<AddressBlock key="pickup" label="Pick Up Location" org={data.pickup_location} />);
  }
  if (showDelivery && data.delivery_location) {
    blocks.push(<AddressBlock key="delivery" label="Delivery Location" org={data.delivery_location} />);
  }
  if (showReturn && data.return_location) {
    blocks.push(<AddressBlock key="return" label="Return Location" org={data.return_location} />);
  }

  const phone = data.customer?.phone;
  const email = data.customer?.email;
  const apptPickup = data.appointment_times?.pickup;
  const apptDelivery = data.appointment_times?.delivery;

  if (blocks.length === 0 && !phone && !email && !showApptTimes && !showStreetTurn) return null;

  return (
    <div className="mb-4 pb-3 border-b border-gray-200">
      {blocks.length > 0 ? (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))` }}
        >
          {blocks}
        </div>
      ) : null}
      {showCustomer && (phone || email) ? (
        <div className="flex gap-6 mt-2">
          {phone ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                Phone
              </div>
              <div className="text-xs text-gray-900">{phone}</div>
            </div>
          ) : null}
          {email ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                Email
              </div>
              <div className="text-xs text-gray-900">{email}</div>
            </div>
          ) : null}
        </div>
      ) : null}
      {showApptTimes && (apptPickup || apptDelivery) ? (
        <div className="flex gap-6 mt-2">
          {apptPickup ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                Pickup Time
              </div>
              <div className="text-xs text-gray-900">{apptPickup}</div>
            </div>
          ) : null}
          {apptDelivery ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                Delivery Time
              </div>
              <div className="text-xs text-gray-900">{apptDelivery}</div>
            </div>
          ) : null}
        </div>
      ) : null}
      {showStreetTurn && data.is_operational_street_turn ? (
        <div className="mt-2 italic text-xs text-gray-700">Operational Street Turn</div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/AddressDetailsPreview.js
git commit -m "feat(doc-designer): AddressDetailsPreview HTML component (FU-035-E)"
```

---

## Task 5: `OrderDetailsPreview` component

**Files:**
- Create: `components/settings/document-designer/preview/OrderDetailsPreview.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/preview/OrderDetailsPreview.js`:

```jsx
/**
 * HTML preview of the Order Details section. Mirrors
 * components/pdf/sections/OrderDetails.js. Renders 19 toggleable fields as a
 * 3-column label-value grid, only including fields whose toggle is on AND
 * whose value is non-empty.
 *
 * `opts.fields`: 19 keys per spec §4 of the FU-035-D design.
 */
const FIELD_ORDER = [
  ['reference_number',      'Reference #'],
  ['booking_bl',            'Booking/BL'],
  ['mbol',                  'MBOL #'],
  ['hbol',                  'HBOL #'],
  ['container_number',      'Container #'],
  ['container_size',        'Container Size'],
  ['container_type',        'Container Type'],
  ['chassis_number',        'Chassis #'],
  ['chassis_size',          'Chassis Size'],
  ['chassis_type',          'Chassis Type'],
  ['chassis_owner',         'Chassis Owner'],
  ['steamship_line',        'Steamship Line'],
  ['seal',                  'Seal #'],
  ['hazmat',                'Hazmat'],
  ['pickup_number',         'Pickup #'],
  ['pull_container_date',   'Pull Container Date'],
  ['return_container_date', 'Return Container Date'],
  ['last_free_day',         'Last Free Day'],
  ['per_diem_free_day',     'Per Diem Free Day'],
];

export default function OrderDetailsPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value];
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <div className="mb-4 pb-3 border-b border-gray-200">
      <div className="text-[10px] uppercase tracking-wider font-bold text-gray-700 mb-2">
        Order Details
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex">
            <div className="text-[11px] text-gray-600 font-medium min-w-[110px]">
              {label}
            </div>
            <div className="text-[11px] text-gray-900">: {value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/OrderDetailsPreview.js
git commit -m "feat(doc-designer): OrderDetailsPreview HTML component (FU-035-E)"
```

---

## Task 6: `CommodityDetailsPreview` component

**Files:**
- Create: `components/settings/document-designer/preview/CommodityDetailsPreview.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/preview/CommodityDetailsPreview.js`:

```jsx
/**
 * HTML preview of the Commodity Details section. Renders a 5-column table
 * (Commodity / Description / Weight / Pallets / Pieces) with one sample row.
 *
 * `opts.fields`: { commodity, description, weight, pallets, pieces }.
 * Default-true. If a column is toggled off, that <th>/<td> isn't rendered.
 */
const COL_ORDER = [
  ['commodity',   'Commodity'],
  ['description', 'Description'],
  ['weight',      'Weight'],
  ['pallets',     'Pallets'],
  ['pieces',      'Pieces'],
];

export default function CommodityDetailsPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const cols = COL_ORDER.filter(([key]) => fields[key] !== false);
  if (cols.length === 0) return null;

  return (
    <div className="mb-4">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {cols.map(([key, label]) => (
              <th
                key={key}
                className="px-2 py-1.5 bg-blue-600 text-white text-[10px] uppercase tracking-wider font-semibold text-left border border-blue-700"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {cols.map(([key]) => (
              <td key={key} className="px-2 py-1.5 border border-gray-200 text-gray-900">
                {data[key] || '—'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/CommodityDetailsPreview.js
git commit -m "feat(doc-designer): CommodityDetailsPreview HTML component (FU-035-E)"
```

---

## Task 7: `NotesPreview` component

**Files:**
- Create: `components/settings/document-designer/preview/NotesPreview.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/preview/NotesPreview.js`:

```jsx
/**
 * HTML preview of the Notes section. Renders 5 toggleable note types as a
 * vertical list with label + body. Mirrors components/pdf/sections/Notes.js.
 *
 * `opts.fields`: { driver_notes, yard_notes, customer_notes, billing_notes, load_notes }
 * Default-true for all except billing_notes (defaultVisible: false in registry).
 */
const NOTE_ORDER = [
  ['driver_notes',   'Driver Notes'],
  ['yard_notes',     'Yard Notes'],
  ['customer_notes', 'Customer Notes'],
  ['billing_notes',  'Billing Notes'],
  ['load_notes',     'Load Notes'],
];

export default function NotesPreview({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const visible = NOTE_ORDER
    .map(([key, label]) => {
      const enabled = key === 'billing_notes' ? fields[key] === true : fields[key] !== false;
      if (!enabled) return null;
      const value = data[key];
      if (!value) return null;
      return [label, value];
    })
    .filter(Boolean);

  if (visible.length === 0) return null;

  return (
    <div className="mb-4 pb-3 border-b border-gray-200 space-y-1.5">
      {visible.map(([label, value]) => (
        <div key={label}>
          <span className="text-[11px] font-semibold text-gray-700">{label}: </span>
          <span className="text-[11px] text-gray-900">{value}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/NotesPreview.js
git commit -m "feat(doc-designer): NotesPreview HTML component (FU-035-E)"
```

---

## Task 8: `SignaturePreview` component

**Files:**
- Create: `components/settings/document-designer/preview/SignaturePreview.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/preview/SignaturePreview.js`:

```jsx
/**
 * HTML preview of the Signature Block. Renders Print Name / Receiver
 * Signature / Time In / Time Out / Date as labeled signature lines at the
 * bottom of the document.
 *
 * No `opts.fields` — Signature is a master-toggle-only section in the registry
 * (children deferred to FU-035-D2).
 */
export default function SignaturePreview({ data }) {
  if (!data) return null;
  return (
    <div className="mt-6 pt-4 border-t border-gray-300">
      <div className="grid grid-cols-3 gap-6">
        <div>
          <div className="border-b border-gray-400 h-6 flex items-end pb-1">
            <span className="text-[11px] text-gray-900">{data.print_name || ''}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Print Name</div>
        </div>
        <div>
          <div className="border-b border-gray-400 h-6 flex items-end pb-1">
            <span className="text-[11px] text-gray-900">{data.signature || ''}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Receiver Signature</div>
        </div>
        <div>
          <div className="border-b border-gray-400 h-6 flex items-end pb-1">
            <span className="text-[11px] text-gray-900">{data.date || ''}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Date</div>
        </div>
        <div>
          <div className="border-b border-gray-400 h-6 flex items-end pb-1">
            <span className="text-[11px] text-gray-900">{data.time_in || ''}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Time In</div>
        </div>
        <div>
          <div className="border-b border-gray-400 h-6 flex items-end pb-1">
            <span className="text-[11px] text-gray-900">{data.time_out || ''}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Time Out</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/SignaturePreview.js
git commit -m "feat(doc-designer): SignaturePreview HTML component (FU-035-E)"
```

---

## Task 9: `DisclaimerPreview` component

**Files:**
- Create: `components/settings/document-designer/preview/DisclaimerPreview.js`

- [ ] **Step 1: Create the component**

Write `components/settings/document-designer/preview/DisclaimerPreview.js`:

```jsx
/**
 * HTML preview of the Disclaimer section. Renders italicized footer text.
 * The actual rich-text editor for the content is FU-035-G.
 *
 * No `opts.fields` — master-toggle-only.
 */
export default function DisclaimerPreview({ data }) {
  if (!data || !data.text) return null;
  return (
    <div className="mt-4 pt-3 border-t border-gray-200">
      <div className="text-[10px] italic text-gray-600 leading-relaxed">{data.text}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/DisclaimerPreview.js
git commit -m "feat(doc-designer): DisclaimerPreview HTML component (FU-035-E)"
```

---

## Task 10: `DocumentPreview` orchestrator + transient banner

**Files:**
- Create: `components/settings/document-designer/preview/DocumentPreview.js`

- [ ] **Step 1: Create the orchestrator**

Write `components/settings/document-designer/preview/DocumentPreview.js`:

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
 * sample data + resolved field-visibility map.
 *
 * `visibility`: { [sectionId]: boolean }
 * `fields`:     { [sectionId]: { [fieldId]: boolean } }
 * `sections`:   the section registry array (DELIVERY_ORDER_SECTIONS or future per-doc-type)
 *
 * The preview pane has a paper-like styling (white bg, shadow, ring). Stays
 * light even in dark mode — printed documents don't have dark mode.
 */
export default function DocumentPreview({ visibility, fields, sections }) {
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
          const data = sampleData[s.id];
          const opts = { fields: fields[s.id] || {} };
          return <Component key={s.id} data={data} opts={opts} />;
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): DocumentPreview orchestrator + transient banner (FU-035-E)"
```

---

## Task 11: Refactor `TemplateEditor` to wrap toggles + preview side-by-side

**Files:**
- Modify: `components/settings/document-designer/TemplateEditor.js`

- [ ] **Step 1: Read the current file to confirm structure**

Run: `node -e "console.log(require('fs').readFileSync('components/settings/document-designer/TemplateEditor.js', 'utf8').slice(0, 2000))"`

Expected: file starts with `import` lines, then `buildInitialState`, then default-export `TemplateEditor` function. State shape is `{ visibility, fields }` plus `collapsed`, `busy`, `savedState`.

- [ ] **Step 2: Add the DocumentPreview import + wrap return JSX in side-by-side flex**

Edit `components/settings/document-designer/TemplateEditor.js`:

After the existing imports (`useEffect`, `useState`, lucide icons, `getSectionsForDocumentType`), add:

```js
import DocumentPreview from './preview/DocumentPreview';
```

Then change the return JSX of the `TemplateEditor` component. The current return is:

```jsx
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {sections.map((s) => (
          <SectionCard ... />
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-slate-700">
        <button onClick={save} ...>Save</button>
        <button onClick={reset} ...>Reset</button>
        {showDelete && template.id ? (
          <button onClick={deleteTemplate} ...>Delete</button>
        ) : null}
      </div>
    </div>
  );
```

Replace with:

```jsx
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Editor side */}
      <div className="lg:w-2/5 space-y-3">
        <div className="space-y-2">
          {sections.map((s) => (
            <SectionCard
              key={s.id}
              section={s}
              masterChecked={visibility[s.id]}
              fieldsState={fields[s.id] || {}}
              collapsed={!!collapsed[s.id]}
              busy={busy}
              onToggleMaster={() => toggleMaster(s.id)}
              onToggleField={(fid) => toggleField(s.id, fid)}
              onToggleCollapsed={() => toggleCollapsed(s.id)}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-slate-700">
          <button
            type="button"
            onClick={save}
            disabled={!isDirty || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
          >
            <Save className="w-4 h-4" />
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!isDirty || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-slate-300 text-sm font-medium"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>
          {showDelete && template.id ? (
            <button
              type="button"
              onClick={deleteTemplate}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 text-red-600 dark:text-red-400 text-sm font-medium"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          ) : null}
        </div>
      </div>

      {/* Preview side */}
      <div className="lg:w-3/5 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <DocumentPreview
          visibility={visibility}
          fields={fields}
          sections={sections}
        />
      </div>
    </div>
  );
```

- [ ] **Step 3: Verify tests still pass**

Run: `node --test tests/document-sections-constants.test.mjs`
Expected: 11/11 pass (this task didn't touch the registry — sanity check).

- [ ] **Step 4: Commit**

```bash
git add components/settings/document-designer/TemplateEditor.js
git commit -m "feat(doc-designer): wrap TemplateEditor with side-by-side preview pane (FU-035-E)"
```

---

## Task 12: Manual browser verification

**Files:** none changed (verification only)

- [ ] **Step 1: Navigate and inspect**

Tell the user verbatim:

> "Implementation complete. Open `http://localhost:51146/settings/document-designer/delivery_order_full` and verify:
>
> 1. The page now has a side-by-side layout: section toggles on the left (40%), document preview on the right (60%).
> 2. The preview pane has a paper-like white background, shadow, rounded corners.
> 3. Above the preview is a small amber banner: 'Preview reflects the upcoming document layout. Printed PDFs use the current layout until the rendering update ships.'
> 4. The preview shows: blue 'Delivery Order #: ABC123' band on the right of header / Logo placeholder + 'Your Company' / company address / phone / 5-col delivery order details / 4-col address blocks (Customer / Pickup / Delivery / Return — all 'SAMPLE NAME' / Elizabeth NJ) / Order Details 3-col grid of Reference # / Booking-BL / MBOL # etc / Notes (5 sample lines if defaults visible) / signature lines at bottom / disclaimer footer.
> 5. Toggle Order Details > Seal # off in the editor — the 'Seal #' row disappears from the preview instantly.
> 6. Toggle the Header section's master toggle off — the entire header (logo / name / address / blue band) disappears.
> 7. Toggle Commodity Details master ON (defaults off) — the 5-col commodity table appears.
> 8. Resize browser to ~768px wide — the layout stacks vertically (preview below editor) instead of side-by-side.
> 9. Scroll the toggle list — preview should stay visible (sticky on the right side of the viewport at desktop widths).
> 10. Expand a customer override accordion item — verify it ALSO renders side-by-side with its own preview.
>
> Report 'verified' if all 10 check, or screenshot + describe anything that looks off."

- [ ] **Step 2: Address user-reported issues**

If the user reports issues, fix them inline. Common likely issues:
- Tailwind class order causing layout glitches → fix specific classes.
- Sticky preview not sticking → check parent container has `flex` and preview has `self-start`.
- Banner too prominent → adjust opacity / colors.
- Preview component data shape mismatch → check sample-data.js against the preview component's expectations.

- [ ] **Step 3: Update `memory/followups.md` to mark FU-035-E resolved**

Run the `update-followups` skill OR directly edit followups.md to:
- Mark FU-035-E with `Status: RESOLVED 2026-04-26 (HEAD: <commit>)`.
- Note that FU-035-D2 and FU-035-F are still open and the recommended next pieces.

- [ ] **Step 4: Final commit (only if step 2 produced fixes)**

```bash
git status
# If clean, no commit needed.
# If fixes applied:
git add <files> && git commit -m "fix(doc-designer): <specific fix> (FU-035-E)"
```

---

## Notes for the implementing agent

- **The 8 preview components (Tasks 2-9) are all parallel — they have no inter-dependencies.** A pragmatic implementer can write all 8 in one sitting and commit them together if controller permits. The plan keeps them as separate tasks for review-grain cleanliness, but the per-component reviews are mostly "did the verbatim code get copied correctly."
- **Task 11 has the most judgment** — the side-by-side flex layout, sticky behavior, and breakpoint fallback. Test in a real browser at multiple widths before committing.
- **No new dependencies.** All components use only React + Tailwind classes already in the project.
- **No tests for the preview components by spec design** — this codebase has no React test harness for UI components. Verification is manual browser per Task 12. The existing `node --test tests/document-sections-constants.test.mjs` should keep passing throughout (no registry changes in this FU).
- **`computeVisibility` is unchanged** — preview consumes the existing `{ visibility, fields }` shape from FU-035-D's resolver. No registry, schema, API, or migration changes in FU-035-E.
- **Conventions to follow:** `dev_dark_mode_convention` (every gray/white/border class needs a `dark:` variant on the editor side; preview side stays light). `dev_pricing_detail_restructure` patterns aren't applicable here — this is a settings page, not a pricing-detail page.
