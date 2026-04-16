import { Trash2, Info, ChevronDown } from 'lucide-react';
import OrgPicker from '../../ui/OrgPicker';
import ReferenceDataPicker from '../../ui/ReferenceDataPicker';
import ContainerOwnerPicker from '../../ui/ContainerOwnerPicker';
import EffectiveDateRange from '../../ui/EffectiveDateRange';

// Load types available in tariffs.
// Mirrors the canonical LOAD_TYPES list in components/loads/NewLoadModal.js,
// EXCLUDING 'Bill Only' — bill-only loads are manual one-offs (no operations,
// just an invoice) so they should never be matched by an automated tariff.
//
// Stored uppercase in tariffs (e.g. 'IMPORT'), but compared case-insensitively
// against orders.load_type which is stored lowercase ('import').
const LOAD_TYPES = [
  { value: 'IMPORT', label: 'Import' },
  { value: 'INBOUND', label: 'Inbound' },
  { value: 'EXPORT', label: 'Export' },
  { value: 'OUTBOUND', label: 'Outbound' },
  { value: 'ROAD', label: 'Road' },
];

// All flags from FLAG_DEFS
const FLAG_DEFS = [
  { key: 'is_hazmat', label: 'Hazmat' },
  { key: 'is_overweight', label: 'Overweight' },
  { key: 'is_liquor', label: 'Liquor' },
  { key: 'is_hot', label: 'Hot' },
  { key: 'is_genset', label: 'Genset' },
  { key: 'is_ev', label: 'EV' },
  { key: 'is_street_turn', label: 'Street Turn' },
  { key: 'is_overheight', label: 'Overheight' },
  { key: 'is_scale', label: 'Scale' },
  { key: 'is_oog', label: 'OOG' },
  { key: 'is_bonded', label: 'Bonded' },
  { key: 'is_double', label: 'Double' },
  { key: 'is_tanker', label: 'Tanker' },
];

/**
 * TariffMatchingPanel — left panel of the tariff detail page.
 *
 * Owns no state of its own. Receives the entire form object plus handler
 * callbacks and renders all matching conditions: name, draft, dates, load
 * types, customers, location filters, container/SSL/CSR/chassis fields,
 * flags.
 *
 * Part of the Plan G1 decomposition. Behavior is verbatim from the original
 * inline JSX in pages/settings/tariffs/[id].js. The promoted primitives
 * <LoadTypeChips> and <EffectiveDateRange> are adopted in place of the
 * matching inline JSX.
 */
