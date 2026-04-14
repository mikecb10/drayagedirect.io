import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import DatePicker from '../../ui/DatePicker';
import Alert from '../../ui/Alert';
import Badge from '../../ui/Badge';
import Modal from '../../ui/Modal';

const STATUS_BADGES = {
  active: 'green', pending: 'amber', draft: 'gray', expired: 'red',
};

const LOAD_TYPE_OPTIONS = [
  { value: 'import', label: 'Import' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'export', label: 'Export' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'road', label: 'Road' },
  { value: 'bill_only', label: 'Bill Only' },
];

export default function DriverTariffsPanel() {
  const [tariffs, setTariffs] = useState([]);
  const [driverGroups, setDriverGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '', status: 'draft', driver_group_id: '', priority: 0,
    effective_start: '', effective_end: '',
    load_types: [], container_type: '', container_size: '',
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [tRes, gRes] = await Promise.all([
        fetch(`/api/tenant/ap/tariffs${search ? `?search=${search}` : ''}`),
        fetch('/api/tenant/ap/driver-groups'),
      ]);
      if (tRes.ok) setTariffs((await tRes.json()).tariffs || []);
      if (gRes.ok) setDriverGroups((await gRes.json()).driver_groups || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [search]);

  function openCreate() {
    setEditing(null);
    setForm({
      name: '', status: 'draft', driver_group_id: '', priority: 0,
      effective_start: '', effective_end: '',
      load_types: [], container_type: '', container_size: '',
    });
    setModalOpen(true);
  }

  function openEdit(tariff) {
    setEditing(tariff);
    setForm({
      name: tariff.name || '',
      status: tariff.status || 'draft',
      driver_group_id: tariff.driver_group_id || '',
      priority: tariff.priority || 0,
      effective_start: tariff.effective_start || '',
      effective_end: tariff.effective_end || '',
      load_types: tariff.load_types || [],
      container_type: tariff.container_type || '',
      container_size: tariff.container_size || '',
    });
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        driver_group_id: form.driver_group_id || null,
        effective_start: form.effective_start || null,
        effective_end: form.effective_end || null,
        container_type: form.container_type || null,
        container_size: form.container_size || null,
      };
      const url = editing ? `/api/tenant/ap/tariffs/${editing.id}` : '/api/tenant/ap/tariffs';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save');
      setModalOpen(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this tariff?')) return;
    await fetch(`/api/tenant/ap/tariffs/${id}`, { method: 'DELETE' });
    load();
  }

  function toggleLoadType(type) {
    setForm((f) => ({
      ...f,
      load_types: f.load_types.includes(type)
        ? f.load_types.filter((t) => t !== type)
        : [...f.load_types, type],
    }));
  }

  const groupOptions = driverGroups.map((g) => ({ value: g.id, label: g.name }));

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
          <input type="text" placeholder="Search tariffs..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" /> Add Tariff
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                {['Tariff Name', 'Driver Group', 'Status', 'Priority', 'Load Types', 'Effective', 'Profiles', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : tariffs.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No driver tariffs yet. Create one to set up automated pay rates.</td></tr>
              ) : (
                tariffs.map((t) => {
                  const profileCount = (t.charge_sets || []).reduce((s, cs) => s + (cs.profiles || []).length, 0);
                  return (
                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-slate-100">{t.name}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{t.driver_group?.name || 'All'}</td>
                      <td className="px-4 py-2.5"><Badge variant={STATUS_BADGES[t.status] || 'gray'}>{t.status}</Badge></td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{t.priority}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                        {(t.load_types || []).length > 0 ? t.load_types.join(', ') : 'All'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                        {t.effective_start && t.effective_end
                          ? `${new Date(t.effective_start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })} – ${new Date(t.effective_end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}`
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{profileCount} profile{profileCount !== 1 ? 's' : ''}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(t)}
                            className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(t.id)}
                            className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <Modal isOpen onClose={() => setModalOpen(false)} title={editing ? 'Edit Driver Tariff' : 'Add Driver Tariff'} size="lg">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Tariff Name *" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              <Select label="Status" value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                options={[
                  { value: 'draft', label: 'Draft' },
                  { value: 'active', label: 'Active' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'expired', label: 'Expired' },
                ]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Driver Group" value={form.driver_group_id}
                onChange={(e) => setForm((f) => ({ ...f, driver_group_id: e.target.value }))}
                placeholder="All Driver Groups" options={groupOptions} />
              <Input label="Priority" type="number" value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: parseInt(e.target.value, 10) || 0 }))}
                helpText="Higher = wins tiebreakers" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DatePicker label="Effective Start" value={form.effective_start}
                onChange={(v) => setForm((f) => ({ ...f, effective_start: v }))} />
              <DatePicker label="Effective End" value={form.effective_end}
                onChange={(v) => setForm((f) => ({ ...f, effective_end: v }))} />
            </div>

            {/* Load type multi-select */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Load Types (empty = all)</label>
              <div className="flex flex-wrap gap-1.5">
                {LOAD_TYPE_OPTIONS.map((lt) => {
                  const checked = form.load_types.includes(lt.value);
                  return (
                    <label key={lt.value} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                      checked ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400'
                    }`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleLoadType(lt.value)} className="sr-only" />
                      {lt.label}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Container Type" value={form.container_type}
                onChange={(e) => setForm((f) => ({ ...f, container_type: e.target.value }))} placeholder="e.g. dry, reefer" />
              <Input label="Container Size" value={form.container_size}
                onChange={(e) => setForm((f) => ({ ...f, container_size: e.target.value }))} placeholder="e.g. 40, 53" />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save Changes' : 'Create Tariff'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
