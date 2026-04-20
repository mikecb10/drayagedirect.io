import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  RotateCcw,
  Trash2,
  Zap,
  Star,
  Plus,
  X,
  Globe,
  Users as UsersIcon,
  Mail,
  Umbrella as UmbrellaIcon,
  Shield,
  Gauge,
} from 'lucide-react';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import Select from '../../../../components/ui/Select';
import Alert from '../../../../components/ui/Alert';
import SenderIdentityFields from '../../../../components/settings/communications/SenderIdentityFields';
import { parseReplyTo } from '../../../../lib/email-dispatch/parse-reply-to';
import { PLATFORM_SENDER_DOMAIN } from '../../../../lib/email-dispatch/constants';

/**
 * Settings → Communications → Configurations → Editor
 *
 * Two-column layout:
 *   Left sidebar (320px):
 *     - Details (name, description)
 *     - Sender Identity (3-card selector + sub-form per kind)
 *     - Priority / Active / Default toggles
 *   Right column:
 *     - Attached Umbrellas (multi-select from available umbrellas)
 */

const BLANK_CONFIG = {
  id: null,
  name: '',
  description: '',
  is_active: true,
  is_default: false,
  priority: 0,
  sender_kind: 'sendgrid',
  sender_address_id: null,
  shared_account_id: null,
  use_user_gmail: false,
  umbrellas: [],
  from_display_name: '',
  reply_to_email: null,
  reply_to_name: null,
  branch_id: null,
};

