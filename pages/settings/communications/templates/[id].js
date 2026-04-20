import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  RotateCcw,
  Trash2,
  Eye,
  Hash,
  AlertTriangle,
  Shield,
  FileCode,
  Type as TypeIcon,
  Zap,
  Plus,
  Clock,
  Edit3,
  Power,
  X,
  Send,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import Alert from '../../../../components/ui/Alert';
import Modal from '../../../../components/ui/Modal';
import VariablePicker, { insertAtCursor } from '../../../../components/ui/VariablePicker';
import InlineVariablePicker, {
  matchVariables,
  detectAtMention,
} from '../../../../components/ui/InlineVariablePicker';
import TriggerModal from '../../../../components/ui/TriggerModal';
import {
  resolveEmailTemplate,
  buildSampleContext,
  stripHtml,
} from '../../../../lib/email-variable-resolver';
import { validateTemplateBody } from '../../../../lib/email-variables';
import {
  summarizeTrigger,
  DEDUPE_PRESETS,
} from '../../../../lib/email-trigger-events';
import SenderPreview from '../../../../components/settings/communications/SenderPreview';
import { PLATFORM_SENDER_DOMAIN } from '../../../../lib/email-dispatch/constants';
import { resolveFromDisplayName, resolveReplyTo } from '../../../../lib/email-dispatch/dispatcher';

/**
 * Settings → Communications → Email Templates → Editor
 *
 * Handles both "edit existing" (id is a UUID) and "create new" (id === 'new').
 *
 * Layout:
 *   ┌─────────────────────────────┬──────────────┐
 *   │ Name + Description          │              │
 *   │ Subject  [+]                │  Live        │
 *   │ Plain / HTML toggle         │  Preview     │
 *   │ Body textarea  [+]          │  Pane        │
 *   │ Save / Reset / Delete       │              │
 *   └─────────────────────────────┴──────────────┘
 *
 *   The [+] buttons open the VariablePicker anchored to the field and
 *   insert {{token}} at the current cursor position. The preview pane
 *   updates live using resolveEmailTemplate() against a sample context
 *   built from the variable catalog's `sample` fields.
 *
 *   Unknown variables (tokens not in the catalog) are surfaced as a
 *   yellow chip strip above the Save button and block saving.
 */

const BLANK_TEMPLATE = {
  id: null,
  name: '',
  description: '',
  subject: '',
  body_text: '',
  body_html: '',
  body_format: 'plain',
  is_system: false,
  is_active: true,
  format_overrides: {},
  attachment_document_types: [],
  suppress_default_signature: false,
  system_slug: null,
  from_display_name: '',
};

