# UI Plan B — Cowork Visual QA Verification

## Context

Six load detail tabs were refactored onto design-system primitives (text-muted, text-strong, text-section-title, text-body, text-helper, text-field-label utilities). No structural changes — only inline text-gray-*/dark:text-slate-* class pairs were replaced with the centralized utilities. All behavior is unchanged.

**Project:** `C:\Users\bento\app-drayagedirect` — Next.js 15, Tailwind v4.

**Dev server:** `npm run dev`. URL: `http://localhost:3000`.

---

## What Changed (summary)

| Tab | File | Swaps | Key Changes |
|---|---|---|---|
| NotesTab | `components/loads/tabs/NotesTab.js` | 3 | Section title, description, note body |
| TrackingTab | `components/loads/tabs/TrackingTab.js` | 15 | Header, sidebar, KPI cards, timeline entries |
| DocumentsTab | `components/loads/tabs/DocumentsTab.js` | 6 | Upload bar, file names across all 3 sections |
| AuditTab | `components/loads/tabs/AuditTab.js` | 6 | Section header, action labels, description, diff values |
| BillingTab | `components/loads/tabs/BillingTab.js` | 13 | Summary cards, charge set headers, 5 form labels, line items |
| LoadInfoTab | `components/loads/tabs/LoadInfoTab.js` | 4 | Load Type field label/value/helper, Holds row labels |

**Total:** 47 utility class swaps across 6 files.

---

## Verification Steps

### For each of the 6 tabs:

1. **Navigate** to any load in `/dispatcher`, click into its detail view
2. **Click the tab** and verify:
   - All text is visible and readable (no invisible/same-as-background text)
   - Section titles are present and properly styled
   - Labels appear above fields
   - Helper/description text appears below in smaller muted text
   - No blank sections or missing content

3. **Toggle dark mode** and verify:
   - Text contrast is sufficient (no dark-on-dark or light-on-light)
   - Section borders and backgrounds shift appropriately
   - Muted text is clearly distinguishable from strong text

4. **Zoom test** (80%, 100%, 125%):
   - Layout doesn't break
   - Text doesn't overflow or clip
   - Fields stay aligned in their grid

5. **Compact mode** (if available via data-compact toggle):
   - Spacing tightens
   - Font sizes shrink
   - Layout stays intact

---

## Per-Tab Behavior Checks

### NotesTab
- Add a note to any audience (Driver, Billing, Yard, Load, Terminal)
- Verify the note appears in the list with author + timestamp
- Edit a note, confirm inline edit works
- Delete a note, confirm removal

### TrackingTab
- Map loads and renders (if load has routing events)
- Click a routing event in the left sidebar — map should pan
- KPI cards (Drive Time, Dwell Time, Distance, Avg Speed) show values
- Timeline entries render with icons + timestamps

### DocumentsTab
- Upload a document using the upload bar
- If pending submissions exist, Approve/Reject buttons work
- Approved documents list renders with file icons + metadata
- Invoice attachment toggle works

### AuditTab
- Audit trail loads and populates
- Category filter pills work (click to filter)
- Search bar filters entries
- Field-level changes show "Changed To / Set To" format

### BillingTab
- Summary cards show correct counts
- Recalculate Rates button works
- New Charge Set creation works
- Line items render in table with editable cells
- Status workflow buttons (Approve, Invoice, etc.) function correctly
- Add Line form: charge code dropdown, UOM, rate, description all work

### LoadInfoTab
- All fields save on blur (green flash = success)
- OrgPicker dropdowns work for all location slots
- Date pickers open and save
- Equipment flags toggle and save
- Holds toggle between Hold/Released
- Load Type shows as read-only with helper text

---

## What NOT to Check

- **DriverPayTab** — not refactored (excluded from Plan B, in-flight pricing QA)
- **RoutingTab** — not refactored (too volatile during pricing verification)
- **Modals** — not refactored (deferred to UI Plan D)
- **LoadSidebar / LoadDetailLayout** — shell chrome not touched

---

## Report Template

```
UI Plan B Visual QA Report — 2026-04-15

Light Mode:
  NotesTab:      <PASS/FAIL> — <notes>
  TrackingTab:   <PASS/FAIL> — <notes>
  DocumentsTab:  <PASS/FAIL> — <notes>
  AuditTab:      <PASS/FAIL> — <notes>
  BillingTab:    <PASS/FAIL> — <notes>
  LoadInfoTab:   <PASS/FAIL> — <notes>

Dark Mode:
  NotesTab:      <PASS/FAIL> — <notes>
  TrackingTab:   <PASS/FAIL> — <notes>
  DocumentsTab:  <PASS/FAIL> — <notes>
  AuditTab:      <PASS/FAIL> — <notes>
  BillingTab:    <PASS/FAIL> — <notes>
  LoadInfoTab:   <PASS/FAIL> — <notes>

Zoom (80/100/125%):
  Any layout breaks: <YES/NO — describe>

Compact Mode:
  Spacing tightens: <YES/NO>
  Layout intact:    <YES/NO>

Behavior Regressions:
  Any feature broken: <YES/NO — describe>

Browser Console Errors: <list any>
Dev Server Terminal Errors: <list any>
```
