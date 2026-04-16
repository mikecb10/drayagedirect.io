import { Plus, Trash2, DollarSign, Info } from 'lucide-react';
import Button from '../../ui/Button';
import OrgPicker from '../../ui/OrgPicker';
import CentsInput from '../../ui/CentsInput';
import { CHARGE_NAMES, chargeNameLabel, unitLabel } from '../../../lib/charge-profile-constants';

/**
 * TariffChargeSetsPanel — right panel of the tariff detail page.
 *
 * Renders the charge sets list and bubbles every mutation up via callback
 * props. Owns no state.
 *
 * Part of the Plan G1 decomposition. Behavior is verbatim from the original
 * inline JSX in pages/settings/tariffs/[id].js. Inline setChargeSets() calls
 * for bill-to mode/customer changes have been refactored to use the new
 * onUpdateChargeSet(idx, field, value) callback so state ownership stays in
 * the page shell — same setState semantics, just exposed as a named handler.
 */
export default function TariffChargeSetsPanel({
  chargeSets,
  onAddChargeSet,
  onRemoveChargeSet,
  onOpenProfilePicker,
  onRemoveProfile,
  onAddChargeItem,
  onUpdateChargeItem,
  onRemoveChargeItem,
  onUpdateChargeSet,
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="px-5 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/60 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
          Charge Sets
          <Info className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
        </div>
        <Button variant="secondary" onClick={onAddChargeSet} className="!py-1 !px-3 !text-xs">
          <Plus className="w-3 h-3 mr-1 inline" /> Add Charge Set
        </Button>
      </div>

      <div className="p-5">
        {chargeSets.length === 0 ? (
          <div className="text-center py-16 text-gray-400 dark:text-slate-500">
            <DollarSign className="w-8 h-8 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
            <p className="text-sm">No charge sets added yet.</p>
            <p className="text-xs mt-1">Add a charge set, then link charge profiles or add one-off charges.</p>
            <Button variant="secondary" onClick={onAddChargeSet} className="mt-4 !text-xs">
              <Plus className="w-3 h-3 mr-1 inline" /> Add Charge Set
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {chargeSets.map((cs, csIdx) => (
              <div key={csIdx} className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                {/* Charge set header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/70 dark:bg-slate-900/70 border-b border-gray-200 dark:border-slate-700 rounded-t-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">*Bill To</span>
                    <select value={cs.bill_to_mode}
                      onChange={(e) => onUpdateChargeSet(csIdx, 'bill_to_mode', e.target.value)}
                      className="rounded border border-gray-300 dark:border-slate-600 px-2 py-1 text-xs bg-white dark:bg-slate-900">
                      <option value="load_customer">Match Customer</option>
                      <option value="specified">Specific Customer</option>
                    </select>
                    {cs.bill_to_mode === 'specified' && (
                      <div className="w-48">
                        <OrgPicker type="customer" value={cs.bill_to_customer_id} placeholder="Select customer..."
                          onChange={(org) => onUpdateChargeSet(csIdx, 'bill_to_customer_id', org?.id || null)} />
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => onRemoveChargeSet(csIdx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  {/* Linked charge profiles */}
                  {cs.profiles.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">Linked Charge Profiles</div>
                      <div className="space-y-1">
                        {cs.profiles.map((p, pIdx) => (
                          <div key={pIdx} className="flex items-center justify-between bg-blue-50/50 dark:bg-blue-950/40 rounded-lg px-3 py-2 border border-blue-100 dark:border-blue-800">
                            <div className="flex items-center gap-2">
                              <DollarSign className="w-3.5 h-3.5 text-blue-500" />
                              <span className="text-xs font-medium text-gray-900 dark:text-slate-100">{p.name}</span>
                              <span className="text-[10px] text-gray-400 dark:text-slate-500">{chargeNameLabel(p.charge_name)}</span>
                              {p.unit_of_measure && (
                                <span className="text-[9px] bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded">{unitLabel(p.unit_of_measure)}</span>
                              )}
                            </div>
                            <button type="button" onClick={() => onRemoveProfile(csIdx, pIdx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* One-off charge items */}
                  {cs.items.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">One-Off Charges</div>
                      <div className="space-y-2">
                        {cs.items.map((item, itemIdx) => (
                          <div key={itemIdx} className="grid grid-cols-[1fr_1fr_100px_100px_30px] gap-2 items-end">
                            <div>
                              <label className="block text-[10px] text-gray-500 dark:text-slate-400 mb-0.5">Name</label>
                              <input type="text" value={item.name} onChange={(e) => onUpdateChargeItem(csIdx, itemIdx, 'name', e.target.value)}
                                placeholder="Charge name..."
                                className="block w-full rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 dark:text-slate-400 mb-0.5">Code</label>
                              <select value={item.charge_name || ''} onChange={(e) => onUpdateChargeItem(csIdx, itemIdx, 'charge_name', e.target.value)}
                                className="block w-full rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs">
                                <option value="">Select...</option>
                                {CHARGE_NAMES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                              </select>
                            </div>
                            <CentsInput label="Amount" value={item.amount_cents}
                              onChange={(cents) => onUpdateChargeItem(csIdx, itemIdx, 'amount_cents', cents)} />
                            <CentsInput label="Min" value={item.minimum_amount_cents}
                              onChange={(cents) => onUpdateChargeItem(csIdx, itemIdx, 'minimum_amount_cents', cents)} />
                            <div className="flex items-end pb-1">
                              <button type="button" onClick={() => onRemoveChargeItem(csIdx, itemIdx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-3 pt-1">
                    <button type="button" onClick={() => onOpenProfilePicker(csIdx)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium flex items-center gap-0.5">
                      <Plus className="w-3 h-3" /> Select Charge Profiles
                    </button>
                    <span className="text-gray-300 dark:text-slate-600">|</span>
                    <button type="button" onClick={() => onAddChargeItem(csIdx)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium flex items-center gap-0.5">
                      <Plus className="w-3 h-3" /> Add Charge Item
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <button type="button" onClick={onAddChargeSet}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium flex items-center gap-0.5">
              <Plus className="w-3 h-3" /> Add Charge Set
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
