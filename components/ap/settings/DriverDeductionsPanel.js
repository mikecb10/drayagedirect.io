import { useEffect, useState } from 'react';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import Alert from '../../ui/Alert';
import Badge from '../../ui/Badge';
import Modal from '../../ui/Modal';
import OrgPicker from '../../ui/OrgPicker';

function formatCents(c) {
  if (c == null) return '$0.00';
  return `$${(c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function DriverDeductionsPanel() {
  const [byDriver, setByDriver] = useState([]);
  const [deductionTypes, setDeductionTypes] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());

  // Add deduction modal
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    driver_id: '', deduction_type_id: '', description: '',
    unit_of_measure: 'fixed', math: 'subtract', amount: '',
    is_recurring: true, split_periods: '', total_amount: '',
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [dedRes, typesRes, driversRes] = await Promise.all([
        fetch('/api/tenant/ap/driver-deductions'),
        fetch('/api/tenant/ap/deduction-types'),
        fetch('/api/tenant/drivers?status=active'),
      ]);
      if (dedRes.ok) {
        const d = await dedRes.json();
        setByDriver(d.by_driver || []);
      }
      if (typesRes.ok) {
        const d = await typesRes.json();
        setDeductionTypes(d.deduction_types || []);
      }
      if (driversRes.ok) {
        const d = await driversRes.json();
        setDrivers(d.drivers || []);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function toggleExpand(driverId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(driverId)) next.delete(driverId);
      else next.add(driverId);
      return next;
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.driver_id || !form.deduction_type_id || !form.amount) return;
    setSaving(true);
    try {
      const amountCents = Math.round(parseFloat(form.amount) * 100);
      const totalCents = form.total_amount ? Math.round(parseFloat(form.total_amount) * 100) : null;
      const splitPeriods = form.split_periods ? parseInt(form.split_periods, 10) : null;

      const res = await fetch('/api/tenant/ap/driver-deductions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_id: form.driver_id,
          deduction_type_id: form.deduction_type_id,
          description: form.description || null,
          unit_of_measure: form.unit_of_measure,
          math: form.math,
          amount_cents: amountCents,
          is_recurring: form.is_recurring,
          total_amount_cents: totalCents,
          split_periods: splitPeriods,
        }),
      });
      if (!res.ok) throw new Error('Failed to create');
      setModalOpen(false);
      setForm({ driver_id: '', deduction_type_id: '', description: '', unit_of_measure: 'fixed', math: 'subtract', amount: '', is_recurring: true, split_periods: '', total_amount: '' });
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500 dark:text-slate-400">{byDriver.length} driver{byDriver.length !== 1 ? 's' : ''} with deductions</div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" /> Add Deduction
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
              <th className="w-8 px-3"></th>
              <th className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Driver</th>
              <th className="text-center px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Enabled</th>
              <th className="text-center px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Disabled</th>
              <th className="text-right px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">Total / Period</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
            ) : byDriver.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No driver deductions configured yet.</td></tr>
            ) : (
              byDriver.map((d) => {
                const isExpanded = expanded.has(d.driver_id);
                return (
                  <>
                    <tr key={d.driver_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer" onClick={() => toggleExpand(d.driver_id)}>
                      <td className="px-3">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-slate-100">{d.driver_name}</td>
                      <td className="px-4 py-2.5 text-center"><Badge variant="green">{d.enabled} Enabled</Badge></td>
                      <td className="px-4 py-2.5 text-center"><Badge variant="red">{d.disabled} Disabled</Badge></td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-slate-100">{formatCents(d.total_cents)}</td>
                    </tr>
                    {isExpanded && (d.deductions || []).map((ded) => (
                      <tr key={ded.id} className="bg-gray-50/50 dark:bg-slate-800/20">
                        <td></td>
                        <td className="px-4 py-2 pl-10 text-xs text-gray-600 dark:text-slate-400">
                          {ded.deduction_type?.name || 'Unknown'} {ded.description && `— ${ded.description}`}
                        </td>
                        <td className="px-4 py-2 text-center text-xs">
                          <Badge variant={ded.is_enabled ? 'green' : 'gray'}>{ded.is_enabled ? 'On' : 'Off'}</Badge>
                        </td>
                        <td className="px-4 py-2 text-center text-xs text-gray-500 dark:text-slate-400 capitalize">
                          {(ded.unit_of_measure || 'fixed').replace('_', ' ')}
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-slate-300">
                          {ded.math === 'subtract' ? '−' : '+'}{formatCents(ded.amount_cents)}
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal isOpen onClose={() => setModalOpen(false)} title="Add Driver Deduction" size="md">
          <form onSubmit={handleCreate} className="space-y-4">
            <Select label="Driver" value={form.driver_id}
              onChange={(e) => setForm((f) => ({ ...f, driver_id: e.target.value }))}
              placeholder="— Select Driver —" options={drivers.map((d) => ({ value: d.id, label: d.name }))}
              required />
            <Select label="Deduction Type" value={form.deduction_type_id}
              onChange={(e) => setForm((f) => ({ ...f, deduction_type_id: e.target.value }))}
              placeholder="— Select Type —" options={deductionTypes.map((t) => ({ value: t.id, label: t.name }))}
              required />
            <Input label="Description (optional)" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Unit of Measure" value={form.unit_of_measure}
                onChange={(e) => setForm((f) => ({ ...f, unit_of_measure: e.target.value }))}
                options={[
                  { value: 'fixed', label: 'Fixed Amount' },
                  { value: 'per_mile', label: 'Per Mile' },
                  { value: 'per_load', label: 'Per Load' },
                  { value: 'percentage', label: 'Percentage' },
                ]} />
              <Select label="Math" value={form.math}
                onChange={(e) => setForm((f) => ({ ...f, math: e.target.value }))}
                options={[{ value: 'subtract', label: 'Subtract (−)' }, { value: 'add', label: 'Add (+)' }]} />
            </div>
            <Input label="Amount ($)" type="number" step="0.01" min="0" value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_recurring}
                onChange={(e) => setForm((f) => ({ ...f, is_recurring: e.target.checked, split_periods: '', total_amount: '' }))}
                className="rounded text-blue-600" />
              <span className="text-sm text-gray-700 dark:text-slate-300">Recurring (auto-apply each settlement period)</span>
            </label>

            {form.is_recurring && (
              <div className="ml-6 mt-2 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Total Amount ($)" type="number" step="0.01" min="0"
                    value={form.total_amount}
                    onChange={(e) => {
                      const total = e.target.value;
                      const periods = parseInt(form.split_periods, 10) || 0;
                      const perPeriod = total && periods > 0 ? (parseFloat(total) / periods).toFixed(2) : form.amount;
                      setForm((f) => ({ ...f, total_amount: total, amount: perPeriod }));
                    }}
                    placeholder="e.g. 1200.00"
                    helpText="Full deduction amount to collect" />
                  <Input label="Split Over (# periods)" type="number" min="1" step="1"
                    value={form.split_periods}
                    onChange={(e) => {
                      const periods = e.target.value;
                      const total = parseFloat(form.total_amount) || 0;
                      const perPeriod = total && parseInt(periods, 10) > 0 ? (total / parseInt(periods, 10)).toFixed(2) : form.amount;
                      setForm((f) => ({ ...f, split_periods: periods, amount: perPeriod }));
                    }}
                    placeholder="e.g. 6"
                    helpText="Number of settlement periods" />
                </div>
                {form.total_amount && form.split_periods && parseInt(form.split_periods, 10) > 0 && (
                  <div className="text-sm text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 rounded-lg px-3 py-2">
                    ${parseFloat(form.total_amount).toFixed(2)} split into {form.split_periods} periods = <span className="text-lg">${(parseFloat(form.total_amount) / parseInt(form.split_periods, 10)).toFixed(2)}</span> per settlement period
                  </div>
                )}
                {!form.total_amount && !form.split_periods && (
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    Or leave empty to use the flat amount above every period until manually disabled.
                  </p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Add Deduction</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
