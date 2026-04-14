import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Alert from '../../ui/Alert';
import Badge from '../../ui/Badge';
import Modal from '../../ui/Modal';

export default function DeductionTypesPanel() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/ap/deduction-types');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setTypes(data.deduction_types || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    try {
      const url = editing ? `/api/tenant/ap/deduction-types/${editing.id}` : '/api/tenant/ap/deduction-types';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to save');
      setModalOpen(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this deduction type?')) return;
    await fetch(`/api/tenant/ap/deduction-types/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500 dark:text-slate-400">{types.length} deduction type{types.length !== 1 ? 's' : ''}</div>
        <Button onClick={() => { setEditing(null); setForm({ name: '', description: '' }); setModalOpen(true); }}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" /> Add Type
        </Button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-gray-100 dark:divide-slate-800">
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400 dark:text-slate-500">Loading...</div>
        ) : types.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400 dark:text-slate-500">No deduction types yet. Create one to get started.</div>
        ) : types.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/60">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{t.name}</div>
              {t.description && <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{t.description}</div>}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={t.is_active ? 'green' : 'gray'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>
              <button onClick={() => { setEditing(t); setForm({ name: t.name, description: t.description || '' }); setModalOpen(true); }}
                className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(t.id)}
                className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <Modal isOpen onClose={() => setModalOpen(false)} title={editing ? 'Edit Deduction Type' : 'New Deduction Type'} size="sm">
          <form onSubmit={handleSave} className="space-y-4">
            <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="e.g. Insurance, Fuel Card, EZ-Pass" />
            <Input label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save' : 'Create'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
