import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import Alert from '../../ui/Alert';
import Badge from '../../ui/Badge';
import Modal from '../../ui/Modal';

const DURATION_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'bimonthly', label: 'Bi-Monthly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];

const DAY_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

export default function SettlementPeriodsPanel() {
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', duration_type: 'biweekly', start_day_of_week: '0' });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/ap/settlement-periods');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setPeriods(data.settlement_periods || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    try {
      const url = editing ? `/api/tenant/ap/settlement-periods/${editing.id}` : '/api/tenant/ap/settlement-periods';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          duration_type: form.duration_type,
          start_day_of_week: parseInt(form.start_day_of_week, 10),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setModalOpen(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this settlement period?')) return;
    await fetch(`/api/tenant/ap/settlement-periods/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500 dark:text-slate-400">{periods.length} settlement period{periods.length !== 1 ? 's' : ''}</div>
        <Button onClick={() => { setEditing(null); setForm({ name: '', duration_type: 'biweekly', start_day_of_week: '0' }); setModalOpen(true); }}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" /> Add Settlement Period
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-gray-100 dark:divide-slate-800">
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400 dark:text-slate-500">Loading...</div>
        ) : periods.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400 dark:text-slate-500">No settlement periods. Create one to define your pay cycles.</div>
        ) : periods.map((p) => (
          <div key={p.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/60">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{p.name}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                {DURATION_OPTIONS.find((d) => d.value === p.duration_type)?.label || p.duration_type} · Starts {DAY_OPTIONS.find((d) => d.value === String(p.start_day_of_week))?.label || 'Sunday'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={p.is_active ? 'green' : 'gray'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
              <button onClick={() => { setEditing(p); setForm({ name: p.name, duration_type: p.duration_type, start_day_of_week: String(p.start_day_of_week) }); setModalOpen(true); }}
                className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(p.id)}
                className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <Modal isOpen onClose={() => setModalOpen(false)} title={editing ? 'Edit Settlement Period' : 'Create Settlement Period'} size="md">
          <form onSubmit={handleSave} className="space-y-4">
            <Input label="Settlement Period Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="e.g. Weekly, Bi-Weekly" />
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300">Duration Type</label>
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map((opt) => (
                  <label key={opt.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                    form.duration_type === opt.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:border-gray-300'
                  }`}>
                    <input type="radio" name="duration_type" value={opt.value} checked={form.duration_type === opt.value}
                      onChange={() => setForm((f) => ({ ...f, duration_type: opt.value }))} className="sr-only" />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <Select label="Start Week From" value={form.start_day_of_week}
              onChange={(e) => setForm((f) => ({ ...f, start_day_of_week: e.target.value }))}
              options={DAY_OPTIONS} />
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save' : 'Create Settlement Period'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
