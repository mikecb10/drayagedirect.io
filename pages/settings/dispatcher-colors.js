import { useEffect, useState } from 'react';
import { Palette, RotateCcw, Copy } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import SettingsLayout from '../../components/settings/SettingsLayout';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import ColorPicker from '../../components/ui/ColorPicker';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';

import {
  DISPATCHER_STATES,
  STATE_GROUPS,
  DEFAULT_STATE_COLORS,
} from '../../lib/dispatcher-states';

// ========== Defaults ==========

const DEFAULT_LOAD_TYPE_COLORS = {
  import: '#3b82f6',
  inbound: '#0ea5e9',
  export: '#8b5cf6',
  outbound: '#a855f7',
  road: '#f97316',
  bill_only: '#6b7280',
};

const LOAD_TYPE_LABELS = {
  import: 'Import',
  inbound: 'Inbound',
  export: 'Export',
  outbound: 'Outbound',
  road: 'Road',
  bill_only: 'Bill Only',
};

// Same prefix letters used in generateOrderNumber()
const LOAD_TYPE_LETTER = {
  import: 'M',
  inbound: 'N',
  export: 'E',
  outbound: 'O',
  road: 'R',
  bill_only: 'B',
};

// Group states for display
const STATES_BY_GROUP = STATE_GROUPS.reduce((acc, group) => {
  acc[group] = DISPATCHER_STATES.filter((s) => s.group === group);
  return acc;
}, {});

const LOAD_TYPE_KEYS = Object.keys(DEFAULT_LOAD_TYPE_COLORS);

