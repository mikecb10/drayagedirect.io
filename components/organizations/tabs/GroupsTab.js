import { useEffect, useState } from 'react';
import { Plus, Trash2, UserPlus, Users, Mail, X } from 'lucide-react';
import Button from '../../ui/Button';
import Alert from '../../ui/Alert';
import Modal from '../../ui/Modal';
import Input from '../../ui/Input';

const PURPOSE_BADGE_COLORS = {
  billing:           'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  operations:        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  dispatch:          'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  rate_confirmation: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  management:        'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  custom:            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
};

const PURPOSE_LABELS = {
  billing:           'Billing',
  operations:        'Operations',
  dispatch:          'Dispatch',
  rate_confirmation: 'Rate Con',
  management:        'Management',
  custom:            'Custom',
};

export default function GroupsTab({ organization }) {
  const [groups, setGroups] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageGroupId, setManageGroupId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [gRes, cRes] = await Promise.all([
        fetch(`/api/tenant/organizations/${organization.id}/groups`),
        fetch(`/api/tenant/organizations/${organization.id}/contacts`),
      ]);
      if (gRes.ok) { const d = await gRes.json(); setGroups(d.groups || []); }
      if (cRes.ok) { const d = await cRes.json(); setContacts(d.contacts || []); }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [organization.id]);

  async function handleDeleteGroup(groupId) {
    if (!confirm('Delete this group?')) return;
    try {
      await fetch(`/api/tenant/organizations/${organization.id}/groups/${groupId}`, { method: 'DELETE' });
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleAddMember(groupId, contactId) {
    try {
      await fetch(`/api/tenant/organizations/${organization.id}/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId }),
      });
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleRemoveMember(groupId, memberId) {
    try {
      await fetch(`/api/tenant/organizations/${organization.id}/groups/${groupId}/members/${memberId}`, { method: 'DELETE' });
      load();
    } catch (e) { setError(e.message); }
  }

  // Get all emails for a group (for copy-to-clipboard)
  function getGroupEmails(group) {
    return (group.members || [])
      .map((m) => m.contact?.email)
      .filter(Boolean)
      .join(', ');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Groups</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Custom distribution lists for bulk emails. Create groups like "Billing Green Team" with specific contacts.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" />
          Create Group
        </Button>
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400 dark:text-slate-500">Loading...</div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 py-10 text-center">
          <Users className="w-8 h-8 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
          <div className="text-sm font-medium text-gray-500 dark:text-slate-400">No groups yet</div>
          <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">Create custom groups to organize contacts for email distribution.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const memberEmails = getGroupEmails(group);
            return (
              <div key={group.id} className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                {/* Group header */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{group.name}</span>
                      {group.purpose && (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${PURPOSE_BADGE_COLORS[group.purpose] || PURPOSE_BADGE_COLORS.custom}`}>
                          {PURPOSE_LABELS[group.purpose] || group.purpose}
                        </span>
                      )}
                      {group.is_default_for_purpose && (
                        <span
                          className="text-yellow-500 dark:text-yellow-400"
                          title="Default group for this purpose"
                          aria-label="Default group"
                        >
                          ⭐
                        </span>
                      )}
                    </div>
                    {group.description && (
                      <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{group.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 dark:text-slate-500">{group.member_count} member{group.member_count !== 1 ? 's' : ''}</span>
                    {memberEmails && (
                      <button
                        onClick={() => { navigator.clipboard?.writeText(memberEmails); }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex items-center gap-1"
                        title={`Copy all emails: ${memberEmails}`}
                      >
                        <Mail className="w-3 h-3" /> Copy Emails
                      </button>
                    )}
                    <button
                      onClick={() => setManageGroupId(manageGroupId === group.id ? null : group.id)}
                      className="text-xs text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 font-medium flex items-center gap-1"
                    >
                      <UserPlus className="w-3 h-3" /> Manage
                    </button>
                    <button onClick={() => handleDeleteGroup(group.id)} className="text-gray-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Members */}
                <div className="px-4 py-2">
                  {(group.members || []).length === 0 ? (
                    <div className="text-xs text-gray-400 dark:text-slate-500 py-2">No members — click Manage to add contacts</div>
                  ) : (
                    <div className="flex flex-wrap gap-2 py-1">
                      {(group.members || []).map((m) => {
                        const c = m.contact;
                        if (!c) return null;
                        const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
                        return (
                          <div key={m.id} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs">
                            <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center text-[9px] font-bold">
                              {(c.first_name?.[0] || '?').toUpperCase()}
                            </div>
                            <span className="font-medium text-gray-700 dark:text-slate-200">{name}</span>
                            {c.email && <span className="text-gray-400 dark:text-slate-500">{c.email}</span>}
                            {manageGroupId === group.id && (
                              <button onClick={() => handleRemoveMember(group.id, m.id)} className="text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 ml-1">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Add member panel */}
                {manageGroupId === group.id && (
                  <div className="border-t border-gray-100 dark:border-slate-800 px-4 py-2 bg-blue-50/30 dark:bg-blue-950/20">
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1">Add contacts to this group</div>
                    <div className="flex flex-wrap gap-1">
                      {contacts
                        .filter((c) => !(group.members || []).some((m) => m.contact?.id === c.id))
                        .map((c) => {
                          const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
                          return (
                            <button
                              key={c.id}
                              onClick={() => handleAddMember(group.id, c.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-blue-200 dark:border-blue-900/60 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                            >
                              <Plus className="w-3 h-3" /> {name}
                            </button>
                          );
                        })}
                      {contacts.filter((c) => !(group.members || []).some((m) => m.contact?.id === c.id)).length === 0 && (
                        <div className="text-xs text-gray-400 dark:text-slate-500 py-1">All contacts are already in this group</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CreateGroupModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        orgId={organization.id}
        contacts={contacts}
        onSuccess={() => { setCreateOpen(false); load(); }}
      />
    </div>
  );
}

function CreateGroupModal({ isOpen, onClose, orgId, contacts, onSuccess }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) { setName(''); setDescription(''); setSelectedIds(new Set()); setError(null); }
  }, [isOpen]);

  function toggleMember(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Group name is required'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/tenant/organizations/${orgId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, member_ids: [...selectedIds] }),
      });
      if (!res.ok) throw new Error('Failed to create group');
      onSuccess();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Group" size="md">
      <form onSubmit={handleCreate} className="space-y-4">
        {error && <Alert type="error" message={error} />}
        <Input label="Group Name *" value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Billing Green Team"' required />
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this group for?" />

        {contacts.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Add Members</label>
            <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 p-2">
              {contacts.map((c) => {
                const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
                const checked = selectedIds.has(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => toggleMember(c.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
                      checked ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-slate-300'
                    }`}>
                    <input type="checkbox" checked={checked} onChange={() => {}} className="rounded text-blue-600 pointer-events-none" />
                    <span className="font-medium">{name}</span>
                    {c.email && <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">{c.email}</span>}
                  </button>
                );
              })}
            </div>
            <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">{selectedIds.size} selected</div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Create Group</Button>
        </div>
      </form>
    </Modal>
  );
}
