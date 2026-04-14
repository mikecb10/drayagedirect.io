import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Save,
  Info,
  Edit2,
  Bell,
  Calendar,
  CircleDot,
  Check,
  Square,
  CheckSquare,
} from 'lucide-react';
import Button from './Button';
import Input from './Input';
import Select from './Select';
import Alert from './Alert';
import {
  TRIGGER_KINDS,
  FIELD_CHANGE_TRIGGERS,
  FIELD_CHANGE_TYPES,
  POD_VALIDATION_GATES,
  NOTIFICATION_TRIGGERS,
  COMPOSITE_EVENT_TRIGGERS,
  LOAD_STATUSES,
  DEDUPE_PRESETS,
  getFieldChangeByKey,
  getNotificationByKey,
  getCompositeEventByKey,
  getLoadStatusByValue,
  resolveOptions,
  emptyDuration,
} from '../../lib/email-trigger-events';

/**
 * TriggerModal — create or edit a single email_template_trigger under the
 * new drayage-specific 4-kind model:
 *
 *   1. Field Change  — pick field + change type (Added/Removed/Updated)
 *                      POD gets an extra "validation gate" option
 *   2. Notification  — pick a boolean notification flag
 *   3. Event         — pick a composite event + render its conditionSchema sub-form
 *                      The Missing Information event has a nested 3-level form
 *                      (status + notify_after + applicable_fields multi-select)
 *   4. Load Status   — pick a status + enter NOTIFY AFTER d/h/m
 *
 * All conditions values are stored in the `conditions` JSONB column.
 */