export default function TariffMatchingPanel({
  form,
  update,
  toggleLoadType,
  toggleFlag,
  toggleLocationAll,
  addLocationId,
  removeLocationId,
  isLocationAll,
  showAdditional,
  onShowAdditionalChange,
  customerLabels,
  setCustomerLabels,
}) {
  return (
    <div className="w-[280px] lg:w-[320px] shrink-0 border-r border-gray-200 dark:border-slate-700 overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/60">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
          <Info className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
          Load Matching Conditions
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Tariff Name */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Load Tariff Name</label>
          <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)}
            placeholder="Enter Tariff Name"
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40" />
        </div>

        {/* Draft toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.status === 'draft'}
            onChange={(e) => update('status', e.target.checked ? 'draft' : 'active')}
            className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-4 h-4" />
          <span className="text-sm text-gray-700 dark:text-slate-200">Draft</span>
        </label>

        {/* Effective Dates */}
        <EffectiveDateRange
          start={form.effective_start}
          end={form.effective_end}
          onStartChange={(val) => update('effective_start', val)}
          onEndChange={(val) => update('effective_end', val)}
          startRequired
          endRequired
        />

        {/* Load Type — multi-select checkboxes */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Load Type</label>
          <div className="space-y-1">
            {LOAD_TYPES.map((lt) => (
              <label key={lt.value} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.load_types.includes(lt.value)}
                  onChange={() => toggleLoadType(lt.value)}
                  className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5" />
                <span className="text-xs text-gray-700 dark:text-slate-200">{lt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Customer */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Customer</label>
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input type="checkbox"
              checked={form.customer_ids.length === 0}
              onChange={() => update('customer_ids', [])}
              className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5" />
            <span className="text-xs text-gray-700 dark:text-slate-200">All Customers</span>
          </label>
          {form.customer_ids.length > 0 && (
            <div className="space-y-1 mb-2">
              {form.customer_ids.map((cid) => (
                <div key={cid} className="flex items-center justify-between bg-gray-50 dark:bg-slate-900 rounded px-2 py-1">
                  <span className="text-xs text-gray-700 dark:text-slate-200 truncate">{customerLabels[cid] || cid.slice(0, 8)}</span>
                  <button type="button" onClick={() => {
                    update('customer_ids', form.customer_ids.filter((i) => i !== cid));
                  }} className="text-gray-400 dark:text-slate-500 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
          <OrgPicker type="customer" placeholder="Add customer..."
            onChange={(org) => {
              if (org) {
                update('customer_ids', [...form.customer_ids, org.id]);
                if (setCustomerLabels) {
                  setCustomerLabels((prev) => ({ ...prev, [org.id]: org.name }));
                }
              }
            }} />
        </div>

        {/* Pick Up Location */}
        <LocationConditionField
          label="* Pick Up Location"
          field="pickup_conditions"
          form={form}
          isAll={isLocationAll('pickup_conditions')}
          onSetAll={() => toggleLocationAll('pickup_conditions')}
          onAddLocation={(orgId, name) => addLocationId('pickup_conditions', orgId, name)}
          onRemoveLocation={(orgId) => removeLocationId('pickup_conditions', orgId)}
          orgType="terminal"
        />

        {/* Delivery Location */}
        <LocationConditionField
          label="* Delivery Location"
          field="delivery_conditions"
          form={form}
          isAll={isLocationAll('delivery_conditions')}
          onSetAll={() => toggleLocationAll('delivery_conditions')}
          onAddLocation={(orgId, name) => addLocationId('delivery_conditions', orgId, name)}
          onRemoveLocation={(orgId) => removeLocationId('delivery_conditions', orgId)}
          orgType="warehouse"
        />

        {/* Return Location */}
        <LocationConditionField
          label="Return Location"
          field="return_conditions"
          form={form}
          isAll={isLocationAll('return_conditions')}
          onSetAll={() => toggleLocationAll('return_conditions')}
          onAddLocation={(orgId, name) => addLocationId('return_conditions', orgId, name)}
          onRemoveLocation={(orgId) => removeLocationId('return_conditions', orgId)}
          orgType="terminal"
        />

        {/* ── Additional Load Conditions ─────────── */}
        <button type="button" onClick={() => onShowAdditionalChange(!showAdditional)}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200 mt-2">
          Additional Load Conditions
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdditional ? '' : '-rotate-90'}`} />
        </button>

        {showAdditional && (
          <div className="space-y-3 pl-1">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Container Type</label>
              <ReferenceDataPicker endpoint="/api/tenant/reference-data/container-types"
                value={form.container_type}
                onChange={(item) => update('container_type', item?.code || null)} placeholder="Select..." />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Container Size</label>
              <ReferenceDataPicker endpoint="/api/tenant/reference-data/container-sizes"
                value={form.container_size}
                onChange={(item) => update('container_size', item?.code || null)} placeholder="Select..." />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">SSL</label>
              <ContainerOwnerPicker value={form.ssl_id}
                onChange={(owner) => update('ssl_id', owner?.id || null)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Chassis Type</label>
              <ReferenceDataPicker endpoint="/api/tenant/reference-data/chassis-types"
                value={form.chassis_type}
                onChange={(item) => update('chassis_type', item?.code || null)} placeholder="Select..." />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Chassis Size</label>
              <ReferenceDataPicker endpoint="/api/tenant/reference-data/chassis-sizes"
                value={form.chassis_size}
                onChange={(item) => update('chassis_size', item?.code || null)} placeholder="Select..." />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Chassis Owner</label>
              <input type="text" value={form.chassis_owner || ''} onChange={(e) => update('chassis_owner', e.target.value)}
                placeholder="Select..."
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>
        )}

        {/* Flags */}
        <div className="space-y-1 pt-2">
          {FLAG_DEFS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form[f.key]}
                onChange={() => toggleFlag(f.key)}
                className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5" />
              <span className="text-xs text-gray-700 dark:text-slate-200">{f.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Reusable Location Condition Field ─────────────────────────
function LocationConditionField({ label, field, form, isAll, onSetAll, onAddLocation, onRemoveLocation, orgType }) {
  const conditions = form[field] || {};
  const locationIds = conditions.ids || [];
  const labels = conditions.labels || {};

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{label}</label>
      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input type="checkbox" checked={isAll} onChange={onSetAll}
          className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5" />
        <span className="text-xs text-gray-700 dark:text-slate-200">All Locations</span>
      </label>
      {!isAll && locationIds.length > 0 && (
        <div className="space-y-1 mb-2">
          {locationIds.map((lid) => (
            <div key={lid} className="flex items-center justify-between bg-gray-50 dark:bg-slate-900 rounded px-2 py-1">
              <span className="text-xs text-gray-700 dark:text-slate-200 truncate">{labels[lid] || lid.slice(0, 8)}</span>
              <button type="button" onClick={() => onRemoveLocation(lid)}
                className="text-gray-400 dark:text-slate-500 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
      {!isAll && (
        <OrgPicker type={orgType} placeholder={`Add ${orgType}...`}
          onChange={(org) => { if (org) onAddLocation(org.id, org.name); }} />
      )}
    </div>
  );
}