export default function DispatcherColorsSettings() {
  const { role } = useAuth();
  const isAdmin = role === 'super_admin' || role === 'admin';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stateColors, setStateColors] = useState({});
  const [loadTypeColors, setLoadTypeColors] = useState({});
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [copying, setCopying] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/settings');
      if (!res.ok) throw new Error('Failed to load settings');
      const data = await res.json();
      setStateColors(data.settings?.state_colors || {});
      setLoadTypeColors(data.settings?.load_type_colors || {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/tenant/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state_colors: stateColors,
          load_type_colors: loadTypeColors,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSuccess('Colors saved. Open the Dispatcher board to see them applied.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleResetAll() {
    if (!confirm('Reset all colors back to defaults?')) return;
    setStateColors({});
    setLoadTypeColors({});
  }

  async function handleCopyCompanyPreferences() {
    setCopying(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/settings/company-colors');
      if (!res.ok) throw new Error('Failed to fetch company colors');
      const data = await res.json();
      if (data.state_colors) setStateColors(data.state_colors);
      if (data.load_type_colors) setLoadTypeColors(data.load_type_colors);
      setSuccess('Company preference colors applied. Click Save to keep them.');
    } catch (e) {
      setError(e.message);
    } finally {
      setCopying(false);
    }
  }

  function updateStateColor(key, value) {
    setStateColors((s) => {
      const next = { ...s };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  function updateLoadTypeColor(key, value) {
    setLoadTypeColors((s) => {
      const next = { ...s };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  const effectiveState = (key) => stateColors[key] || DEFAULT_STATE_COLORS[key];
  const effectiveType = (key) => loadTypeColors[key] || DEFAULT_LOAD_TYPE_COLORS[key];

  return (
    <SettingsLayout
      title="Dispatcher Colors"
    >
      <div className="max-w-5xl space-y-[var(--space-section)]">
        <PageHeader
          variant="plain"
          title={<><Palette className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Dispatcher Colors</>}
          description={<>Customize how loads appear on the Dispatcher board. Row background uses the <strong className="text-strong">Status color</strong>, and a thin left-edge stripe uses the <strong className="text-strong">Load Type color</strong> so you can see both at a glance.</>}
          className="mb-[var(--space-section)]"
        />

        {/* Copy Company Preferences button — shown to non-admin users */}
        {!isAdmin && !loading && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-blue-800">Company Preference Colors</div>
              <div className="text-xs text-blue-600">Apply the colors your admin has configured for the company.</div>
            </div>
            <Button variant="secondary" onClick={handleCopyCompanyPreferences} loading={copying} className="!text-xs">
              <Copy className="w-3.5 h-3.5 mr-1 inline" /> Copy Company Preferences
            </Button>
          </div>
        )}

        {error && <Alert type="error" message={error} />}
        {success && <Alert type="success" message={success} />}

        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <>
            {/* Live preview */}
            <SectionCard
              title="Live Preview"
              description="How loads in different states look on the board."
              columns={0}
            >
              <div className="space-y-[var(--space-inline)]">
                {LOAD_TYPE_KEYS.map((type, idx) => {
                  // Rotate through a few states so the preview shows variety
                  const previewStateKeys = [
                    'dispatched',
                    'enroute_pull',
                    'arrived_deliver',
                    'arrived_drop',
                    'enroute_return',
                    'delivered',
                  ];
                  const stateKey = previewStateKeys[idx % previewStateKeys.length];
                  const state = DISPATCHER_STATES.find((s) => s.key === stateKey);
                  const rowBg = effectiveState(stateKey);
                  const stripe = effectiveType(type);
                  const letter = LOAD_TYPE_LETTER[type];
                  const seq = String(idx + 1).padStart(6, '0');
                  return (
                    <div
                      key={type}
                      className="rounded-lg overflow-hidden border border-gray-200 dark:border-slate-800 flex"
                      style={{ backgroundColor: rowBg }}
                    >
                      <div className="w-1" style={{ backgroundColor: stripe }} />
                      <div className="flex-1 px-3 py-2 flex items-center gap-3 text-sm">
                        <span
                          className="font-mono text-xs font-semibold"
                          style={{ color: stripe }}
                        >
                          ABCD-{letter}
                          {seq}
                        </span>
                        <span
                          className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: stripe, color: '#ffffff' }}
                        >
                          {LOAD_TYPE_LABELS[type]}
                        </span>
                        <span
                          className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: rowBg,
                            color: state?.textColor || '#111827',
                            border: '1px solid rgba(0,0,0,0.08)',
                          }}
                        >
                          {state?.label || stateKey}
                        </span>
                        <span className="text-strong">Sample Customer</span>
                        <span className="text-muted text-helper">· Container MSKU1234567</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            {/* Event State Colors — grouped by phase */}
            <SectionCard
              title="Event State Colors (Row Background)"
              description="Each load's row background reflects its current operational state — derived from the order status + current routing event + timestamps. States are grouped by the phase they belong to."
              columns={0}
            >
              <div className="space-y-[var(--space-section-pad)]">
                {STATE_GROUPS.map((group) => (
                  <div key={group}>
                    <h3 className="text-field-label text-muted mb-[var(--space-field-label)]">
                      {group}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-inline)]">
                      {STATES_BY_GROUP[group].map((state) => (
                        <ColorPicker
                          key={state.key}
                          label={state.label}
                          value={stateColors[state.key] || ''}
                          onChange={(v) => updateStateColor(state.key, v)}
                          defaultColor={DEFAULT_STATE_COLORS[state.key]}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Load Type Colors */}
            <SectionCard
              title="Load Type Colors (Accent Stripe)"
              description="A thin left-edge stripe on every row so you can tell Import vs Export vs Road at a glance."
              columns={0}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-inline)]">
                {LOAD_TYPE_KEYS.map((key) => (
                  <ColorPicker
                    key={key}
                    label={LOAD_TYPE_LABELS[key]}
                    value={loadTypeColors[key] || ''}
                    onChange={(v) => updateLoadTypeColor(key, v)}
                    defaultColor={DEFAULT_LOAD_TYPE_COLORS[key]}
                  />
                ))}
              </div>
            </SectionCard>

            {/* Actions */}
            <div className="flex justify-end gap-[var(--space-inline)]">
              <Button variant="secondary" onClick={handleResetAll}>
                <RotateCcw className="w-4 h-4 inline -mt-0.5 mr-1" />
                Reset to Defaults
              </Button>
              <Button onClick={handleSave} loading={saving}>
                Save Colors
              </Button>
            </div>
          </>
        )}
      </div>
    </SettingsLayout>
  );
}

export { DEFAULT_STATE_COLORS, DEFAULT_LOAD_TYPE_COLORS };
