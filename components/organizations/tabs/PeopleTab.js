import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Mail, Phone, Star } from 'lucide-react';
import Button from '../../ui/Button';
import Alert from '../../ui/Alert';
import Modal from '../../ui/Modal';
import Input from '../../ui/Input';
import Checkbox from '../../ui/Checkbox';
import FormSection from '../../ui/FormSection';

export default function PeopleTab({ organization }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/organizations/${organization.id}/contacts`);
      if (!res.ok) throw new Error('Failed to load contacts');
      const data = await res.json();
      setContacts(data.contacts || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [organization.id]);

  async function handleDelete(contact) {
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
    if (!confirm(`Remove ${name}?`)) return;
    try {
      await fetch(`/api/tenant/organizations/${organization.id}/contacts/${contact.id}`, { method: 'DELETE' });
      load();
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">People</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">Contacts at {organization.name}</p>
        </div>
        <Button onClick={() => { setEditing(null); setModalOpen(true); }}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" strokeWidth={2.5} />
          Add Contact
        </Button>
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {loading ? (
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-10 text-center text-sm text-gray-400 dark:text-slate-500">Loading...</div>
      ) : contacts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 py-10 text-center">
          <div className="text-sm font-medium text-gray-500 dark:text-slate-400">No contacts yet</div>
          <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">Add people at this organization to manage communications and groups.</div>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-gray-100 dark:divide-slate-800">
          {contacts.map((c) => {
            const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ');
            const groups = (c.memberships || []).map((m) => m.group?.name).filter(Boolean);
            return (
              <div key={c.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/60 group">
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center text-sm font-bold">
                    {(c.first_name?.[0] || '?').toUpperCase()}
                  </div>
                  {c.is_primary && (
                    <Star className="absolute -top-1 -right-1 w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{fullName}</span>
                    {c.is_primary && (
                      <span className="text-[9px] uppercase tracking-wide font-bold bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">Primary</span>
                    )}
                    {!c.is_active && (
                      <span className="text-[9px] uppercase tracking-wide font-bold bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded">Inactive</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                    {c.title && <span>{c.title}</span>}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
                        <Mail className="w-3 h-3" /> {c.email}
                      </a>
                    )}
                    {c.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3 text-gray-400 dark:text-slate-500" /> {c.phone}
                      </span>
                    )}
                  </div>
                  {groups.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {groups.map((g) => (
                        <span key={g} className="text-[9px] uppercase tracking-wide bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-medium">
                          {g}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditing(c); setModalOpen(true); }} className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(c)} className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ContactFormModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        orgId={organization.id}
        editing={editing}
        onSuccess={() => { setModalOpen(false); setEditing(null); load(); }}
      />
    </div>
  );
}

/**
 * ContactFormModal — add/edit a contact inline
 */
function ContactFormModal({ isOpen, onClose, orgId, editing, onSuccess }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', title: '', department: '', is_primary: false, notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      if (editing) {
        setForm({ first_name: editing.first_name || '', last_name: editing.last_name || '', email: editing.email || '', phone: editing.phone || '', title: editing.title || '', department: editing.department || '', is_primary: editing.is_primary || false, notes: editing.notes || '' });
      } else {
        setForm({ first_name: '', last_name: '', email: '', phone: '', title: '', department: '', is_primary: false, notes: '' });
      }
      setError(null);
    }
  }, [isOpen, editing]);

  async function handleSave(e) {
    e.preventDefault();
    if (!form.first_name) { setError('First name is required'); return; }
    setSaving(true);
    try {
      const url = editing
        ? `/api/tenant/organizations/${orgId}/contacts/${editing.id}`
        : `/api/tenant/organizations/${orgId}/contacts`;
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to save');
      onSuccess();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editing ? 'Edit Contact' : 'Add Contact'} size="md">
      <form onSubmit={handleSave} className="space-y-4">
        {error && <Alert type="error" message={error} />}
        <div className="grid grid-cols-2 gap-3">
          <Input label="First Name *" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
          <Input label="Last Name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Title / Role" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Operations Manager" />
          <Input label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="e.g. Billing, Dispatch" />
        </div>
        <Checkbox checked={form.is_primary} onChange={(v) => setForm({ ...form, is_primary: v })} label="Primary Contact" />
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{editing ? 'Save Changes' : 'Add Contact'}</Button>
        </div>
      </form>
    </Modal>
  );
}
