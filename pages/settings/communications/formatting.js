import { useEffect, useMemo, useState } from 'react';
import { Type as TypeIcon, Eye, Save, RotateCcw } from 'lucide-react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import {
  resolveTemplate,
  mergeFormatPrefs,
  FORMAT_DEFAULTS,
} from '../../../lib/email-variable-resolver';

/**
 * Settings → Communications → Formatting
 *
 * Tenant-wide format preferences. These apply to every email, PDF,
 * and exported document the system renders, with optional per-template
 * overrides taking precedence (future milestones).
 *
 * Includes a live preview pane powered by resolveTemplate() so users
 * can see every change reflected instantly against a realistic sample.
 */

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
];

// Sample context used to drive the live preview pane. Matches the
// nested shape the resolver expects — keys mirror the variable catalog.
const SAMPLE_CONTEXT = {
  load: {
    order_number: 'TSTT001234',
    customer_reference: 'PO-887744',
  },
  container: {
    number: 'MSCU1234567',
    seal: 'SL889900',
    size: '40HC',
  },
  delivery: {
    name: 'ACME DC-Ontario',
    city: 'Ontario',
    state: 'CA',
    appointment_date: '2026-04-15T14:30:00Z',
    appointment_time: '2026-04-15T14:30:00Z',
  },
  charges: {
    total: 1156.25,
    linehaul_amount: 875,
    fuel_surcharge_amount: 131.25,
    accessorials_amount: 150,
  },
  customer: {
    name: 'ACME Imports LLC',
    primary_contact_name: 'Jane Doe',
    primary_contact_phone: '5551234599',
  },
  driver: {
    full_name: 'Miguel Garcia',
    phone: '5557894411',
  },
  tenant: {
    name: 'Test Truck Lines',
    scac_code: 'TSTT',
  },
};

// Preview body the live panel renders. Uses variables that exercise
// every formatter so users can see each preference's effect at a glance.
const PREVIEW_BODY = `Hi {{customer.primary_contact_name}},

Your container {{container.number}} (seal {{container.seal}}) has been delivered to {{delivery.name}}.

Appointment: {{delivery.appointment_time}}
Driver: {{driver.full_name}} · {{driver.phone}}

Invoice total: {{charges.total}}
  Linehaul: {{charges.linehaul_amount}}
  Fuel surcharge: {{charges.fuel_surcharge_amount}}
  Accessorials: {{charges.accessorials_amount}}

Reference: {{load.customer_reference}}

Thank you,
{{tenant.name}}`;

