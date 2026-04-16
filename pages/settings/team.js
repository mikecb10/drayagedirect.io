import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Users, UserPlus, Copy, CheckCheck, Edit2, ToggleLeft, ToggleRight, Search } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import Input from '../../components/ui/Input';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import FieldGroup from '../../components/ui/FieldGroup';
import Field from '../../components/ui/Field';
import { SYSTEM_ROLES, PERMISSION_CATEGORIES, ALL_PERMISSION_KEYS, getDefaultPermissions } from '../../lib/rbac';

const ROLE_BADGE_COLORS = {
  super_admin: 'bg-blue-100 text-blue-700',
  admin: 'bg-blue-100 text-blue-700',
  dispatcher: 'bg-green-100 text-green-700',
  billing: 'bg-amber-100 text-amber-700',
  operations: 'bg-purple-100 text-purple-700',
  sales_agent: 'bg-orange-100 text-orange-700',
  custom: 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300',
};

function TeamSettings() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null); // null = add new
  const [tempPasswordInfo, setTempPasswordInfo] = useState(null);
  const [copied, setCopied] = useState(false);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/users');
      if (!res.ok) throw new Error('Failed to load users');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadUsers(); }, []);

  useEffect(() => {
    if (router.query.invite === '1') setModalOpen(true);
  }, [router.query.invite]);

  const filtered = users.filter((u) => {
    if (roleFilter !== 'all' && u.system_role !== roleFilter && u.role !== roleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = (u.name || `${u.first_name || ''} ${u.last_name || ''}`).toLowerCase();
      return name.includes(q) || u.email.toLowerCase().includes(q);
    }
    return true;
  });

  function handleCopy(text) {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openEdit(user) {
    setEditingUser(user);
    setModalOpen(true);
  }

  function openAdd() {
    setEditingUser(null);
    setModalOpen(true);
  }

  function getUserName(u) {
    if (u.first_name || u.last_name) return `${u.first_name || ''} ${u.last_name || ''}`.trim();
    return u.name || u.email;
  }

  function getSystemRole(u) {
    return u.system_role || u.role || 'custom';
  }

  function getRoleLabel(role) {
    const found = SYSTEM_ROLES.find((r) => r.value === role);
    return found ? found.label : role;
  }

  function getInitials(u) {
    const name = getUserName(u);
    const parts = name.split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  return (
    <>
      <div className="max-w-6xl space-y-[var(--space-section)]">
        <PageHeader
          variant="plain"
          title={<><Users className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Users & Permissions</>}
          description="Manage users and their granted permissions."
          actions={<Button onClick={openAdd}><UserPlus className="w-4 h-4 mr-1 inline -mt-0.5" />Add New User</Button>}
          className="mb-[var(--space-section)]"
        />

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {/* Search + filter */}
        <SectionCard title="Filter" columns={0}>
          <FieldGroup columns={2}>
            <Field label="Search">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500 pointer-events-none" />
                <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-body text-strong pl-9 pr-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
              </div>
            </Field>
            <Field label="Role">
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-body text-strong px-3 py-2">
                <option value="all">All</option>
                {SYSTEM_ROLES.filter((r) => r.value !== 'custom').map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>
          </FieldGroup>
        </SectionCard>

        {/* Users table */}
        <SectionCard title="Users" columns={0}>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/50">
                  <th className="text-left px-4 py-2.5 text-field-label text-muted">Name</th>
                  <th className="text-left px-4 py-2.5 text-field-label text-muted">System Roles</th>
                  <th className="text-left px-4 py-2.5 text-field-label text-muted">Custom Roles</th>
                  <th className="text-left px-4 py-2.5 text-field-label text-muted">Email</th>
                  <th className="text-left px-4 py-2.5 text-field-label text-muted">Phone</th>
                  <th className="w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-helper text-muted">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-helper text-muted">No users found</td></tr>
                ) : filtered.map((u) => {
                  const role = getSystemRole(u);
                  const hasCustom = (u.granular_permissions || []).length > 0 && role === 'custom';
                  return (
                    <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 flex items-center justify-center text-xs font-bold shrink-0">
                            {getInitials(u)}
                          </div>
                          <span className="font-medium text-strong">{getUserName(u)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${ROLE_BADGE_COLORS[role] || 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300'}`}>
                          {getRoleLabel(role)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {hasCustom ? (
                          <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-950/60"
                            onClick={() => openEdit(u)}>
                            Custom Permission
                          </span>
                        ) : (
                          <span className="text-helper text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-helper text-muted">{u.email}</td>
                      <td className="px-4 py-3 text-helper text-muted">{u.phone || '—'}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(u)} className="text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 p-1" title="Edit user">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button className="text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 p-1" title="Toggle active">
                            {u.status === 'active' ? <ToggleRight className="w-4 h-4 text-blue-600" /> : <ToggleLeft className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* Add/Edit User Modal */}
      <UserModal
        isOpen={modalOpen}
        user={editingUser}
        onClose={() => {
          setModalOpen(false);
          setEditingUser(null);
          if (router.query.invite) router.replace('/settings/team', undefined, { shallow: true });
        }}
        onSuccess={(result) => {
          setModalOpen(false);
          setEditingUser(null);
          if (result?.tempPassword) {
            setTempPasswordInfo({ tempPassword: result.tempPassword, user: result.user });
          }
          loadUsers();
        }}
      />

      {/* Temp password reveal modal */}
      <Modal isOpen={!!tempPasswordInfo} onClose={() => setTempPasswordInfo(null)} title="User Created" size="md">
        <div className="space-y-4">
          <Alert type="success" message={`${tempPasswordInfo?.user?.name || 'User'} has been added to your team.`} />
          <div>
            <p className="text-body text-muted mb-2">
              Share this temporary password with <strong>{tempPasswordInfo?.user?.email}</strong>. They'll be prompted to change it on first login.
            </p>
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-800 rounded-lg p-3">
              <code className="flex-1 text-body font-mono text-strong">{tempPasswordInfo?.tempPassword}</code>
              <button onClick={() => handleCopy(tempPasswordInfo?.tempPassword)}
                className="flex items-center gap-1 text-helper font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
                {copied ? <><CheckCheck className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
              </button>
            </div>
            <p className="text-helper text-muted mt-2">This password will not be shown again.</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setTempPasswordInfo(null)}>Done</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

TeamSettings.getLayout = (page) => (
  <SettingsLayout title="Team & Permissions">{page}</SettingsLayout>
);

export default TeamSettings;

// ═══════════════════════════════════════════════════════════════
// User Modal — PP-style two-tab: User Info | Permissions
// ═══════════════════════════════════════════════════════════════
function UserModal({ isOpen, user, onClose, onSuccess }) {
  const isEdit = !!user;
  const [tab, setTab] = useState('info');
  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '', email: '',
    system_role: 'custom', password: '', confirm_password: '',
  });
  const [granularPerms, setGranularPerms] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setTab('info');
    setError(null);
    if (user) {
      setForm({
        first_name: user.first_name || user.name?.split(' ')[0] || '',
        last_name: user.last_name || user.name?.split(' ').slice(1).join(' ') || '',
        phone: user.phone || '',
        email: user.email || '',
        system_role: user.system_role || user.role || 'custom',
        password: '', confirm_password: '',
      });
      setGranularPerms(user.granular_permissions || []);
    } else {
      setForm({ first_name: '', last_name: '', phone: '', email: '', system_role: 'custom', password: '', confirm_password: '' });
      setGranularPerms([]);
    }
  }, [isOpen, user]);

  // When system role changes, pre-fill permissions
  function handleRoleChange(role) {
    setForm((f) => ({ ...f, system_role: role }));
    if (role !== 'custom') {
      setGranularPerms(getDefaultPermissions(role));
    }
  }

  function togglePerm(key) {
    setGranularPerms((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
    // Switch to custom if user manually changes permissions
    if (form.system_role !== 'custom' && form.system_role !== 'super_admin' && form.system_role !== 'admin') {
      setForm((f) => ({ ...f, system_role: 'custom' }));
    }
  }

  function toggleCategory(catKey) {
    const cat = PERMISSION_CATEGORIES.find((c) => c.key === catKey);
    if (!cat) return;
    const catKeys = cat.permissions.map((p) => p.key);
    const allChecked = catKeys.every((k) => granularPerms.includes(k));
    if (allChecked) {
      setGranularPerms((prev) => prev.filter((k) => !catKeys.includes(k)));
    } else {
      setGranularPerms((prev) => [...new Set([...prev, ...catKeys])]);
    }
    if (form.system_role !== 'custom' && form.system_role !== 'super_admin' && form.system_role !== 'admin') {
      setForm((f) => ({ ...f, system_role: 'custom' }));
    }
  }

  function toggleAll() {
    if (granularPerms.length === ALL_PERMISSION_KEYS.length) {
      setGranularPerms([]);
    } else {
      setGranularPerms([...ALL_PERMISSION_KEYS]);
    }
  }

  async function handleSubmit() {
    if (!form.first_name || !form.email) { setError('First name and email are required'); return; }
    if (!isEdit && !form.password) { setError('Password is required for new users'); return; }
    if (!isEdit && form.password !== form.confirm_password) { setError('Passwords do not match'); return; }

    setSubmitting(true); setError(null);
    try {
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
        name: `${form.first_name} ${form.last_name}`.trim(),
        email: form.email,
        phone: form.phone || null,
        system_role: form.system_role,
        granular_permissions: granularPerms,
        ...(form.password ? { password: form.password } : {}),
      };

      const url = isEdit ? `/api/tenant/users/${user.id}` : '/api/tenant/users';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || 'Failed to save'); }
      const data = await res.json();
      onSuccess(isEdit ? {} : { tempPassword: data.tempPassword, user: data.user });
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? `${form.first_name} ${form.last_name}`.trim() || 'Edit User' : 'Add User'} size="lg"
      subtitle={isEdit ? user?.email : undefined}>
      <div>
        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-slate-800 mb-5">
          <button onClick={() => setTab('info')}
            className={`px-4 py-2.5 text-body font-medium border-b-2 transition-colors ${
              tab === 'info' ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-muted hover:text-strong'
            }`}>
            User Info
          </button>
          <button onClick={() => setTab('permissions')}
            className={`px-4 py-2.5 text-body font-medium border-b-2 transition-colors ${
              tab === 'permissions' ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-muted hover:text-strong'
            }`}>
            Permissions
          </button>
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {/* ── User Info Tab ─────────────────────────────── */}
        {tab === 'info' && (
          <div className="space-y-[var(--space-field)]">
            <h3 className="text-field-label text-muted">General Information</h3>
            <div className="space-y-[var(--space-field)]">
              <Field label="First name" required>
                <Input
                  value={form.first_name}
                  onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                  placeholder="Enter First Name"
                />
              </Field>
              <Field label="Last name" required>
                <Input
                  value={form.last_name}
                  onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                  placeholder="Enter Last Name"
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="Enter Phone number"
                />
              </Field>
              <Field label="Email" required>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="Enter email address"
                  disabled={isEdit}
                />
              </Field>

              {/* Roles */}
              <Field label="Roles">
                <div className="flex flex-wrap gap-3">
                  {SYSTEM_ROLES.filter((r) => r.value !== 'custom' && r.value !== 'super_admin').map((r) => (
                    <label key={r.value} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.system_role === r.value}
                        onChange={() => handleRoleChange(form.system_role === r.value ? 'custom' : r.value)}
                        className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-4 h-4" />
                      <span className="text-body text-strong">{r.label}</span>
                    </label>
                  ))}
                </div>
              </Field>

              {/* Password (only for new users) */}
              {!isEdit && (
                <>
                  <Field label="Password" required>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      placeholder="Enter Password"
                    />
                  </Field>
                  <Field label="Confirm Password" required>
                    <Input
                      type="password"
                      value={form.confirm_password}
                      onChange={(e) => setForm((f) => ({ ...f, confirm_password: e.target.value }))}
                      placeholder="Repeat Password"
                    />
                  </Field>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Permissions Tab ───────────────────────────── */}
        {tab === 'permissions' && (
          <div className="space-y-[var(--space-field)] max-h-[60vh] overflow-y-auto pr-1">
            {/* Role dropdown */}
            <Field label="Permissions Based On Role">
              <select value={form.system_role} onChange={(e) => handleRoleChange(e.target.value)}
                className="rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-body text-strong px-3 py-2 w-full max-w-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                {SYSTEM_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>

            {/* All Permissions toggle */}
            <label className="flex items-center gap-2 cursor-pointer py-1">
              <input type="checkbox" checked={granularPerms.length === ALL_PERMISSION_KEYS.length}
                onChange={toggleAll} className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-4 h-4" />
              <span className="text-body font-semibold text-strong">All Permissions</span>
            </label>

            {/* Permission categories */}
            {PERMISSION_CATEGORIES.map((cat) => {
              const catKeys = cat.permissions.map((p) => p.key);
              const checkedCount = catKeys.filter((k) => granularPerms.includes(k)).length;
              const allChecked = checkedCount === catKeys.length;
              const someChecked = checkedCount > 0 && !allChecked;

              return (
                <div key={cat.key} className="border-t border-gray-100 dark:border-slate-800 pt-3">
                  {/* Category header */}
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input type="checkbox" checked={allChecked} ref={(el) => { if (el) el.indeterminate = someChecked; }}
                      onChange={() => toggleCategory(cat.key)}
                      className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-4 h-4" />
                    <span className="text-body font-semibold text-strong">{cat.label}</span>
                    {checkedCount > 0 && (
                      <span className="text-helper text-muted">({checkedCount}/{catKeys.length})</span>
                    )}
                  </label>

                  {/* Permission items — multi-column grid */}
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 pl-6">
                    {cat.permissions.map((p) => (
                      <label key={p.key} className="flex items-center gap-2 cursor-pointer py-0.5">
                        <input type="checkbox" checked={granularPerms.includes(p.key)}
                          onChange={() => togglePerm(p.key)}
                          className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5" />
                        <span className="text-helper text-strong">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom actions */}
        <div className="flex justify-end gap-[var(--space-inline)] pt-5 mt-5 border-t border-gray-200 dark:border-slate-800">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {tab === 'info' && !isEdit ? (
            <Button onClick={() => setTab('permissions')}>Next</Button>
          ) : (
            <Button onClick={handleSubmit} loading={submitting}>
              {isEdit ? 'Save' : 'Create User'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
