import { useEffect, useState } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Checkbox from '../ui/Checkbox';
import FormSection from '../ui/FormSection';
import Alert from '../ui/Alert';
import CurrencyInput from '../ui/CurrencyInput';
import OrgPicker from '../ui/OrgPicker';
import ContainerOwnerPicker from '../ui/ContainerOwnerPicker';
import ReferenceDataPicker from '../ui/ReferenceDataPicker';
import { LOAD_TYPES } from '../../lib/constants/load-types.js';

// Per-diem applies to types that have container detention. Exclude
// types whose `allowsNullContainer` is true (bill_only, chassis_reposition).
// Mirrors the filter on the parent /settings/per-diem page.
const LOAD_TYPE_OPTIONS = LOAD_TYPES.filter((t) => !t.allowsNullContainer).map(
  (t) => ({ value: t.value, label: t.label })
);

function makeEmptyTier(startDay = 1) {
  return { from_day: startDay, to_day: '', amount_cents: null };
}

function emptyForm() {
  return {
    name: '',
    customer_id: null,
    customer_label: '',
    container_owner_id: null,
    container_owner_label: '',
    container_type_id: null,
    container_type_label: '',
    load_type: '',
    include_holidays: true,
    include_weekends: true,
    is_enabled: true,
    notes: '',
    tiers: [makeEmptyTier(1)],
  };
}

