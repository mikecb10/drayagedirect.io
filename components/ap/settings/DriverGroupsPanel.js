import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Users as UsersIcon } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Select from '../../ui/Select';
import Alert from '../../ui/Alert';
import Badge from '../../ui/Badge';
import Modal from '../../ui/Modal';

export default function DriverGroupsPanel() {
  const [groups, setGroups] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [modalTab, setModalTab] = useState('general');
  const [form, setForm] = useState({ name: '', settlement_period_id: '', member_ids: [] });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [gRes, pRes, dRes] = await Promise.all([
        fetch('/api/tenant/ap/driver-groups'),
        fetch('/api/tenant/ap/settlement-periods'),
        fetch('/api/tenant/drivers?status=active'),
      ]);
      if (gRes.ok) setGroups((await gRes.json()).driver_groups || []);
      if (pRes.ok) setPeriods((await pRes.json()).settlement_periods || []);
      if (dRes.ok) setDrivers((await dRes.json()).drivers || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', settlement_period_id: '', member_ids: [] });
    setModalTab('general');
    setModalOpen(true);
  }

  function openEdit(group) {
    setEditing(group);
    setForm({
      name: group.name,
      settlement_period_id: group.settlement_period_id || '',
      member_ids: (group.drivers || []).map((d) => d.id),
    });
    setModalTab('general');
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    try {
      const url = editing ? `/api/tenant/ap/driver-groups/${editing.id}` : '/api/tenant/ap/driver-groups';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          settlement_period_id: form.settlement_period_id || null,
          member_ids: form.member_ids,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setModalOpen(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this driver group?')) return;
    await fetch(`/api/tenant/ap/driver-groups/${id}`, { method: 'DELETE' });
    load();
  }

  function toggleMember(driverId) {
    setForm((f) => ({
      ...f,
      member_ids: f.member_ids.includes(driverId)
        ? f.member_ids.filter((id) => id !== driverId)
        : [...f.member_ids, driverId],
    }));
  }

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500 dark:text-slate-400">{groups.length} driver group{groups.length !== 1 ? 's' : ''}</div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" /> Add Group
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-gray-100 dark:divide-slate-800">
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400 dark:text-slate-500">Loading...</div>
        ) : groups.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400 dark:text-slate-500">No driver groups yet. Create one to organize drivers by settlement period.</div>
        ) : groups.map((g) => (
          <div key={g.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/60">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{g.name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1">
                  <UsersIcon className="w-3 h-3" /> {g.member_count || 0} driver{(g.member_count || 0) !== 1 ? 's' : ''}
                </span>
                {g.settlement_period && (
                  <Badge variant="blue">{g.settlement_period.name}</Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => openEdit(g)}
                className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(g.id)}
                className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create/Edit Modal with 2 tabs */}
      {modalOpen && (
        <Modal isOpen onClose={() => setModalOpen(false)} title={editing ? 'Edit Driver Group' : 'New Driver Group'} size="lg">
          <form onSubmit={handleSave} className="space-y-4">
            {/* Tab pills */}
            <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
              {[
                { id: 'general', label: 'General Info' },
                { id: 'period', label: 'Settlement Period' },
              ].map((tab) => (
                <button key={tab.id} type="button" onClick={() => setModalTab(tab.id)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    modalTab === tab.id
                      ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm'
                      : 'text-gray-500 dark:text-slate-400'
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>

            {modalTab === 'general' && (
              <div className="space-y-4">
                <Input label="Group Name" value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required placeholder='e.g. "Owner Operators", "Company Drivers"' />
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">Drivers in Group</label>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800">
                    {drivers.map((d) => {
                      const checked = form.member_ids.includes(d.id);
                      // Check if driver is already in another group
                      const otherGroup = groups.find((g) =>
                        g.id !== editing?.id && (g.drivers || []).some((gd) => gd.id === d.id)
                      );
                      return (
                        <label key={d.id} className={`flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800/60 ${otherGroup && !checked ? 'opacity-50' : ''} cursor-pointer`}>
                          <input type="checkbox" checked={checked}
                            onChange={() => {
                              if (otherGroup && !checked) {
                                if (!confirm(`${d.name} is already in "${otherGroup.name}". Moving them to this group will remove them from that one. Continue?`)) return;
                              }
                              toggleMember(d.id);
                            }}
                            className="rounded text-blue-600" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-900 dark:text-slate-100">{d.name}</span>
                            {otherGroup && !checked && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-2">in {otherGroup.name}</span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">{form.member_ids.length} selected</div>
                </div>
              </div>
            )}

            {modalTab === 'period' && (
              <div className="space-y-4">
                <Select label="Settlement Period" value={form.settlement_period_id}
                  onChange={(e) => setForm((f) => ({ ...f, settlement_period_id: e.target.value }))}
                  placeholder="— No Period Assigned —" options={periods.map((p) => ({ value: p.id, label: `${p.name} (${p.duration_type})` }))}
                />
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  This determines the pay cycle for all drivers in this group. When generating settlements, drivers in this group will be grouped by this period.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save Changes' : 'Create Group'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