export default function FormattingSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState(null);
  const [original, setOriginal] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/settings/format-preferences');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load preferences');
      }
      const data = await res.json();
      setPrefs(data.preferences);
      setOriginal(data.preferences);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleChange(field, value) {
    setPrefs((p) => ({ ...p, [field]: value }));
  }

  async function handleSave(e) {
    e?.preventDefault?.();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // Only send fields the API will accept (schema-drift guard)
      const body = {
        date_format: prefs.date_format,
        date_use_long_month: !!prefs.date_use_long_month,
        date_empty_placeholder: prefs.date_empty_placeholder,
        time_format: prefs.time_format,
        timezone: prefs.timezone || null,
        time_show_timezone: !!prefs.time_show_timezone,
        currency_code: prefs.currency_code,
        currency_symbol: prefs.currency_symbol,
        currency_position: prefs.currency_position,
        currency_thousands: prefs.currency_thousands,
        currency_decimal: prefs.currency_decimal,
        currency_decimal_places: Number(prefs.currency_decimal_places) || 2,
        currency_negative_style: prefs.currency_negative_style,
        number_thousands: prefs.number_thousands,
        number_decimal: prefs.number_decimal,
        weight_unit: prefs.weight_unit,
        weight_decimal_places: Number(prefs.weight_decimal_places) || 0,
        weight_show_unit: !!prefs.weight_show_unit,
        distance_unit: prefs.distance_unit,
        phone_format: prefs.phone_format,
        phone_country_default: prefs.phone_country_default,
        address_format: prefs.address_format,
        address_name_separator: prefs.address_name_separator,
        container_number_format: prefs.container_number_format,
        empty_placeholder: prefs.empty_placeholder,
        strict_empty_mode: !!prefs.strict_empty_mode,
        organization_name_case: prefs.organization_name_case,
        location_name_case: prefs.location_name_case,
        default_signature_enabled: !!prefs.default_signature_enabled,
        default_signature_html: prefs.default_signature_html || null,
      };

      const res = await fetch('/api/tenant/settings/format-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Save failed');
      }
      const data = await res.json();
      setPrefs(data.preferences);
      setOriginal(data.preferences);
      setSuccess('Format preferences saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!original) return;
    setPrefs(original);
    setError(null);
    setSuccess(null);
  }

  const isDirty = useMemo(() => {
    if (!prefs || !original) return false;
    return JSON.stringify(prefs) !== JSON.stringify(original);
  }, [prefs, original]);

  // Live preview — render the sample body against the current prefs
  const previewResult = useMemo(() => {
    if (!prefs) return null;
    const merged = mergeFormatPrefs(prefs, {});
    return resolveTemplate({
      body: PREVIEW_BODY,
      context: SAMPLE_CONTEXT,
      formatPrefs: merged,
      strict: false,
    });
  }, [prefs]);

  return (
    <SettingsLayout title="Formatting">
      <div className="max-w-6xl">
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <TypeIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Formatting Preferences
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Controls how dates, currency, phone numbers, addresses, and other values
              render in every email, PDF, and export across your tenant. Individual
              templates can override any of these values.
            </p>
          </div>
        </div>

        {error && <Alert type="error" message={error} className="mb-4" />}
        {success && <Alert type="success" message={success} className="mb-4" />}

        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : prefs ? (
          <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-6">
            {/* ── Left column: the editing form ── */}
            <div className="space-y-6 min-w-0">
              {/* Dates */}
              <Section
                title="Dates"
                description="How calendar dates render everywhere the system prints them."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Date Format"
                    value={prefs.date_format}
                    onChange={(e) => handleChange('date_format', e.target.value)}
                    options={[
                      { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY — 04/11/2026' },
                      { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY — 11/04/2026' },
                      { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD — 2026-04-11' },
                      { value: 'MMM D, YYYY', label: 'MMM D, YYYY — Apr 11, 2026' },
                      { value: 'D MMM YYYY', label: 'D MMM YYYY — 11 Apr 2026' },
                    ]}
                  />
                  <Input
                    label="Empty Date Placeholder"
                    value={prefs.date_empty_placeholder || ''}
                    onChange={(e) => handleChange('date_empty_placeholder', e.target.value)}
                    helpText="What to show when a date hasn't been set yet"
                  />
                </div>
                <div className="mt-3">
                  <ToggleRow
                    label="Use long month names"
                    description={'Force "Apr 11, 2026" style even when a short format is selected'}
                    checked={!!prefs.date_use_long_month}
                    onChange={(v) => handleChange('date_use_long_month', v)}
                  />
                </div>
              </Section>

              {/* Times */}
              <Section
                title="Times"
                description="How timestamps render. Timezone picks the tenant's default display zone."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Time Format"
                    value={prefs.time_format}
                    onChange={(e) => handleChange('time_format', e.target.value)}
                    options={[
                      { value: '12h', label: '12-hour (AM/PM) — 2:30 PM' },
                      { value: '24h', label: '24-hour (Military) — 14:30' },
                    ]}
                  />
                  <Select
                    label="Timezone"
                    value={prefs.timezone || ''}
                    onChange={(e) => handleChange('timezone', e.target.value || null)}
                    options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                  />
                </div>
                <div className="mt-3">
                  <ToggleRow
                    label="Show timezone abbreviation"
                    description={'Append "EDT", "PDT" etc. after rendered times'}
                    checked={!!prefs.time_show_timezone}
                    onChange={(v) => handleChange('time_show_timezone', v)}
                  />
                </div>
              </Section>

              {/* Currency */}
              <Section
                title="Currency"
                description="Every monetary value — invoice totals, line items, quotes, driver pay."
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Input
                    label="Currency Code"
                    value={prefs.currency_code || ''}
                    onChange={(e) =>
                      handleChange('currency_code', e.target.value.toUpperCase().slice(0, 4))
                    }
                    placeholder="USD"
                  />
                  <Input
                    label="Symbol"
                    value={prefs.currency_symbol || ''}
                    onChange={(e) => handleChange('currency_symbol', e.target.value.slice(0, 4))}
                    placeholder="$"
                  />
                  <Select
                    label="Position"
                    value={prefs.currency_position}
                    onChange={(e) => handleChange('currency_position', e.target.value)}
                    options={[
                      { value: 'prefix', label: 'Prefix — $1,234.56' },
                      { value: 'suffix', label: 'Suffix — 1,234.56 $' },
                      { value: 'code_suffix', label: 'Code suffix — 1,234.56 USD' },
                    ]}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                  <Input
                    label="Thousands Separator"
                    value={prefs.currency_thousands || ''}
                    onChange={(e) => handleChange('currency_thousands', e.target.value.slice(0, 1))}
                    placeholder=","
                  />
                  <Input
                    label="Decimal Separator"
                    value={prefs.currency_decimal || ''}
                    onChange={(e) => handleChange('currency_decimal', e.target.value.slice(0, 1))}
                    placeholder="."
                  />
                  <Input
                    label="Decimal Places"
                    type="number"
                    min={0}
                    max={4}
                    value={prefs.currency_decimal_places ?? 2}
                    onChange={(e) =>
                      handleChange('currency_decimal_places', Number(e.target.value))
                    }
                  />
                </div>
                <div className="mt-4">
                  <Select
                    label="Negative Numbers"
                    value={prefs.currency_negative_style}
                    onChange={(e) => handleChange('currency_negative_style', e.target.value)}
                    options={[
                      { value: 'minus', label: 'Minus — -$1,234.56' },
                      { value: 'parens', label: 'Parentheses — ($1,234.56)' },
                      { value: 'red_minus', label: 'Red minus (HTML) — −$1,234.56' },
                    ]}
                  />
                </div>
              </Section>

              {/* Weight & Distance */}
              <Section
                title="Units"
                description="Measurement units used when rendering load weight and lane distance."
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Select
                    label="Weight Unit"
                    value={prefs.weight_unit}
                    onChange={(e) => handleChange('weight_unit', e.target.value)}
                    options={[
                      { value: 'lbs', label: 'Pounds (lbs)' },
                      { value: 'kg', label: 'Kilograms (kg)' },
                    ]}
                  />
                  <Input
                    label="Weight Decimals"
                    type="number"
                    min={0}
                    max={4}
                    value={prefs.weight_decimal_places ?? 0}
                    onChange={(e) =>
                      handleChange('weight_decimal_places', Number(e.target.value))
                    }
                  />
                  <Select
                    label="Distance Unit"
                    value={prefs.distance_unit}
                    onChange={(e) => handleChange('distance_unit', e.target.value)}
                    options={[
                      { value: 'mi', label: 'Miles (mi)' },
                      { value: 'km', label: 'Kilometers (km)' },
                    ]}
                  />
                </div>
                <div className="mt-3">
                  <ToggleRow
                    label="Show weight unit suffix"
                    description={'Append "lbs" / "kg" after rendered weight values'}
                    checked={!!prefs.weight_show_unit}
                    onChange={(v) => handleChange('weight_show_unit', v)}
                  />
                </div>
              </Section>

              {/* Phone */}
              <Section
                title="Phone Numbers"
                description="How phone numbers get formatted when shown in emails, PDFs, and the UI."
              >
                <Select
                  label="Phone Format"
                  value={prefs.phone_format}
                  onChange={(e) => handleChange('phone_format', e.target.value)}
                  options={[
                    { value: '(###) ###-####', label: '(555) 123-4567' },
                    { value: '###-###-####', label: '555-123-4567' },
                    { value: '###.###.####', label: '555.123.4567' },
                    { value: '+1 ### ### ####', label: '+1 555 123 4567' },
                    { value: 'raw', label: 'Raw digits — 5551234567' },
                  ]}
                />
              </Section>

              {/* Addresses */}
              <Section
                title="Addresses & Names"
                description="How locations and organization names render."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Address Format"
                    value={prefs.address_format}
                    onChange={(e) => handleChange('address_format', e.target.value)}
                    options={[
                      { value: 'single_line', label: 'Single line — comma-separated' },
                      { value: 'multi_line', label: 'Multi-line — street / city line' },
                      { value: 'company_first', label: 'Company first + address lines' },
                    ]}
                  />
                  <Input
                    label="Name Separator"
                    value={prefs.address_name_separator || ''}
                    onChange={(e) =>
                      handleChange('address_name_separator', e.target.value.slice(0, 6))
                    }
                    helpText={'Used in "Org Name — City, ST" composites'}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                  <Select
                    label="Organization Name Case"
                    value={prefs.organization_name_case}
                    onChange={(e) => handleChange('organization_name_case', e.target.value)}
                    options={[
                      { value: 'as_entered', label: 'As entered — Acme Imports LLC' },
                      { value: 'upper', label: 'UPPERCASE — ACME IMPORTS LLC' },
                      { value: 'title', label: 'Title Case — Acme Imports Llc' },
                    ]}
                  />
                  <Select
                    label="Location Name Case"
                    value={prefs.location_name_case}
                    onChange={(e) => handleChange('location_name_case', e.target.value)}
                    options={[
                      { value: 'as_entered', label: 'As entered' },
                      { value: 'upper', label: 'UPPERCASE' },
                      { value: 'title', label: 'Title Case' },
                    ]}
                  />
                </div>
              </Section>

              {/* Container numbers */}
              <Section
                title="Container Numbers"
                description="ISO container number rendering. All three formats reference the same stored value."
              >
                <Select
                  label="Container Number Format"
                  value={prefs.container_number_format}
                  onChange={(e) => handleChange('container_number_format', e.target.value)}
                  options={[
                    { value: 'compact', label: 'Compact — MSCU1234567' },
                    { value: 'grouped', label: 'Grouped — MSCU 123456-7' },
                    { value: 'spaced', label: 'Spaced — MSCU 123456 7' },
                  ]}
                />
              </Section>

              {/* Empty & strict mode */}
              <Section
                title="Empty Values"
                description="What the system prints when a variable has no value."
              >
                <Input
                  label="Empty Placeholder"
                  value={prefs.empty_placeholder || ''}
                  onChange={(e) => handleChange('empty_placeholder', e.target.value.slice(0, 16))}
                  helpText={'Shown in place of missing values (except dates — those use the date placeholder)'}
                />
                <div className="mt-4">
                  <ToggleRow
                    label="Strict empty mode"
                    description="When ON, email sends are aborted if any required variable is empty. When OFF (default), the placeholder is rendered and the email sends anyway."
                    checked={!!prefs.strict_empty_mode}
                    onChange={(v) => handleChange('strict_empty_mode', v)}
                  />
                </div>
              </Section>
            </div>

            {/* ── Right column: sticky live preview ── */}
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <div className="rounded-xl border-2 border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 overflow-hidden">
                <div className="px-4 py-3 border-b border-blue-200 dark:border-blue-900/60 bg-white/60 dark:bg-slate-900/60 flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <div className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                    Live Preview
                  </div>
                </div>
                <div className="p-4 text-xs text-blue-700/80 dark:text-blue-300/80 border-b border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10">
                  A sample email body rendered against your current formatting choices.
                  Updates instantly as you edit.
                </div>
                <pre className="p-4 text-sm text-gray-900 dark:text-slate-100 whitespace-pre-wrap break-words font-sans">
                  {previewResult?.output || ''}
                </pre>
                {previewResult?.missing?.length > 0 && (
                  <div className="px-4 py-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50/50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-900/60">
                    {previewResult.missing.length} variable
                    {previewResult.missing.length === 1 ? '' : 's'} fell back to the empty
                    placeholder.
                  </div>
                )}
              </div>

              {/* Save bar */}
              <div className="mt-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-500 dark:text-slate-400">
                    {isDirty ? 'Unsaved changes' : 'No changes'}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={handleReset}
                      disabled={!isDirty || saving}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                      Reset
                    </Button>
                    <Button type="submit" loading={saving} disabled={!isDirty}>
                      <Save className="w-3.5 h-3.5 mr-1.5" />
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </aside>
          </form>
        ) : null}
      </div>
    </SettingsLayout>
  );
}

// ──────────────────────────────────────────────────────────────
// Tiny internal components (kept local to keep the file self-contained)
// ──────────────────────────────────────────────────────────────

function Section({ title, description, children }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
      {description && (
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 mb-4">{description}</p>
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
          <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{description}</div>
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