export default function PerDiemRuleModal({ isOpen, onClose, editing, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setForm({
        name: editing.name || '',
        customer_id: editing.customer_id || null,
        customer_label: editing.customer?.name || '',
        container_owner_id: editing.container_owner_id || null,
        container_owner_label: editing.owner?.label || editing.owner?.name || '',
        container_type_id: editing.container_type_id || null,
        container_type_label: editing.container_type?.label || '',
        load_type: editing.load_type || '',
        include_holidays: editing.include_holidays ?? true,
        include_weekends: editing.include_weekends ?? true,
        is_enabled: editing.is_enabled ?? true,
        notes: editing.notes || '',
        tiers:
          editing.tiers && editing.tiers.length > 0
            ? editing.tiers.map((t) => ({
                from_day: t.from_day,
                to_day: t.to_day ?? '',
                amount_cents: t.amount_cents,
              }))
            : [makeEmptyTier(1)],
      });
    } else {
      setForm(emptyForm());
    }
    setError(null);
  }, [isOpen, editing]);

  function updateTier(idx, patch) {
    setForm((f) => ({
      ...f,
      tiers: f.tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    }));
  }

  function addTier() {
    setForm((f) => {
      const last = f.tiers[f.tiers.length - 1];
      const nextFrom =
        last && last.to_day ? parseInt(last.to_day, 10) + 1 : (last?.from_day || 0) + 1;
      return { ...f, tiers: [...f.tiers, makeEmptyTier(nextFrom)] };
    });
  }

  function removeTier(idx) {
    setForm((f) => ({ ...f, tiers: f.tiers.filter((_, i) => i !== idx) }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      // Validation
      if (form.tiers.length === 0) throw new Error('At least one tier is required');
      for (const [i, t] of form.tiers.entries()) {
        if (!t.from_day || t.from_day < 1) {
          throw new Error(`Tier ${i + 1}: "From Day" must be 1 or greater`);
        }
        if (t.amount_cents == null || t.amount_cents < 0) {
          throw new Error(`Tier ${i + 1}: amount is required`);
        }
        if (t.to_day && parseInt(t.to_day, 10) < parseInt(t.from_day, 10)) {
          throw new Error(`Tier ${i + 1}: "To Day" must be ≥ "From Day"`);
        }
      }

      const payload = {
        name: form.name || null,
        customer_id: form.customer_id,
        container_owner_id: form.container_owner_id,
        container_type_id: form.container_type_id,
        load_type: form.load_type || null,
        include_holidays: form.include_holidays,
        include_weekends: form.include_weekends,
        is_enabled: form.is_enabled,
        notes: form.notes || null,
        tiers: form.tiers.map((t) => ({
          from_day: parseInt(t.from_day, 10),
          to_day: t.to_day ? parseInt(t.to_day, 10) : null,
          amount_cents: t.amount_cents || 0,
        })),
      };

      const url = editing
        ? `/api/tenant/per-diem-rules/${editing.id}`
        : '/api/tenant/per-diem-rules';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save rule');
      }

      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? 'Edit Per Diem Rule' : 'Add Per Diem Rule'}
      size="lg"
    >
      <form onSubmit={handleSave} className="space-y-5">
        {error && <Alert type="error" message={error} />}

        {/* Info banner */}
        <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-3">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
          <div className="text-xs text-blue-900 dark:text-blue-200">
            Leave any match criteria blank to mean <strong>"any"</strong>. Rules apply to
            loads that match ALL set criteria. When multiple rules match, the most
            specific one wins.
          </div>
        </div>

        <FormSection title="Rule Name & Description">
          <Input
            label="Rule Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Walmart — Maersk reefer import"
            className="sm:col-span-2"
          />
          <Input
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Optional context for this rule"
            className="sm:col-span-2"
          />
        </FormSection>

        <FormSection title="Match Criteria">
          <OrgPicker
            label="Customer (optional)"
            type="customer"
            value={form.customer_id}
            valueLabel={form.customer_label}
            onChange={(org) =>
              setForm({
                ...form,
                customer_id: org?.id || null,
                customer_label: org?.name || '',
              })
            }
          />
          <ContainerOwnerPicker
            label="Steamship Line (optional)"
            value={form.container_owner_id}
            valueLabel={form.container_owner_label}
            onChange={(owner) =>
              setForm({
                ...form,
                container_owner_id: owner?.id || null,
                container_owner_label: owner?.label || owner?.name || '',
              })
            }
          />
          <ReferenceDataPicker
            label="Container Type (optional)"
            endpoint="/api/tenant/container-types"
            value={form.container_type_id}
            valueLabel={form.container_type_label}
            onChange={(item) =>
              setForm({
                ...form,
                container_type_id: item?.id || null,
                container_type_label: item?.label || '',
              })
            }
          />
          <Select
            label="Load Type (optional)"
            placeholder="Any"
            value={form.load_type}
            onChange={(e) => setForm({ ...form, load_type: e.target.value })}
            options={LOAD_TYPE_OPTIONS}
          />
        </FormSection>

        <FormSection title="Calendar Treatment">
          <Checkbox
            checked={form.include_holidays}
            onChange={(v) => setForm({ ...form, include_holidays: v })}
            label="Count holidays"
            description="Holidays count toward the day number"
          />
          <Checkbox
            checked={form.include_weekends}
            onChange={(v) => setForm({ ...form, include_weekends: v })}
            label="Count weekends"
            description="Saturday and Sunday count toward the day number"
          />
        </FormSection>

        {/* Tier editor */}
        <section>
          <div className="mb-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Pricing Tiers</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Define per-day charges by tier. Leave "To Day" blank on the last tier for
              "and beyond".
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 px-3 py-2 bg-gray-50 dark:bg-slate-900 text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">
              <div>From Day</div>
              <div>To Day</div>
              <div>Amount / Day</div>
              <div className="w-6"></div>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-slate-800">
              {form.tiers.map((tier, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 px-3 py-2 items-center"
                >
                  <input
                    type="number"
                    min="1"
                    value={tier.from_day}
                    onChange={(e) => updateTier(idx, { from_day: e.target.value })}
                    className="rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                  />
                  <input
                    type="number"
                    min="1"
                    value={tier.to_day}
                    onChange={(e) => updateTier(idx, { to_day: e.target.value })}
                    placeholder="∞"
                    className="rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
                  />
                  <CurrencyInput
                    valueCents={tier.amount_cents}
                    onChangeCents={(v) => updateTier(idx, { amount_cents: v })}
                  />
                  <button
                    type="button"
                    onClick={() => removeTier(idx)}
                    disabled={form.tiers.length === 1}
                    className="text-gray-300 dark:text-slate-600 hover:text-red-500 disabled:opacity-30 disabled:hover:text-gray-300 dark:disabled:hover:text-slate-600"
                    title="Remove tier"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-3 py-2 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900">
              <button
                type="button"
                onClick={addTier}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
              >
                <Plus className="w-3 h-3 inline -mt-0.5 mr-1" />
                Add Tier
              </button>
            </div>
          </div>
        </section>

        <Checkbox
          checked={form.is_enabled}
          onChange={(v) => setForm({ ...form, is_enabled: v })}
          label="Enabled"
          description="Only enabled rules are applied to loads"
        />

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {editing ? 'Save Changes' : 'Add Rule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
