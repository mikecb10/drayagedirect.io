import { useEffect, useState, useRef } from 'react';
import { Upload, X, Image as ImageIcon, Users } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import SettingsTabs from '../../components/settings/SettingsTabs';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import CurrencyInput from '../../components/ui/CurrencyInput';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import FieldGroup from '../../components/ui/FieldGroup';
import Field from '../../components/ui/Field';
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';
import { useAuth } from '../../contexts/AuthContext';


const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
];

const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];

function CompanySettings() {
  const { role } = useAuth();
  const isAdmin = role === 'admin' || role === 'super_admin';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenant, setTenant] = useState(null);
  const [settings, setSettings] = useState({});
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/settings');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load settings');
      }
      const data = await res.json();
      setTenant(data.tenant);
      setSettings(data.settings || {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/tenant/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_display_name: settings.company_display_name || null,
          invoice_prefix: settings.invoice_prefix || 'INV',
          order_prefix: settings.order_prefix || 'ORD',
          scac_code: (settings.scac_code || '').toUpperCase().trim() || null,
          default_payment_terms: Number(settings.default_payment_terms) || 30,
          default_fuel_surcharge_pct: Number(settings.default_fuel_surcharge_pct) || 0,
          labor_fee_cents: Number(settings.labor_fee_cents) || 0,
          quote_validity_days: Number(settings.quote_validity_days) || 30,
          timezone: settings.timezone || 'America/New_York',
          date_format: settings.date_format || 'MM/DD/YYYY',
          time_format: settings.time_format || '12h',
          logo_small_url: settings.logo_small_url || null,
          logo_large_url: settings.logo_large_url || null,
          live_presence_enabled: settings.live_presence_enabled !== false,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save settings');
      }
      const data = await res.json();
      setSettings(data.settings);
      setSuccess('Settings saved successfully.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleChange(field, value) {
    setSettings((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="max-w-4xl">
        <PageHeader
          variant="plain"
          title="Company Settings"
          description="Manage your company info, invoice defaults, and operational preferences."
          className="mb-[var(--space-section)]"
        />

        <SettingsTabs />

        {error && <Alert type="error" message={error} className="mb-[var(--space-field)]" />}
        {success && <Alert type="success" message={success} className="mb-[var(--space-field)]" />}

        {/* SCAC missing warning — blocks invoicing downstream */}
        {!loading && !(settings.scac_code || '').trim() && (
          <div className="mb-[var(--space-field)] rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-body font-semibold text-amber-900">
                SCAC code not set — invoicing is blocked
              </div>
              <div className="text-helper text-amber-800 mt-0.5">
                Your 4-character SCAC is required to generate QuickBooks-compatible invoice numbers.
                Set it in the <strong>Invoice &amp; Order Defaults</strong> section below, then save.
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-[var(--space-section)]">
            {/* Read-only tenant info */}
            <SectionCard
              title="Account Information"
              description="Managed by your DrayageDirect account representative. Contact support to update."
              columns={0}
            >
              <DetailPane>
                <DetailRow label="Company Name" value={tenant?.name || '—'} muted={!tenant?.name} />
                <DetailRow label="Slug" value={tenant?.slug || '—'} muted={!tenant?.slug} copyable={!!tenant?.slug} />
                <DetailRow
                  label="Status"
                  value={tenant?.status ? <Badge variant={tenant.status === 'active' ? 'green' : 'yellow'}>{tenant.status}</Badge> : '—'}
                />
                <DetailRow label="Contact Email" value={tenant?.contact_email || '—'} muted={!tenant?.contact_email} />
                <DetailRow label="MC Number" value={tenant?.mc_number || '—'} muted={!tenant?.mc_number} />
                <DetailRow label="DOT Number" value={tenant?.dot_number || '—'} muted={!tenant?.dot_number} />
              </DetailPane>
            </SectionCard>

            {/* Display preferences */}
            <SectionCard
              title="Display Preferences"
              description="How your company name appears in the portal and on documents."
              columns={0}
            >
              <FieldGroup columns={1}>
                <Field label="Company Display Name">
                  <Input
                    value={settings.company_display_name || ''}
                    onChange={(e) => handleChange('company_display_name', e.target.value)}
                    placeholder={tenant?.name}
                  />
                </Field>
              </FieldGroup>
            </SectionCard>

            {/* Company Branding — Logo Upload */}
            <SectionCard
              title="Company Branding"
              description="Upload your company logos. These appear in the sidebar navigation and throughout your portal."
              columns={0}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-field)]">
                {/* Small Logo */}
                <LogoUploader
                  label="Small Logo (Icon)"
                  description="Shown in the collapsed sidebar. Recommended: 64×64px, square."
                  value={settings.logo_small_url}
                  onChange={(url) => handleChange('logo_small_url', url)}
                  previewSize="w-12 h-12"
                  tenantId={tenant?.id}
                  fileKey="logo_small"
                />

                {/* Large Logo */}
                <LogoUploader
                  label="Full Logo"
                  description="Shown in the expanded sidebar. Recommended: 320×80px, horizontal."
                  value={settings.logo_large_url}
                  onChange={(url) => handleChange('logo_large_url', url)}
                  previewSize="h-10 max-w-[200px]"
                  tenantId={tenant?.id}
                  fileKey="logo_large"
                />
              </div>
            </SectionCard>

            {/* Invoice / Order defaults */}
            <div id="invoices">
              <SectionCard
                title="Invoice & Order Defaults"
                description="These values pre-fill when you create a new invoice or order."
                columns={0}
              >
                <FieldGroup columns={2}>
                  <Field
                    label="Carrier SCAC Code"
                    required
                    helper="Required for invoicing. 4-character Standard Carrier Alpha Code (first 3 chars are used as the invoice number prefix, e.g. ABC001001). Also used for load number prefix."
                  >
                    <Input
                      value={settings.scac_code || ''}
                      onChange={(e) =>
                        handleChange('scac_code', e.target.value.toUpperCase().slice(0, 4))
                      }
                      maxLength={4}
                      placeholder="ABCD"
                    />
                  </Field>
                  <Field label="Invoice Prefix">
                    <Input
                      value={settings.invoice_prefix || ''}
                      onChange={(e) => handleChange('invoice_prefix', e.target.value)}
                      placeholder="INV"
                    />
                  </Field>
                  <Field label="Order Prefix (legacy fallback)" helper="Used only if no SCAC code is set above.">
                    <Input
                      value={settings.order_prefix || ''}
                      onChange={(e) => handleChange('order_prefix', e.target.value)}
                      placeholder="ORD"
                    />
                  </Field>
                  <Field label="Default Payment Terms (days)">
                    <Input
                      type="number"
                      value={settings.default_payment_terms ?? ''}
                      onChange={(e) => handleChange('default_payment_terms', e.target.value)}
                    />
                  </Field>
                  <Field label="Quote Validity (days)">
                    <Input
                      type="number"
                      value={settings.quote_validity_days ?? ''}
                      onChange={(e) => handleChange('quote_validity_days', e.target.value)}
                    />
                  </Field>
                  <Field label="Default Fuel Surcharge (%)">
                    <Input
                      type="number"
                      step="0.01"
                      value={settings.default_fuel_surcharge_pct ?? ''}
                      onChange={(e) =>
                        handleChange('default_fuel_surcharge_pct', e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Default Labor Fee" helper="Applied to quotes and invoices by default">
                    <CurrencyInput
                      valueCents={settings.labor_fee_cents}
                      onChangeCents={(cents) => handleChange('labor_fee_cents', cents)}
                    />
                  </Field>
                </FieldGroup>
              </SectionCard>
            </div>

            {/* Regional */}
            <SectionCard
              title="Regional Settings"
              description="Control how dates and times display across the portal."
              columns={0}
            >
              <FieldGroup columns={3}>
                <Field label="Timezone">
                  <Select
                    value={settings.timezone || 'America/New_York'}
                    onChange={(e) => handleChange('timezone', e.target.value)}
                    options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                  />
                </Field>
                <Field label="Date Format">
                  <Select
                    value={settings.date_format || 'MM/DD/YYYY'}
                    onChange={(e) => handleChange('date_format', e.target.value)}
                    options={DATE_FORMATS.map((df) => ({ value: df, label: df }))}
                  />
                </Field>
                <Field label="Time Format">
                  <Select
                    value={settings.time_format || '12h'}
                    onChange={(e) => handleChange('time_format', e.target.value)}
                    options={[
                      { value: '12h', label: '12-hour (AM/PM) — 2:30 PM' },
                      { value: '24h', label: '24-hour (Military) — 14:30' },
                    ]}
                  />
                </Field>
              </FieldGroup>
            </SectionCard>

            {/* ═══════════════════════════════════════════════════════ */}
            {/* Collaboration — admin-only feature toggles              */}
            {/* ═══════════════════════════════════════════════════════ */}
            {isAdmin && (
              <SectionCard
                title={<><Users className="w-4 h-4 text-muted inline -mt-0.5 mr-1.5" />Collaboration</>}
                description="Live multi-user features on the dispatcher board."
                columns={0}
              >
                <label className="flex items-start justify-between gap-[var(--space-field)] p-[var(--space-section-pad)] rounded-lg border border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer">
                  <div className="flex-1">
                    <div className="text-body font-medium text-strong">
                      Live presence &amp; cursors
                    </div>
                    <div className="text-helper text-muted mt-[var(--space-field-helper)]">
                      Show avatars of teammates currently viewing the dispatcher board and
                      display their mouse cursors in real-time.
                    </div>
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.live_presence_enabled !== false}
                      onClick={() =>
                        handleChange(
                          'live_presence_enabled',
                          !(settings.live_presence_enabled !== false)
                        )
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        settings.live_presence_enabled !== false
                          ? 'bg-emerald-500'
                          : 'bg-gray-300 dark:bg-slate-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          settings.live_presence_enabled !== false
                            ? 'translate-x-6'
                            : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </label>
              </SectionCard>
            )}

            <div className="flex justify-end gap-[var(--space-inline)]">
              <Button variant="secondary" type="button" onClick={load}>
                Reset
              </Button>
              <Button type="submit" loading={saving}>
                Save Changes
              </Button>
            </div>
          </form>
        )}
      </div>
  );
}

CompanySettings.getLayout = (page) => (
  <SettingsLayout title="Company Settings">{page}</SettingsLayout>
);

export default CompanySettings;

// ── Logo Uploader Component ──────────────────────────────────
function LogoUploader({ label, description, value, onChange, previewSize, tenantId, fileKey }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, SVG, WebP)');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('File must be under 2MB');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      // Upload via our API (which handles Supabase Storage)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('key', fileKey);

      const res = await fetch('/api/tenant/branding/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Upload failed');
      }

      const data = await res.json();
      onChange(data.url);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      // Reset file input
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleRemove() {
    onChange(null);
  }

  return (
    <div>
      <label className="block text-body font-medium text-strong mb-1">{label}</label>
      <p className="text-helper text-muted mb-3">{description}</p>

      {value ? (
        <div className="flex items-center gap-4">
          <div className="border border-gray-200 dark:border-slate-800 rounded-lg p-2 bg-gray-50 dark:bg-slate-800/50">
            <img src={value} alt={label} className={`${previewSize} object-contain`} />
          </div>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => inputRef.current?.click()}
              className="text-helper text-blue-600 hover:text-blue-700 font-medium">
              Replace
            </button>
            <button type="button" onClick={handleRemove}
              className="text-helper text-red-500 hover:text-red-600 font-medium">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-3 w-full rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-700 hover:border-blue-400 p-4 text-left transition-colors group"
        >
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-slate-800 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/40 flex items-center justify-center shrink-0">
            {uploading ? (
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Upload className="w-5 h-5 text-gray-400 dark:text-slate-500 group-hover:text-blue-500" />
            )}
          </div>
          <div>
            <div className="text-body font-medium text-strong group-hover:text-blue-600">
              {uploading ? 'Uploading...' : 'Click to upload'}
            </div>
            <div className="text-helper text-muted">PNG, JPG, SVG, or WebP · Max 2MB</div>
          </div>
        </button>
      )}

      {error && <p className="text-helper text-red-500 mt-2">{error}</p>}

      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
    </div>
  );
}