export default function EmailTemplateEditor() {
  const router = useRouter();
  const { id } = router.query;
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);

  const [template, setTemplate] = useState(BLANK_TEMPLATE);
  const [original, setOriginal] = useState(BLANK_TEMPLATE);

  // Variable picker state — { which: 'subject'|'body', anchorRect: DOMRect }
  const [pickerState, setPickerState] = useState(null);
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const subjectButtonRef = useRef(null);
  const bodyButtonRef = useRef(null);

  // @-mention inline autocomplete state
  //   null when inactive
  //   { field: 'subject'|'body', startPos: int, query: string,
  //     activeIndex: int, anchorRect: DOMRect }
  const [atMention, setAtMention] = useState(null);

  // Compute matching variables for the current @-query. Recomputed on
  // every keystroke via the setter below.
  const atMatches = useMemo(
    () => (atMention ? matchVariables(atMention.query) : []),
    [atMention]
  );

  // ── Triggers state (Milestone 3b) ──
  // Triggers live in the email_template_triggers table and are scoped to
  // the current template. They're fetched separately from the template
  // body + loaded lazily after the template id is known.
  const [triggers, setTriggers] = useState([]);
  const [triggersLoading, setTriggersLoading] = useState(false);
  const [triggersError, setTriggersError] = useState(null);
  const [triggerModal, setTriggerModal] = useState(null); // null | { mode: 'new'|'edit', trigger?: obj }
  const [triggerBusyId, setTriggerBusyId] = useState(null);

  // Send Test Email state (Milestone 4a-3)
  const [testSendOpen, setTestSendOpen] = useState(false);

  // Sender preview state — tenant-default config + tenant for live preview
  const [defaultConfig, setDefaultConfig] = useState(null);
  const [previewTenant, setPreviewTenant] = useState(null);

  useEffect(() => {
    // Fetch tenant (for slug + name)
    fetch('/api/tenant/settings')
      .then((r) => (r.ok ? r.json() : { tenant: null }))
      .then((d) => setPreviewTenant(d.tenant || null))
      .catch(() => setPreviewTenant(null));

    // Fetch tenant-default configuration
    fetch('/api/tenant/emails/configurations')
      .then((r) => (r.ok ? r.json() : { configurations: [] }))
      .then((d) => {
        const list = d.configurations || d;
        const def = Array.isArray(list)
          ? list.find((c) => c.is_default) || list[0] || null
          : null;
        setDefaultConfig(def);
      })
      .catch(() => setDefaultConfig(null));
  }, []);

  // Load the template (or stay blank for "new")
  useEffect(() => {
    if (!router.isReady) return;
    if (isNew) {
      setLoading(false);
      setTemplate(BLANK_TEMPLATE);
      setOriginal(BLANK_TEMPLATE);
      return;
    }
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/tenant/emails/templates/${id}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to load template');
        }
        const data = await res.json();
        // AR system templates (invoice_send, rate_con_send) are managed at
        // /settings/ar/configuration — redirect if someone deep-links here.
        if (data.template?.category === 'ar') {
          router.replace('/settings/ar/configuration');
          return;
        }
        setTemplate(data.template);
        setOriginal(data.template);
      } catch (e) {
        setLoadError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [router.isReady, id, isNew]);

  // ── Triggers fetch + CRUD ──
  // Load triggers once the template id is known (skip on new templates
  // — they need to be saved first before they have an id).
  async function loadTriggers() {
    if (isNew || !id || typeof id !== 'string') return;
    setTriggersLoading(true);
    setTriggersError(null);
    try {
      const res = await fetch(`/api/tenant/emails/templates/${id}/triggers`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to load triggers');
      }
      const data = await res.json();
      setTriggers(data.triggers || []);
    } catch (e) {
      setTriggersError(e.message);
    } finally {
      setTriggersLoading(false);
    }
  }

  useEffect(() => {
    if (!router.isReady) return;
    if (isNew) return;
    loadTriggers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, id, isNew]);

  async function handleCreateTrigger(payload) {
    const res = await fetch(`/api/tenant/emails/templates/${id}/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b.error || 'Failed to create trigger');
    }
    const data = await res.json();
    setTriggers((ts) => [...ts, data.trigger]);
    setTriggerModal(null);
  }

  async function handleUpdateTrigger(trigger, payload) {
    const res = await fetch(
      `/api/tenant/emails/templates/${id}/triggers/${trigger.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b.error || 'Failed to update trigger');
    }
    const data = await res.json();
    setTriggers((ts) => ts.map((t) => (t.id === trigger.id ? data.trigger : t)));
    setTriggerModal(null);
  }

  async function handleToggleTrigger(trigger) {
    setTriggerBusyId(trigger.id);
    setTriggersError(null);
    try {
      const payload = {
        name: trigger.name,
        description: trigger.description,
        trigger_kind: trigger.trigger_kind,
        event_name: trigger.event_name,
        poll_anchor: trigger.poll_anchor,
        poll_delay_amount: trigger.poll_delay_amount,
        poll_delay_unit: trigger.poll_delay_unit,
        conditions: trigger.conditions,
        dedupe_window_seconds: trigger.dedupe_window_seconds,
        is_active: !trigger.is_active,
      };
      const res = await fetch(
        `/api/tenant/emails/templates/${id}/triggers/${trigger.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to update');
      }
      const data = await res.json();
      setTriggers((ts) => ts.map((t) => (t.id === trigger.id ? data.trigger : t)));
    } catch (e) {
      setTriggersError(e.message);
    } finally {
      setTriggerBusyId(null);
    }
  }

  async function handleDeleteTrigger(trigger) {
    if (!confirm(`Delete trigger "${trigger.name}"? This cannot be undone.`)) {
      return;
    }
    setTriggerBusyId(trigger.id);
    setTriggersError(null);
    try {
      const res = await fetch(
        `/api/tenant/emails/templates/${id}/triggers/${trigger.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to delete');
      }
      setTriggers((ts) => ts.filter((t) => t.id !== trigger.id));
    } catch (e) {
      setTriggersError(e.message);
    } finally {
      setTriggerBusyId(null);
    }
  }

  // ── Handlers ──
  function handleChange(field, value) {
    setTemplate((t) => ({ ...t, [field]: value }));
  }

  function handleReset() {
    setTemplate(original);
    setSaveError(null);
    setSaveSuccess(null);
  }

  async function handleSave(e) {
    e?.preventDefault?.();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const payload = {
        name: template.name,
        description: template.description,
        subject: template.subject,
        body_text: template.body_text,
        body_html: template.body_html,
        body_format: template.body_format,
        is_active: template.is_active,
        format_overrides: template.format_overrides || {},
        attachment_document_types: template.attachment_document_types || [],
        suppress_default_signature: !!template.suppress_default_signature,
        from_display_name: template.from_display_name || null,
      };

      const url = isNew
        ? '/api/tenant/emails/templates'
        : `/api/tenant/emails/templates/${id}`;
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
        // Redirect to the saved template's editor so future edits land on a
        // stable URL with the real UUID
        router.replace(`/settings/communications/templates/${data.template.id}`);
      } else {
        setTemplate(data.template);
        setOriginal(data.template);
        setSaveSuccess('Template saved.');
      }
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (template.is_system) return;
    if (!confirm(`Delete "${template.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/tenant/emails/templates/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Delete failed');
      }
      router.push('/settings/communications/templates');
    } catch (e) {
      setSaveError(e.message);
      setDeleting(false);
    }
  }

  // ── Variable picker insertion (click-the-# button flow) ──
  function openPicker(which, buttonEl) {
    if (pickerState?.which === which) {
      // Toggle off if already open on this field
      setPickerState(null);
      return;
    }
    const rect = buttonEl?.getBoundingClientRect?.();
    setPickerState({
      which,
      anchorRect: rect,
    });
  }

  function handleVariableInsert(token) {
    if (!pickerState) return;
    if (pickerState.which === 'subject') {
      const updated = insertAtCursor(subjectRef.current, token);
      if (updated !== '') {
        setTemplate((t) => ({ ...t, subject: subjectRef.current.value }));
      }
    } else {
      const field = template.body_format === 'html' ? 'body_html' : 'body_text';
      const updated = insertAtCursor(bodyRef.current, token);
      if (updated !== '') {
        setTemplate((t) => ({ ...t, [field]: bodyRef.current.value }));
      }
    }
  }

  // ── @-mention inline autocomplete flow ──
  //
  // On every keystroke in the subject or body, we re-detect whether the
  // caret is inside an @-mention and update state accordingly. When the
  // user selects a match (via Enter/Tab/click), we replace the @query
  // span with {{variable.path}} and move the caret after the token.

  /**
   * Check the field's current value + caret position and open / close
   * the inline picker accordingly. Called on every onChange.
   */
  function updateAtMention(fieldName, fieldEl) {
    if (!fieldEl) return;
    const value = fieldEl.value || '';
    const caret = fieldEl.selectionStart ?? value.length;
    const detection = detectAtMention(value, caret);

    if (detection.active) {
      // Anchor the picker near the field. For precision we'd measure the
      // caret x/y inside the textarea, but a field-anchored popover is
      // plenty for Phase 1 and doesn't need the mirror-div hack.
      const rect = fieldEl.getBoundingClientRect();
      setAtMention((prev) => ({
        field: fieldName,
        startPos: detection.startPos,
        query: detection.query,
        // Reset active index whenever the query changes, otherwise keep it
        activeIndex:
          prev && prev.field === fieldName && prev.query === detection.query
            ? prev.activeIndex
            : 0,
        anchorRect: rect,
      }));
    } else {
      setAtMention(null);
    }
  }

  /**
   * Replace the @query span with the chosen variable's token and close
   * the picker. Works for both subject (input) and body (textarea).
   */
  function insertAtMention(variable) {
    if (!atMention) return;
    const fieldEl =
      atMention.field === 'subject' ? subjectRef.current : bodyRef.current;
    if (!fieldEl) return;

    const value = fieldEl.value;
    const caret = fieldEl.selectionStart ?? value.length;
    const before = value.slice(0, atMention.startPos);
    const after = value.slice(caret);
    const token = `{{${variable.path}}}`;
    const next = `${before}${token}${after}`;

    // Sync value back to state — for subject, that's template.subject;
    // for body, that's body_text or body_html depending on format.
    if (atMention.field === 'subject') {
      setTemplate((t) => ({ ...t, subject: next }));
    } else {
      const field = template.body_format === 'html' ? 'body_html' : 'body_text';
      setTemplate((t) => ({ ...t, [field]: next }));
    }

    // Position the caret after the inserted token, then clear the
    // at-mention state. We defer the caret move to the next tick so
    // React has a chance to re-render the field's value first.
    const newCaret = atMention.startPos + token.length;
    setTimeout(() => {
      if (fieldEl) {
        fieldEl.setSelectionRange(newCaret, newCaret);
        fieldEl.focus();
      }
    }, 0);

    setAtMention(null);
  }

  /**
   * Keyboard handler for the subject + body fields. When the picker is
   * open, we intercept arrow/enter/tab/escape to drive selection.
   * Otherwise the event propagates normally.
   */
  function handleFieldKeyDown(e) {
    if (!atMention || atMatches.length === 0) {
      // Special case: Escape always clears any stale at-mention even if
      // there are zero matches (the picker's "No matches" state).
      if (atMention && e.key === 'Escape') {
        e.preventDefault();
        setAtMention(null);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setAtMention((m) => ({
          ...m,
          activeIndex: (m.activeIndex + 1) % atMatches.length,
        }));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setAtMention((m) => ({
          ...m,
          activeIndex: (m.activeIndex - 1 + atMatches.length) % atMatches.length,
        }));
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        insertAtMention(atMatches[atMention.activeIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        setAtMention(null);
        break;
      default:
        break;
    }
  }

  // ── Live preview + validation ──
  // Auto-derive the other body variant on the fly for preview. When the
  // user clicks Save the API does the same derivation, so preview stays
  // faithful to the final result.
  const previewResult = useMemo(() => {
    const sampleContext = buildSampleContext();

    const effectiveBodyText =
      template.body_format === 'html'
        ? template.body_text || stripHtml(template.body_html || '')
        : template.body_text || '';
    const effectiveBodyHtml =
      template.body_format === 'plain'
        ? template.body_html ||
          (template.body_text || '')
            .split(/\n{2,}/)
            .map(
              (p) =>
                `<p>${p
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/\n/g, '<br/>')}</p>`
            )
            .join('')
        : template.body_html || '';

    return resolveEmailTemplate({
      subject: template.subject,
      body_html: effectiveBodyHtml,
      body_text: effectiveBodyText,
      context: sampleContext,
      formatPrefs: null, // preview uses defaults; real send uses tenant prefs
      templateOverrides: template.format_overrides,
      strict: false,
    });
  }, [
    template.subject,
    template.body_text,
    template.body_html,
    template.body_format,
    template.format_overrides,
  ]);

  // Validation: find unknown variables across subject + body fields
  const validation = useMemo(() => {
    const combined = `${template.subject || ''}\n${template.body_text || ''}\n${template.body_html || ''}`;
    return validateTemplateBody(combined);
  }, [template.subject, template.body_text, template.body_html]);

  const isDirty = useMemo(() => {
    return JSON.stringify(template) !== JSON.stringify(original);
  }, [template, original]);

  // Guard: if the template id is a real UUID but failed to load, show error
  if (loadError) {
    return (
      <SettingsLayout title="Email Template">
        <div className="max-w-4xl">
          <Link
            href="/settings/communications/templates"
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to templates
          </Link>
          <Alert type="error" message={loadError} />
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout title={isNew ? 'New Email Template' : template.name || 'Email Template'}>
      <div className="max-w-6xl">
        {/* Back link */}
        <Link
          href="/settings/communications/templates"
          className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to templates
        </Link>

        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            {template.is_system ? (
              <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            ) : (
              <TypeIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                {isNew ? 'New Template' : template.name || 'Untitled'}
              </h1>
              {template.is_system && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 px-2 py-0.5 rounded">
                  System Template
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              {template.is_system
                ? 'System templates can be renamed and edited. The canonical slug and "system" status cannot be changed.'
                : 'Use the variable picker to insert tokens. The preview panel shows how the rendered email will look against a sample load.'}
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
          <form
            onSubmit={handleSave}
            className="grid grid-cols-1 lg:grid-cols-[1fr,420px] gap-6"
          >
            {/* ── Left column: editor ── */}
            <div className="space-y-5 min-w-0">
              {/* Metadata card */}
              <Section title="Details">
                <Input
                  label="Name *"
                  value={template.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="e.g. POD Delivered — ABC Customer"
                  required
                />
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                    Description
                  </label>
                  <textarea
                    value={template.description || ''}
                    onChange={(e) => handleChange('description', e.target.value)}
                    placeholder="Internal notes about when this template is used"
                    rows={2}
                    className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                {template.is_system && template.system_slug && (
                  <div className="mt-3 text-xs text-gray-500 dark:text-slate-400">
                    System slug:{' '}
                    <code className="font-mono text-[11px] bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                      {template.system_slug}
                    </code>
                  </div>
                )}
              </Section>

              {/* Subject card */}
              <Section title="Subject">
                <div className="relative">
                  <input
                    ref={subjectRef}
                    type="text"
                    value={template.subject || ''}
                    onChange={(e) => {
                      handleChange('subject', e.target.value);
                      updateAtMention('subject', e.target);
                    }}
                    onKeyDown={handleFieldKeyDown}
                    onKeyUp={(e) => updateAtMention('subject', e.target)}
                    onClick={(e) => updateAtMention('subject', e.target)}
                    onBlur={() => {
                      // Give the picker a tick to process click-selects
                      // before we clear state on blur.
                      setTimeout(() => {
                        if (atMention?.field === 'subject') setAtMention(null);
                      }, 150);
                    }}
                    placeholder="e.g. POD — Container @container (type @ for variables)"
                    className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 pr-10 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                    required
                  />
                  <button
                    ref={subjectButtonRef}
                    type="button"
                    data-variable-picker-trigger="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPicker('subject', subjectButtonRef.current);
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-500 dark:hover:text-blue-400 dark:hover:bg-blue-950/40"
                    title="Insert variable (or type @ inline)"
                  >
                    <Hash className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                  Type <code className="font-mono bg-gray-100 dark:bg-slate-800 px-1 py-0.5 rounded">@</code> inline to open the variable picker, or click the <Hash className="inline w-3 h-3" /> button.
                </div>
              </Section>

              {/* Sender Preview + Display Name Override */}
              {defaultConfig && previewTenant && (
                <Section title="Sender Identity">
                  <div className="space-y-4">
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
                        Sender Preview
                      </h3>
                      {(() => {
                        const replyToResolved = resolveReplyTo(defaultConfig, previewTenant);
                        return (
                          <SenderPreview
                            fromDisplayName={resolveFromDisplayName(template, defaultConfig, previewTenant)}
                            fromAddress={`${previewTenant.slug}@${PLATFORM_SENDER_DOMAIN}`}
                            replyToEmail={replyToResolved?.email || null}
                            replyToName={replyToResolved?.name || null}
                          />
                        );
                      })()}
                      <div className="mt-2 text-xs">
                        <Link
                          href={`/settings/communications/configurations/${defaultConfig.id}`}
                          className="text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Change sender identity →
                        </Link>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="template-from-display-name"
                        className="block text-sm font-medium text-gray-700 dark:text-slate-300"
                      >
                        Display Name Override (optional)
                      </label>
                      <input
                        id="template-from-display-name"
                        type="text"
                        value={template.from_display_name || ''}
                        maxLength={100}
                        onChange={(e) =>
                          setTemplate((t) => ({ ...t, from_display_name: e.target.value }))
                        }
                        placeholder={defaultConfig.from_display_name || previewTenant.name || ''}
                        className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        Leave blank to use your account-wide Display Name. Use this if this
                        specific template should appear as a different identity (e.g., &quot;Acme
                        Billing Department&quot; for invoices).
                      </p>
                    </div>
                  </div>
                </Section>
              )}

              {/* Body card */}
              <Section
                title="Body"
                headerRight={
                  <div className="flex items-center gap-1 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-0.5">
                    <button
                      type="button"
                      onClick={() => handleChange('body_format', 'plain')}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                        template.body_format === 'plain'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <TypeIcon className="w-3 h-3" />
                      Plain
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChange('body_format', 'html')}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                        template.body_format === 'html'
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <FileCode className="w-3 h-3" />
                      HTML
                    </button>
                  </div>
                }
              >
                <div className="relative">
                  <textarea
                    ref={bodyRef}
                    value={
                      template.body_format === 'html'
                        ? template.body_html || ''
                        : template.body_text || ''
                    }
                    onChange={(e) => {
                      const field =
                        template.body_format === 'html' ? 'body_html' : 'body_text';
                      handleChange(field, e.target.value);
                      updateAtMention('body', e.target);
                    }}
                    onKeyDown={handleFieldKeyDown}
                    onKeyUp={(e) => updateAtMention('body', e.target)}
                    onClick={(e) => updateAtMention('body', e.target)}
                    onBlur={() => {
                      setTimeout(() => {
                        if (atMention?.field === 'body') setAtMention(null);
                      }, 150);
                    }}
                    placeholder={
                      template.body_format === 'html'
                        ? '<p>Hi @customer,</p>\n<p>Your container has been delivered.</p>\n\n(Type @ for variables)'
                        : 'Hi @customer,\n\nYour container has been delivered.\n\nThank you,\n@tenant\n\n(Type @ to open the variable picker)'
                    }
                    rows={16}
                    className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono leading-relaxed"
                    required
                  />
                  <button
                    ref={bodyButtonRef}
                    type="button"
                    data-variable-picker-trigger="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPicker('body', bodyButtonRef.current);
                    }}
                    className="absolute right-2 top-2 p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-500 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 bg-white/90 dark:bg-slate-950/90"
                    title="Insert variable (or type @ inline)"
                  >
                    <Hash className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                  {template.body_format === 'html' ? (
                    <>
                      <strong className="text-gray-700 dark:text-slate-200">HTML mode:</strong>{' '}
                      Write raw HTML for styled emails. Plain-text version is auto-derived. Type <code className="font-mono bg-gray-100 dark:bg-slate-800 px-1 py-0.5 rounded">@</code> for variables.
                    </>
                  ) : (
                    <>
                      <strong className="text-gray-700 dark:text-slate-200">Plain mode:</strong>{' '}
                      Just type. Blank lines become paragraphs in the sent email. HTML version is auto-derived on save. Type <code className="font-mono bg-gray-100 dark:bg-slate-800 px-1 py-0.5 rounded">@</code> for variables.
                    </>
                  )}
                </div>
              </Section>

              {/* Validation / unknown variables */}
              {!validation.valid && (
                <div className="rounded-xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                        {validation.unknownVariables.length} unknown variable
                        {validation.unknownVariables.length === 1 ? '' : 's'}
                      </div>
                      <div className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                        The following tokens don&apos;t exist in the catalog and will render
                        literally. Fix or remove them before saving:
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {validation.unknownVariables.map((v) => (
                          <code
                            key={v}
                            className="text-[11px] font-mono bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-800"
                          >
                            {`{{${v}}}`}
                          </code>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Triggers section — only visible on existing (saved) templates.
                  New templates need to be saved first so they have an id. */}
              {!isNew && (
                <Section
                  title="Triggers"
                  headerRight={
                    <button
                      type="button"
                      onClick={() => setTriggerModal({ mode: 'new' })}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Trigger
                    </button>
                  }
                >
                  <p className="text-xs text-gray-500 dark:text-slate-400 -mt-3 mb-4">
                    Decide when this template automatically fires. Each trigger is
                    either an <strong>evented</strong> rule (fires on a domain event
                    like document upload or driver arrival) or a <strong>polled</strong>{' '}
                    rule (fires N time units before/after a date on the load). A
                    template can have multiple triggers, and leaving the list empty
                    means the template only fires via manual send.
                  </p>

                  {triggersError && (
                    <Alert type="error" message={triggersError} className="mb-3" />
                  )}

                  {triggersLoading ? (
                    <div className="py-6 text-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto" />
                    </div>
                  ) : triggers.length === 0 ? (
                    <div className="py-10 text-center rounded-lg border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40">
                      <Zap className="w-8 h-8 mx-auto text-gray-400 dark:text-slate-600 mb-2" />
                      <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">
                        No triggers yet
                      </div>
                      <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                        Click <strong>Add Trigger</strong> to wire this template
                        to an event or polled schedule.
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-2">
                        Without a trigger, this template only fires via manual send.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {triggers.map((trigger) => (
                        <TriggerRow
                          key={trigger.id}
                          trigger={trigger}
                          busy={triggerBusyId === trigger.id}
                          onEdit={() =>
                            setTriggerModal({ mode: 'edit', trigger })
                          }
                          onToggle={() => handleToggleTrigger(trigger)}
                          onDelete={() => handleDeleteTrigger(trigger)}
                        />
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* Save bar */}
              <div className="sticky bottom-0 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 bg-white/95 dark:bg-slate-950/95 border-t border-gray-200 dark:border-slate-800 backdrop-blur flex items-center justify-between gap-3">
                <div className="text-xs text-gray-500 dark:text-slate-400">
                  {isNew
                    ? 'Unsaved — click Save to create'
                    : isDirty
                    ? 'Unsaved changes'
                    : 'No changes'}
                </div>
                <div className="flex items-center gap-2">
                  {!isNew && (
                    <button
                      type="button"
                      onClick={() => setTestSendOpen(true)}
                      disabled={saving || deleting}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900/60 transition-colors disabled:opacity-40"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Send Test
                    </button>
                  )}
                  {!isNew && !template.is_system && (
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
                    disabled={!validation.valid || (!isNew && !isDirty)}
                  >
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    {isNew ? 'Create Template' : 'Save'}
                  </Button>
                </div>
              </div>
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
                  Rendered against a sample load. Variables show their sample values from the catalog.
                </div>

                {/* Subject preview */}
                <div className="px-4 py-3 border-b border-blue-200/60 dark:border-blue-900/40 bg-white/40 dark:bg-slate-900/40">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300 mb-1">
                    Subject
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 break-words">
                    {previewResult.subject || (
                      <span className="italic text-gray-400 dark:text-slate-500">
                        (empty)
                      </span>
                    )}
                  </div>
                </div>

                {/* Body preview */}
                <div className="p-4 bg-white dark:bg-slate-950 max-h-[460px] overflow-y-auto">
                  {template.body_format === 'html' ? (
                    <div
                      className="text-sm text-gray-900 dark:text-slate-100 prose prose-sm dark:prose-invert max-w-none break-words"
                      dangerouslySetInnerHTML={{ __html: previewResult.html || '' }}
                    />
                  ) : (
                    <pre className="text-sm text-gray-900 dark:text-slate-100 whitespace-pre-wrap break-words font-sans">
                      {previewResult.text || ''}
                    </pre>
                  )}
                </div>

                {previewResult.missing?.length > 0 && (
                  <div className="px-4 py-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-900/60">
                    {previewResult.missing.length} variable
                    {previewResult.missing.length === 1 ? '' : 's'} empty in sample data — will show placeholder at send time
                  </div>
                )}
              </div>
            </aside>
          </form>
        )}

        {/* Click-the-# button variable picker overlay */}
        {pickerState && (
          <VariablePicker
            open={!!pickerState}
            onClose={() => setPickerState(null)}
            onInsert={handleVariableInsert}
            anchorRect={pickerState.anchorRect}
          />
        )}

        {/* Inline @-mention autocomplete */}
        {atMention && (
          <InlineVariablePicker
            query={atMention.query}
            matches={atMatches}
            activeIndex={atMention.activeIndex}
            anchorRect={atMention.anchorRect}
            onHover={(idx) =>
              setAtMention((m) => (m ? { ...m, activeIndex: idx } : m))
            }
            onSelect={(variable) => insertAtMention(variable)}
            onClose={() => setAtMention(null)}
          />
        )}

        {/* Trigger create/edit modal */}
        {triggerModal && (
          <TriggerModal
            initial={triggerModal.mode === 'edit' ? triggerModal.trigger : null}
            onClose={() => setTriggerModal(null)}
            onSave={async (payload) => {
              if (triggerModal.mode === 'edit') {
                await handleUpdateTrigger(triggerModal.trigger, payload);
              } else {
                await handleCreateTrigger(payload);
              }
            }}
          />
        )}

        {/* Send Test Email modal (Milestone 4a-3) */}
        {testSendOpen && !isNew && (
          <SendTestModal
            templateId={template.id}
            templateName={template.name}
            onClose={() => setTestSendOpen(false)}
          />
        )}
      </div>
    </SettingsLayout>
  );
}

function Section({ title, headerRight, children }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
        {headerRight}
      </div>
      {children}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
// TriggerRow — one row in the Triggers section of the template editor
// ──────────────────────────────────────────────────────────────
function TriggerRow({ trigger, busy, onEdit, onToggle, onDelete }) {
  const summary = summarizeTrigger(trigger);
  const dedupe = DEDUPE_PRESETS.find(
    (p) => p.seconds === trigger.dedupe_window_seconds
  );
  const isEvented = trigger.trigger_kind === 'evented';

  return (
    <div
      className={`group rounded-xl border transition-colors ${
        trigger.is_active
          ? 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800'
          : 'border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40 opacity-80'
      }`}
    >
      <div className="flex items-start gap-4 p-4">
        <div className="shrink-0 pt-0.5">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              isEvented
                ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60'
                : 'bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/60'
            }`}
          >
            {isEvented ? (
              <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            ) : (
              <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <button
              type="button"
              onClick={onEdit}
              className="text-sm font-semibold text-gray-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-400 truncate"
            >
              {trigger.name}
            </button>
            <span
              className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${
                isEvented
                  ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-900/60'
                  : 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-900/60'
              }`}
            >
              {isEvented ? 'Evented' : 'Polled'}
            </span>
            {!trigger.is_active && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 px-1.5 py-0.5 rounded">
                Inactive
              </span>
            )}
          </div>
          {trigger.description && (
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1 line-clamp-1">
              {trigger.description}
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-slate-300 flex-wrap">
            <span className="text-gray-500 dark:text-slate-400">{summary}</span>
            <span className="text-[10px] text-gray-400 dark:text-slate-500">
              Dedupe: {dedupe?.label || `${trigger.dedupe_window_seconds}s`}
            </span>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-500 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
            title="Edit"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
              trigger.is_active
                ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800'
            }`}
            title={trigger.is_active ? 'Deactivate' : 'Activate'}
          >
            <Power className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-500 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// SendTestModal — sends a real test email via SendGrid
// ──────────────────────────────────────────────────────────────
function SendTestModal({ templateId, templateName, onClose }) {
  const [toAddress, setToAddress] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { ok, subject?, error?, message_id? }
  const [error, setError] = useState(null);

  async function handleSend(e) {
    e.preventDefault();
    if (!toAddress.trim() || !toAddress.includes('@')) {
      setError('Enter a valid email address');
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/tenant/emails/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: templateId,
          to_address: toAddress.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Send failed');
      }
      setResult(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Send Test Email" size="md">
      <div className="space-y-4">
        <div className="text-xs text-gray-500 dark:text-slate-400">
          Send a real email using <strong className="text-gray-700 dark:text-slate-200">{templateName}</strong> rendered against your most recent load. The email will arrive via SendGrid within seconds.
        </div>

        {error && <Alert type="error" message={error} />}

        {result?.ok ? (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                  Email sent!
                </div>
                <div className="mt-2 text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
                  <div>
                    <strong>To:</strong> {result.rendered?.to_address}
                  </div>
                  <div>
                    <strong>From:</strong> {result.rendered?.from_address}
                    {result.rendered?.from_name && ` (${result.rendered.from_name})`}
                  </div>
                  <div>
                    <strong>Subject:</strong> {result.rendered?.subject}
                  </div>
                  {result.rendered?.missing_variables?.length > 0 && (
                    <div className="mt-2 text-amber-700 dark:text-amber-300">
                      <strong>Note:</strong> {result.rendered.missing_variables.length} variable
                      {result.rendered.missing_variables.length === 1 ? '' : 's'} had no data and used the placeholder: {result.rendered.missing_variables.join(', ')}
                    </div>
                  )}
                </div>
                <div className="mt-3 text-[10px] text-emerald-700 dark:text-emerald-300 font-mono">
                  Message ID: {result.provider_message_id}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSend} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                Send to <span className="text-rose-500">*</span>
              </label>
              <input
                type="email"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                The email will be rendered using your most recent load as context data.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={sending}>
                <Send className="w-3.5 h-3.5 mr-1.5" />
                Send Test Email
              </Button>
            </div>
          </form>
        )}

        {result?.ok && (
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-slate-800">
            <Button variant="secondary" onClick={() => { setResult(null); setToAddress(''); }}>
              Send Another
            </Button>
            <Button onClick={onClose}>
              Done
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