export default function ConfigurationEditor() {
  const router = useRouter();
  const { id } = router.query;
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);

  const [config, setConfig] = useState(BLANK_CONFIG);
  const [original, setOriginal] = useState(BLANK_CONFIG);

  // Tenant + branches
  const [tenant, setTenant] = useState(null);
  const [branches, setBranches] = useState([]);

  // Field-level validation errors
  const [fieldErrors, setFieldErrors] = useState({});

  // Reference data
  const [senderAddresses, setSenderAddresses] = useState([]);
  const [sharedAccounts, setSharedAccounts] = useState([]);
  const [allUmbrellas, setAllUmbrellas] = useState([]);
  const [umbrellaPickerOpen, setUmbrellaPickerOpen] = useState(false);

  // Load reference data
  useEffect(() => {
    (async () => {
      const [shared, umbrellasResp, addrsResp, tenantResp, branchesResp] = await Promise.all([
        fetch('/api/tenant/emails/shared-accounts').then((r) =>
          r.ok ? r.json() : { shared_accounts: [] }
        ),
        fetch('/api/tenant/emails/umbrellas').then((r) =>
          r.ok ? r.json() : { umbrellas: [] }
        ),
        fetch('/api/tenant/emails/sender-addresses').then((r) =>
          r.ok ? r.json() : { addresses: [] }
        ),
        fetch('/api/tenant/settings').then((r) =>
          r.ok ? r.json() : { tenant: null }
        ),
        fetch('/api/tenant/branches?status=active').then((r) =>
          r.ok ? r.json() : { branches: [] }
        ),
      ]);
      setSharedAccounts(shared.shared_accounts || []);
      setAllUmbrellas(umbrellasResp.umbrellas || []);
      setSenderAddresses(addrsResp.addresses || []);
      setTenant(tenantResp.tenant || null);
      setBranches(branchesResp.branches || []);
    })();
  }, []);

  // Load the configuration
  useEffect(() => {
    if (!router.isReady) return;
    if (isNew) {
      setLoading(false);
      setConfig(BLANK_CONFIG);
      setOriginal(BLANK_CONFIG);
      return;
    }
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/tenant/emails/configurations/${id}`);
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || 'Failed to load configuration');
        }
        const data = await res.json();
        const normalized = { ...BLANK_CONFIG, ...data.configuration };
        setConfig(normalized);
        setOriginal(normalized);
      } catch (e) {
        setLoadError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [router.isReady, id, isNew]);

  function handleChange(field, value) {
    setConfig((c) => ({ ...c, [field]: value }));
  }

  function handleReset() {
    setConfig(original);
    setSaveError(null);
    setSaveSuccess(null);
    setFieldErrors({});
  }

  async function handleSave(e) {
    e?.preventDefault?.();
    // Block submit if Reply-To has a format error.
    if (fieldErrors.reply_to) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const payload = {
        name: config.name,
        description: config.description,
        is_active: config.is_active,
        is_default: config.is_default,
        priority: Number(config.priority) || 0,
        sender_kind: config.sender_kind,
        sender_address_id: config.sender_address_id,
        shared_account_id: config.shared_account_id,
        from_display_name: config.from_display_name || null,
        reply_to_email:    config.reply_to_email || null,
        reply_to_name:     config.reply_to_name || null,
        branch_id:         config.branch_id || null,
      };

      const url = isNew
        ? '/api/tenant/emails/configurations'
        : `/api/tenant/emails/configurations/${id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Save failed');
      }
      const data = await res.json();
      if (isNew) {
        router.replace(
          `/settings/communications/configurations/${data.configuration.id}`
        );
      } else {
        const refreshed = { ...BLANK_CONFIG, ...data.configuration };
        setConfig(refreshed);
        setOriginal(refreshed);
        setSaveSuccess('Configuration saved.');
      }
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${config.name}"? Any attached umbrellas will be detached. This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/tenant/emails/configurations/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Delete failed');
      }
      router.push('/settings/communications/configurations');
    } catch (e) {
      setSaveError(e.message);
      setDeleting(false);
    }
  }

  // ── Umbrella attachment handlers ──
  async function reloadConfig() {
    if (isNew || !id) return;
    const res = await fetch(`/api/tenant/emails/configurations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setConfig({ ...BLANK_CONFIG, ...data.configuration });
  }

  async function handleAttachUmbrella(umbrellaId) {
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/tenant/emails/configurations/${id}/umbrellas`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ umbrella_id: umbrellaId }),
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to attach umbrella');
      }
      await reloadConfig();
      setUmbrellaPickerOpen(false);
    } catch (e) {
      setSaveError(e.message);
    }
  }

  async function handleDetachUmbrella(attachmentId) {
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/tenant/emails/configurations/${id}/umbrellas?attachment_id=${attachmentId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to detach umbrella');
      }
      await reloadConfig();
    } catch (e) {
      setSaveError(e.message);
    }
  }

  const isDirty = useMemo(() => {
    const keys = [
      'name',
      'description',
      'is_active',
      'is_default',
      'priority',
      'sender_kind',
      'sender_address_id',
      'shared_account_id',
      'from_display_name',
      'reply_to_email',
      'reply_to_name',
      'branch_id',
    ];
    for (const k of keys) {
      if ((config[k] ?? null) !== (original[k] ?? null)) return true;
    }
    return false;
  }, [config, original]);

  const attachedUmbrellaIds = new Set(
    (config.umbrellas || []).map((u) => u.id)
  );
  const availableUmbrellas = allUmbrellas.filter(
    (u) => !attachedUmbrellaIds.has(u.id) && u.is_active
  );

  if (loadError) {
    return (
      <SettingsLayout title="Configuration">
        <div className="max-w-4xl">
          <BackLink />
          <Alert type="error" message={loadError} />
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout title={isNew ? 'New Configuration' : config.name || 'Configuration'}>
      <div className="max-w-[1400px]">
        <BackLink />

        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            {config.is_default ? (
              <Star className="w-5 h-5 text-amber-600 dark:text-amber-400 fill-amber-500 dark:fill-amber-400" />
            ) : (
              <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                {isNew ? 'New Configuration' : config.name || 'Untitled'}
              </h1>
              {config.is_default && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 px-2 py-0.5 rounded">
                  Default Configuration
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Set the sender identity on the left, then attach umbrellas on the right that should send through this configuration.
            </p>
          </div>
        </div>

        {saveError && <Alert type="error" message={saveError} className="mb-4" />}
        {saveSuccess && <Alert type="success" message={saveSuccess} className="mb-4" />}

        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <form onSubmit={handleSave}>
            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
              {/* ═════ LEFT COLUMN ═════ */}
              <aside className="space-y-4 lg:sticky lg:top-4">
                {/* Details */}
                <SidebarSection title="Details">
                  <Input
                    label="Name *"
                    value={config.name || ''}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder='e.g. "Customer-facing emails"'
                    required
                  />
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                      Description
                    </label>
                    <textarea
                      value={config.description || ''}
                      onChange={(e) => handleChange('description', e.target.value)}
                      placeholder="Internal notes"
                      rows={2}
                      className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </SidebarSection>

                {/* Sender Identity */}
                <SidebarSection title="Sender Identity">
                  <div className="space-y-2">
                    <SenderCard
                      selected={config.sender_kind === 'sendgrid'}
                      onClick={() => handleChange('sender_kind', 'sendgrid')}
                      icon={Globe}
                      title="SendGrid"
                      description="Tenant-authenticated domain (e.g. noreply@yourdomain.com). Best for automated transactional blasts."
                    />
                    <SenderCard
                      selected={config.sender_kind === 'shared_gmail'}
                      onClick={() => handleChange('sender_kind', 'shared_gmail')}
                      icon={UsersIcon}
                      title="Shared Mailbox"
                      description="A shared company Gmail/Outlook mailbox everyone sends from (e.g. dispatch@abcdrayage.com)."
                    />
                    <SenderCard
                      selected={config.sender_kind === 'user_gmail'}
                      onClick={() => handleChange('sender_kind', 'user_gmail')}
                      icon={Mail}
                      title="Personal Gmail"
                      description="Each user sends from their own connected mailbox. Good for operational back-and-forth."
                    />
                  </div>

                  {/* Sender-specific sub-picker */}
                  {config.sender_kind === 'sendgrid' && (
                    <div className="mt-4">
                      <Select
                        label="SendGrid Address *"
                        placeholder="— Pick an address —"
                        value={config.sender_address_id || ''}
                        onChange={(e) =>
                          handleChange('sender_address_id', e.target.value || null)
                        }
                        options={senderAddresses
                          .filter((a) => a.is_active)
                          .map((a) => ({
                            value: a.id,
                            label: `${a.display_name} — ${a.full_address || `${a.local_part}@${a.domain_name || '…'}`}`,
                          }))}
                      />
                      {senderAddresses.length === 0 && (
                        <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
                          No SendGrid sender addresses yet.{' '}
                          <Link
                            href="/settings/communications/sender-addresses"
                            className="underline font-medium"
                          >
                            Create one
                          </Link>{' '}
                          (you&apos;ll need a <Link
                            href="/settings/communications/sender-domains"
                            className="underline font-medium"
                          >
                            verified domain
                          </Link>{' '}
                          first).
                        </div>
                      )}
                    </div>
                  )}

                  {config.sender_kind === 'shared_gmail' && (
                    <div className="mt-4">
                      <Select
                        label="Shared Mailbox *"
                        placeholder="— Pick a shared mailbox —"
                        value={config.shared_account_id || ''}
                        onChange={(e) =>
                          handleChange('shared_account_id', e.target.value || null)
                        }
                        options={sharedAccounts
                          .filter((a) => a.is_active)
                          .map((a) => ({
                            value: a.id,
                            label: `${a.display_name || a.email_address} (${a.provider})`,
                          }))}
                      />
                      {sharedAccounts.length === 0 && (
                        <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
                          No shared mailboxes yet.{' '}
                          <Link
                            href="/settings/communications/shared-accounts"
                            className="underline font-medium"
                          >
                            Create one
                          </Link>{' '}
                          to use this sender kind.
                        </div>
                      )}
                    </div>
                  )}

                  {config.sender_kind === 'user_gmail' && (
                    <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 px-3 py-2 text-[11px] text-blue-800 dark:text-blue-200 leading-snug">
                      When this configuration fires, it uses the personal Gmail/Outlook account of whichever user&apos;s action triggered the send. Each user must connect their own mailbox in their profile.
                    </div>
                  )}
                </SidebarSection>

                {/* Sender Display Name + Reply-To */}
                {tenant && (
                  <SidebarSection title="Display Name &amp; Reply-To">
                    <SenderIdentityFields
                      value={{
                        from_display_name: config.from_display_name || '',
                        reply_to_email:    config.reply_to_email || null,
                        reply_to_name:     config.reply_to_name || null,
                      }}
                      onChange={(patch) => {
                        if ('_reply_to_raw' in patch) {
                          const parsed = parseReplyTo(patch._reply_to_raw);
                          if (parsed.ok) {
                            setConfig((c) => ({ ...c, reply_to_email: parsed.email, reply_to_name: parsed.name }));
                            setFieldErrors((e) => ({ ...e, reply_to: null }));
                          } else {
                            setFieldErrors((e) => ({ ...e, reply_to: parsed.error }));
                          }
                        } else {
                          setConfig((c) => ({ ...c, ...patch }));
                        }
                      }}
                      tenant={tenant}
                      platformDomain={PLATFORM_SENDER_DOMAIN}
                      errors={fieldErrors}
                    />
                  </SidebarSection>
                )}

                {/* Branch Scope */}
                <SidebarSection title="Branch Scope">
                  <div>
                    <label
                      htmlFor="config-branch-scope"
                      className="block text-sm font-medium text-gray-700 dark:text-slate-300"
                    >
                      Branch Scope
                    </label>
                    <select
                      id="config-branch-scope"
                      value={config.branch_id || ''}
                      onChange={(e) => setConfig((c) => ({ ...c, branch_id: e.target.value || null }))}
                      className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="">All branches (tenant-wide default)</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                      Tenant-wide configurations apply to all sends. Branch-scoped configurations
                      take priority over tenant-wide ones when the load belongs to the selected branch.
                    </p>
                  </div>
                </SidebarSection>

                {/* Behavior */}
                <SidebarSection title="Behavior">
                  <Input
                    label="Priority"
                    type="number"
                    value={config.priority ?? 0}
                    onChange={(e) =>
                      handleChange('priority', Number(e.target.value) || 0)
                    }
                    helpText="Lower = higher priority if multiple configurations could serve the same umbrella. 0 = normal."
                  />
                  <div className="mt-3">
                    <ToggleRow
                      label="Default configuration"
                      description="Only one per tenant. Used as fallback when no other configuration matches."
                      checked={!!config.is_default}
                      onChange={(v) => handleChange('is_default', v)}
                    />
                  </div>
                  <div className="mt-2">
                    <ToggleRow
                      label="Active"
                      description="Inactive configurations are skipped."
                      checked={!!config.is_active}
                      onChange={(v) => handleChange('is_active', v)}
                    />
                  </div>
                </SidebarSection>
              </aside>

              {/* ═════ RIGHT COLUMN ═════ */}
              <div className="min-w-0 space-y-4">
                {isNew ? (
                  <div className="rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-10 text-center">
                    <UmbrellaIcon className="w-10 h-10 mx-auto text-blue-400 dark:text-blue-500 mb-3" />
                    <div className="text-base font-semibold text-blue-900 dark:text-blue-200">
                      Save the configuration first to attach umbrellas
                    </div>
                    <div className="text-sm text-blue-700/80 dark:text-blue-300/80 mt-1 max-w-md mx-auto">
                      Set a name and sender identity on the left, then click <strong>Create Configuration</strong> to unlock the umbrella attachment editor here.
                    </div>
                  </div>
                ) : (
                  <Section
                    title="Attached Umbrellas"
                    description="Umbrellas that route through this configuration. When a trigger fires on a load and one of these umbrellas matches, the email sends via the sender identity above."
                    headerRight={
                      <button
                        type="button"
                        onClick={() => setUmbrellaPickerOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Attach Umbrella
                      </button>
                    }
                  >
                    {!config.umbrellas || config.umbrellas.length === 0 ? (
                      <div className="py-12 text-center rounded-lg border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40">
                        <UmbrellaIcon className="w-10 h-10 mx-auto text-gray-400 dark:text-slate-600 mb-2" />
                        <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">
                          No umbrellas attached
                        </div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                          Click <strong>Attach Umbrella</strong> to wire up an umbrella.
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {config.umbrellas.map((u) => (
                          <AttachedUmbrellaRow
                            key={u.attachment_id}
                            umbrella={u}
                            onDetach={() => handleDetachUmbrella(u.attachment_id)}
                          />
                        ))}
                      </div>
                    )}
                  </Section>
                )}
              </div>
            </div>

            {/* Save bar */}
            <div className="sticky bottom-0 -mx-4 sm:-mx-6 lg:-mx-8 mt-5 px-4 sm:px-6 lg:px-8 py-3 bg-white/95 dark:bg-slate-950/95 border-t border-gray-200 dark:border-slate-800 backdrop-blur flex items-center justify-between gap-3 z-10">
              <div className="text-xs text-gray-500 dark:text-slate-400">
                {isNew ? (
                  'Unsaved — click Save to create'
                ) : isDirty ? (
                  'Unsaved changes'
                ) : (
                  <>
                    Saved.{' '}
                    <span className="text-gray-400 dark:text-slate-500">
                      Umbrella attachments persist on every edit.
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isNew && (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={handleDelete}
                    disabled={saving || deleting}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Delete
                  </Button>
                )}
                <Button
                  variant="secondary"
                  type="button"
                  onClick={handleReset}
                  disabled={!isDirty || saving}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Reset
                </Button>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!isNew && !isDirty}
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  {isNew ? 'Create Configuration' : 'Save'}
                </Button>
              </div>
            </div>
          </form>
        )}

        {/* Umbrella picker modal */}
        {umbrellaPickerOpen && (
          <UmbrellaPickerModal
            availableUmbrellas={availableUmbrellas}
            allUmbrellas={allUmbrellas}
            onClose={() => setUmbrellaPickerOpen(false)}
            onSelect={handleAttachUmbrella}
          />
        )}
      </div>
    </SettingsLayout>
  );
}

// ──────────────────────────────────────────────────────────────
// Section helpers
// ──────────────────────────────────────────────────────────────
function BackLink() {
  return (
    <Link
      href="/settings/communications/configurations"
      className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 mb-4"
    >
      <ArrowLeft className="w-4 h-4" />
      Back to configurations
    </Link>
  );
}

function Section({ title, description, headerRight, children }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1 gap-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
        {headerRight}
      </div>
      {description && (
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">{description}</p>
      )}
      {children}
    </section>
  );
}

function SidebarSection({ title, description, children }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-3 leading-snug">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <label className="flex items-start justify-between gap-4 p-3 rounded-lg border border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{label}</div>
        {description && (
          <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0 pt-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={!!checked}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            checked ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-slate-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </label>
  );
}

function SenderCard({ selected, onClick, icon: Icon, title, description }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
        selected
          ? 'border-blue-400 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-950/30 shadow-sm'
          : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-700'
      }`}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <Icon
          className={`w-4 h-4 shrink-0 ${
            selected
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-gray-500 dark:text-slate-400'
          }`}
        />
        <div
          className={`text-sm font-semibold ${
            selected
              ? 'text-blue-900 dark:text-blue-200'
              : 'text-gray-900 dark:text-slate-100'
          }`}
        >
          {title}
        </div>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 leading-snug">
        {description}
      </div>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────
// AttachedUmbrellaRow — one row in the Attached Umbrellas list
// ──────────────────────────────────────────────────────────────
function AttachedUmbrellaRow({ umbrella, onDetach }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
        {umbrella.is_default ? (
          <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        ) : (
          <UmbrellaIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/settings/communications/umbrellas/${umbrella.id}`}
            className="text-sm font-semibold text-gray-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-400 truncate"
          >
            {umbrella.name}
          </Link>
          {umbrella.is_default && (
            <span className="text-[9px] uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 px-1.5 py-0.5 rounded">
              Default
            </span>
          )}
          {umbrella.always_run && (
            <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 px-1.5 py-0.5 rounded">
              Always-Run
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
          <span className="inline-flex items-center gap-0.5">
            <Gauge className="w-3 h-3" />
            Specificity {umbrella.specificity_score || 0}
          </span>
          {umbrella.description && (
            <span className="truncate">· {umbrella.description}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDetach}
        className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-500 dark:hover:text-rose-400 dark:hover:bg-rose-950/40"
        title="Detach umbrella"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// UmbrellaPickerModal — centered modal for picking an umbrella
// ──────────────────────────────────────────────────────────────
function UmbrellaPickerModal({ availableUmbrellas, allUmbrellas, onClose, onSelect }) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!query.trim()) return availableUmbrellas;
    const q = query.trim().toLowerCase();
    return availableUmbrellas.filter((u) => {
      const hay = `${u.name} ${u.description || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [availableUmbrellas, query]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 flex items-center gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <UmbrellaIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-gray-900 dark:text-slate-100">
              Attach an Umbrella
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Click any umbrella to wire it into this configuration.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        {availableUmbrellas.length > 5 && (
          <div className="px-6 py-3 border-b border-gray-200 dark:border-slate-700">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search umbrellas..."
              autoFocus
              className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {availableUmbrellas.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <UmbrellaIcon className="w-12 h-12 mx-auto text-gray-300 dark:text-slate-600 mb-3" />
              {allUmbrellas.length === 0 ? (
                <>
                  <div className="text-base font-semibold text-gray-900 dark:text-slate-100">
                    No umbrellas exist yet
                  </div>
                  <div className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    Create one in{' '}
                    <Link
                      href="/settings/communications/umbrellas"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Umbrellas
                    </Link>{' '}
                    first.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-base font-semibold text-gray-900 dark:text-slate-100">
                    All active umbrellas are already attached
                  </div>
                  <div className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    Detach one above to re-attach it, or create a new umbrella.
                  </div>
                </>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 px-6 text-center text-sm text-gray-500 dark:text-slate-400">
              No umbrellas match &quot;{query}&quot;
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onSelect(u.id)}
                  className="text-left p-4 rounded-xl border-2 border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-400 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 shadow-sm hover:shadow-md transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
                      {u.is_default ? (
                        <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <UmbrellaIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate">
                        {u.name}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                        {u.description || 'No description'}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                        Specificity {u.specificity_score || 0}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