export default function TriggerModal({ initial, onClose, onSave }) {
  const isEdit = !!initial;

  const [form, setForm] = useState(() => initialForm(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Escape + body scroll lock
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

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setCondition(key, value) {
    setForm((f) => ({
      ...f,
      conditions: { ...f.conditions, [key]: value },
    }));
  }

  // When the trigger kind changes, reset the event_name + conditions so
  // stale data from the previous kind doesn't leak into the payload.
  function setKind(kind) {
    setForm((f) => ({
      ...f,
      trigger_kind: kind,
      event_name: '',
      conditions: {},
    }));
  }

  // When the user picks a new event_name, seed the conditions defaults
  // based on the selected trigger's schema (so duration fields exist).
  function setEventName(newEventName) {
    setForm((f) => {
      const seeded = seedConditions(f.trigger_kind, newEventName);
      return { ...f, event_name: newEventName, conditions: seeded };
    });
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    setError(null);

    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!form.trigger_kind) {
      setError('Trigger kind is required');
      return;
    }
    if (!form.event_name) {
      setError('Pick a specific trigger from the dropdown');
      return;
    }

    // Kind-specific validation
    if (form.trigger_kind === 'field_change') {
      if (!form.conditions?.change_type) {
        setError('Pick whether this fires on Added, Removed, or Updated');
        return;
      }
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      trigger_kind: form.trigger_kind,
      event_name: form.event_name,
      conditions: form.conditions || {},
      dedupe_window_seconds: Number(form.dedupe_window_seconds) || 3600,
      is_active: !!form.is_active,
    };

    setSaving(true);
    try {
      await onSave(payload);
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[92vh] rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 flex items-center gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <CircleDot className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-gray-900 dark:text-slate-100">
              {isEdit ? 'Edit Trigger' : 'New Trigger'}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Decide when this template automatically fires.
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

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">
            {error && <Alert type="error" message={error} />}

            {/* Kind selector — 4 cards in a 2x2 grid */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-2">
                Trigger Kind
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {TRIGGER_KINDS.map((kind) => (
                  <KindCard
                    key={kind.value}
                    selected={form.trigger_kind === kind.value}
                    onClick={() => setKind(kind.value)}
                    icon={iconForKind(kind.value)}
                    title={kind.label}
                    description={kind.description}
                  />
                ))}
              </div>
            </div>

            {/* Name + description */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-2">
                Details
              </div>
              <Input
                label="Name *"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder={
                  form.trigger_kind === 'field_change'
                    ? 'e.g. "Alert on Container Number added"'
                    : form.trigger_kind === 'notification'
                    ? 'e.g. "POD received — send to customer"'
                    : form.trigger_kind === 'event'
                    ? 'e.g. "Approaching Demurrage — 24h warning"'
                    : 'e.g. "30m after Dispatched"'
                }
                required
                autoComplete="off"
              />
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  rows={2}
                  placeholder="Optional internal notes"
                  className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Kind-specific sub-form */}
            {form.trigger_kind === 'field_change' && (
              <FieldChangeForm form={form} setField={setField} setCondition={setCondition} />
            )}
            {form.trigger_kind === 'notification' && (
              <NotificationForm form={form} setEventName={setEventName} />
            )}
            {form.trigger_kind === 'event' && (
              <CompositeEventForm
                form={form}
                setEventName={setEventName}
                setCondition={setCondition}
              />
            )}
            {form.trigger_kind === 'status' && (
              <LoadStatusForm
                form={form}
                setEventName={setEventName}
                setCondition={setCondition}
              />
            )}

            {/* Dedupe + Active (common to all) */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-2">
                Options
              </div>
              <Select
                label="Dedupe window"
                value={String(form.dedupe_window_seconds)}
                onChange={(e) =>
                  setField('dedupe_window_seconds', Number(e.target.value))
                }
                options={DEDUPE_PRESETS.map((p) => ({
                  value: String(p.seconds),
                  label: p.label,
                }))}
              />
              <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                If the same trigger would fire twice within this window, the second one is skipped.
              </div>

              <div className="mt-4">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.is_active}
                    onChange={(e) => setField('is_active', e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
                      Active
                    </div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">
                      Inactive triggers are skipped entirely by the trigger engine.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 px-6 py-3 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 flex items-center justify-end gap-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {isEdit ? 'Save Changes' : 'Create Trigger'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Kind-specific sub-forms
// ──────────────────────────────────────────────────────────────

function FieldChangeForm({ form, setField, setCondition }) {
  const selected = form.event_name ? getFieldChangeByKey(form.event_name) : null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-2">
        Field Change Details
      </div>
      <Select
        label="Field *"
        placeholder="— Pick a field —"
        value={form.event_name}
        onChange={(e) => {
          setField('event_name', e.target.value);
          setField('conditions', { change_type: 'updated' });
        }}
        options={FIELD_CHANGE_TRIGGERS.map((f) => ({ value: f.key, label: f.label }))}
      />
      {selected && (
        <InfoBanner text={selected.description} />
      )}

      {form.event_name && (
        <div className="mt-3">
          <Select
            label="When the field is *"
            value={form.conditions?.change_type || 'updated'}
            onChange={(e) => setCondition('change_type', e.target.value)}
            options={FIELD_CHANGE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </div>
      )}

      {/* POD-specific validation gate */}
      {selected?.hasPodValidationGate && (
        <div className="mt-3">
          <Select
            label="Validation gate"
            value={form.conditions?.validation_gate || 'at_upload'}
            onChange={(e) => setCondition('validation_gate', e.target.value)}
            options={POD_VALIDATION_GATES.map((g) => ({
              value: g.value,
              label: g.label,
            }))}
          />
          <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            Choose whether the email goes out immediately at POD upload or waits for
            the document validation workflow to mark the POD as good.
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationForm({ form, setEventName }) {
  const selected = form.event_name
    ? getNotificationByKey(form.event_name)
    : null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-2">
        Notification
      </div>
      <Select
        label="Fires when *"
        placeholder="— Pick a notification —"
        value={form.event_name}
        onChange={(e) => setEventName(e.target.value)}
        options={NOTIFICATION_TRIGGERS.map((n) => ({
          value: n.key,
          label: `${n.label} is true`,
        }))}
      />
      {selected && <InfoBanner text={selected.description} />}
    </div>
  );
}

function CompositeEventForm({ form, setEventName, setCondition }) {
  const selected = form.event_name
    ? getCompositeEventByKey(form.event_name)
    : null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-2">
        Event
      </div>
      <Select
        label="Event *"
        placeholder="— Pick an event —"
        value={form.event_name}
        onChange={(e) => setEventName(e.target.value)}
        options={COMPOSITE_EVENT_TRIGGERS.map((e) => ({
          value: e.key,
          label: e.label,
        }))}
      />
      {selected && <InfoBanner text={selected.description} />}

      {/* Dynamic condition sub-form driven by the event's conditionSchema */}
      {selected && selected.conditionSchema.fields.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40 p-4 space-y-4">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">
            Conditions
          </div>
          {selected.conditionSchema.fields.map((field) => (
            <ConditionField
              key={field.key}
              field={field}
              value={form.conditions?.[field.key]}
              onChange={(v) => setCondition(field.key, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LoadStatusForm({ form, setEventName, setCondition }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-2">
        Load Status
      </div>
      <Select
        label="When Load Status is *"
        placeholder="— Pick a status —"
        value={form.event_name}
        onChange={(e) => setEventName(e.target.value)}
        options={LOAD_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
      />
      {form.event_name && (
        <>
          <div className="mt-2 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 px-3 py-2 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs text-blue-800 dark:text-blue-200 leading-snug">
              Fires a specified amount of time after the load transitions into this
              status. Use <strong>0 / 0 / 0</strong> to fire immediately on entry.
            </div>
          </div>
          <div className="mt-3">
            <DurationField
              label="Notify After"
              value={form.conditions?.notify_after || emptyDuration()}
              onChange={(v) => setCondition('notify_after', v)}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ConditionField — renders the right input based on field.type
// ──────────────────────────────────────────────────────────────
function ConditionField({ field, value, onChange }) {
  if (field.type === 'duration') {
    return (
      <DurationField
        label={field.label}
        help={field.help}
        value={value || emptyDuration()}
        onChange={onChange}
      />
    );
  }
  if (field.type === 'duration_preset') {
    return (
      <div>
        <Select
          label={field.label}
          placeholder="— Pick —"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          options={(field.options || []).map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
        {field.help && (
          <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            {field.help}
          </div>
        )}
      </div>
    );
  }
  if (field.type === 'status_picker') {
    return (
      <div>
        <Select
          label={field.label}
          placeholder="— Pick a status —"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          options={LOAD_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        />
        {field.help && (
          <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            {field.help}
          </div>
        )}
      </div>
    );
  }
  if (field.type === 'multi_select') {
    const options = resolveOptions(field);
    const selected = Array.isArray(value) ? value : [];
    function toggle(optValue) {
      const next = selected.includes(optValue)
        ? selected.filter((v) => v !== optValue)
        : [...selected, optValue];
      onChange(next);
    }
    return (
      <div>
        <div className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
          {field.label}
        </div>
        {field.help && (
          <div className="mb-2 text-[11px] text-gray-500 dark:text-slate-400">
            {field.help}
          </div>
        )}
        <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 grid grid-cols-2 gap-1">
          {options.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300 cursor-pointer hover:text-gray-900 dark:hover:text-slate-100 px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-800/60"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                  className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                />
                {opt.label}
              </label>
            );
          })}
        </div>
        <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
          {selected.length === 0
            ? 'None selected'
            : `${selected.length} selected`}
        </div>
      </div>
    );
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// DurationField — 3-input (days / hours / minutes) composite
// ──────────────────────────────────────────────────────────────
function DurationField({ label, help, value, onChange }) {
  const v = value && typeof value === 'object' ? value : emptyDuration();
  function set(key, num) {
    const n = Math.max(0, Math.floor(Number(num) || 0));
    onChange({ ...v, [key]: n });
  }
  return (
    <div>
      <div className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
        {label}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberUnit
          value={v.days}
          unit="days"
          onChange={(n) => set('days', n)}
        />
        <NumberUnit
          value={v.hours}
          unit="hours"
          onChange={(n) => set('hours', n)}
        />
        <NumberUnit
          value={v.minutes}
          unit="minutes"
          onChange={(n) => set('minutes', n)}
        />
      </div>
      {help && (
        <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
          {help}
        </div>
      )}
    </div>
  );
}

function NumberUnit({ value, unit, onChange }) {
  return (
    <div className="relative">
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-3 pr-14 py-2 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500 pointer-events-none">
        {unit}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// KindCard — one of the 4 top-level trigger kind selector cards
// ──────────────────────────────────────────────────────────────
function KindCard({ selected, onClick, icon: Icon, title, description }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-xl border-2 transition-all ${
        selected
          ? 'border-blue-400 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-950/30 shadow-sm'
          : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-700'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center ${
            selected
              ? 'bg-blue-100 dark:bg-blue-900/60'
              : 'bg-gray-100 dark:bg-slate-800'
          }`}
        >
          <Icon
            className={`w-4 h-4 ${
              selected
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-slate-400'
            }`}
          />
        </div>
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

function InfoBanner({ text }) {
  return (
    <div className="mt-2 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 px-3 py-2 flex items-start gap-2">
      <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
      <div className="text-xs text-blue-800 dark:text-blue-200 leading-snug">
        {text}
      </div>
    </div>
  );
}

function iconForKind(kind) {
  if (kind === 'field_change') return Edit2;
  if (kind === 'notification') return Bell;
  if (kind === 'event') return CircleDot;
  if (kind === 'status') return Calendar;
  return CircleDot;
}

// ──────────────────────────────────────────────────────────────
// Form initialization + conditions seeding
// ──────────────────────────────────────────────────────────────
function initialForm(initial) {
  if (!initial) {
    return {
      name: '',
      description: '',
      trigger_kind: 'field_change',
      event_name: '',
      conditions: {},
      dedupe_window_seconds: 3600,
      is_active: true,
    };
  }
  return {
    name: initial.name || '',
    description: initial.description || '',
    trigger_kind: initial.trigger_kind || 'field_change',
    event_name: initial.event_name || '',
    conditions: initial.conditions || {},
    dedupe_window_seconds: initial.dedupe_window_seconds ?? 3600,
    is_active: initial.is_active !== false,
  };
}

/**
 * When the user picks a new event_name, seed the conditions object with
 * sensible defaults so every input in the conditionSchema has a value to
 * bind to immediately (avoids uncontrolled-input warnings + cleaner UX).
 */
function seedConditions(kind, eventName) {
  if (!kind || !eventName) return {};

  if (kind === 'field_change') {
    const field = FIELD_CHANGE_TRIGGERS.find((f) => f.key === eventName);
    if (!field) return {};
    const base = { change_type: 'updated' };
    if (field.hasPodValidationGate) {
      base.validation_gate = 'at_upload';
    }
    return base;
  }

  if (kind === 'notification') {
    return {};
  }

  if (kind === 'event') {
    const evt = COMPOSITE_EVENT_TRIGGERS.find((e) => e.key === eventName);
    if (!evt) return {};
    const seeded = {};
    for (const field of evt.conditionSchema.fields) {
      if (field.type === 'duration') {
        seeded[field.key] = emptyDuration();
      } else if (field.type === 'multi_select') {
        seeded[field.key] = [];
      }
      // duration_preset + status_picker stay undefined until user picks one
    }
    return seeded;
  }

  if (kind === 'status') {
    return { notify_after: emptyDuration() };
  }

  return {};
}
