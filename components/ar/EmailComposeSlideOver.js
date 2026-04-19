import { useEffect, useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

// ---------------------------------------------------------------------------
// RecipientInput — chip-based email address input
// ---------------------------------------------------------------------------
function RecipientInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState('');

  function commit(text) {
    const parts = text
      .split(/[,\n;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange([...value, ...parts]);
    setDraft('');
  }

  function onKey(e) {
    if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap gap-1 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded px-2 py-1.5 min-h-[36px]">
      {value.map((addr, i) => {
        const valid = /^\S+@\S+\.\S+$/.test(addr);
        return (
          <span
            key={i}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
              valid
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
            }`}
          >
            {addr}
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="hover:opacity-80"
            >
              ×
            </button>
          </span>
        );
      })}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,;\n]/.test(text)) {
            e.preventDefault();
            commit(text);
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-gray-900 dark:text-slate-100"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmailComposeSlideOver
// ---------------------------------------------------------------------------
export default function EmailComposeSlideOver({
  // --- existing single-send props ---
  open,
  onClose,
  docType,
  contextId,
  onSent,
  onSkipped,
  // --- bulk-mode props (Task 9 / BulkEmailQueue) ---
  isOpen,             // alias for `open`; whichever is provided takes precedence
  initialTo,
  initialCc,
  initialBcc,
  initialSubject,
  initialBodyText,
  initialBodyHtml,
  bodyFormat: initialBodyFormat,  // prop name from BulkEmailQueue
  attachments,        // Array<{filename, preview_url, invoice_id}> — multi-attach list
  hideSendButton,
  onSave,
  saveLabel = 'Save',
  title: titleProp,   // overrides derived title when provided
}) {
  // ---- bulk-mode detection -------------------------------------------------
  // Detected when any bulk-specific prop is present. When true:
  //   • on-mount fetch is skipped (queue pre-populates initial* props)
  //   • footer renders Save instead of Send / Skip
  const isBulk = Boolean(initialTo || initialSubject || hideSendButton || onSave);

  // ---- visible gate (supports both `open` and `isOpen`) -------------------
  const visible = isOpen !== undefined ? isOpen : open;

  // ---- refs ----------------------------------------------------------------
  const drawerRef = useRef(null);

  // ---- async state ---------------------------------------------------------
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [sending, setSending] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [sendError, setSendError] = useState(null);

  // ---- form fields ---------------------------------------------------------
  const [to, setTo] = useState([]);
  const [cc, setCc] = useState([]);
  const [bcc, setBcc] = useState([]);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [bodyFormat, setBodyFormat] = useState('plain');
  const [attachment, setAttachment] = useState(null);
  const [recipientsSource, setRecipientsSource] = useState(null);

  // ---- UX flags ------------------------------------------------------------
  const [ccVisible, setCcVisible] = useState(false);
  const [bccVisible, setBccVisible] = useState(false);
  const [dirty, setDirty] = useState(false);

  // track whether the initial fetch has populated fields yet
  const initialLoadDoneRef = useRef(false);

  // ---- derived -------------------------------------------------------------
  const busy = sending || skipping;
  const hasValidTo = to.some((addr) => /^\S+@\S+\.\S+$/.test(addr));
  const canSend = hasValidTo && subject.trim() !== '' && !busy;

  // ---- field updater that marks dirty only after first load ----------------
  function updateField(setter) {
    return (val) => {
      setter(val);
      if (initialLoadDoneRef.current) setDirty(true);
    };
  }

  // ---- seed state from initial* props in bulk mode ------------------------
  // Runs whenever `visible` flips to true in bulk mode (each row in the queue).
  useEffect(() => {
    if (!isBulk || !visible) return;
    setTo(initialTo ?? []);
    setCc(initialCc ?? []);
    setBcc(initialBcc ?? []);
    setSubject(initialSubject ?? '');
    setBodyText(initialBodyText ?? '');
    setBodyHtml(initialBodyHtml ?? '');
    setBodyFormat(initialBodyFormat ?? 'plain');
    setCcVisible((initialCc ?? []).length > 0);
    setBccVisible((initialBcc ?? []).length > 0);
    setDirty(false);
    initialLoadDoneRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBulk, visible]);

  // ---- fetch defaults (single-send only) -----------------------------------
  useEffect(() => {
    if (isBulk) return undefined;               // bulk mode: skip fetch
    if (!visible || !contextId || !docType) return undefined;

    const url =
      docType === 'invoice'
        ? `/api/tenant/ar/invoices/${contextId}/email-defaults`
        : `/api/tenant/ar/charge-sets/${contextId}/email-defaults`;

    let cancelled = false;

    setLoading(true);
    setFetchError(null);
    setSendError(null);
    setDirty(false);
    initialLoadDoneRef.current = false;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setTo(data.to ?? []);
        setCc(data.cc ?? []);
        setBcc(data.bcc ?? []);
        setSubject(data.subject ?? '');
        setBodyText(data.body_text ?? '');
        setBodyHtml(data.body_html ?? '');
        setBodyFormat(data.body_format ?? 'plain');
        setAttachment(data.attachment ?? null);
        setRecipientsSource(data.recipients_source ?? null);
        setCcVisible((data.cc ?? []).length > 0);
        setBccVisible((data.bcc ?? []).length > 0);
        setDirty(false);
        initialLoadDoneRef.current = true;
      })
      .catch((err) => { if (!cancelled) setFetchError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [isBulk, visible, contextId, docType]);

  // ---- ESC key listener ----------------------------------------------------
  useEffect(() => {
    if (!visible) return;
    function onKeyDown(e) {
      if (e.key === 'Escape' && !busy) attemptClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, busy, dirty]);

  // ---- Focus trap ----------------------------------------------------------
  // Confines Tab / Shift+Tab cycling to elements inside the drawer while open,
  // and sets initial focus to the first focusable element after the drawer
  // mounts. Both are hard requirements for modal-dialog accessibility
  // (WCAG 2.4.3 focus order + WCAG 2.4.11 focus visible).
  useEffect(() => {
    if (!visible) return undefined;
    const drawer = drawerRef.current;
    if (!drawer) return undefined;

    const FOCUSABLE_SELECTOR = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    // Initial focus — wait a tick so React has committed the DOM
    const initialFocusId = requestAnimationFrame(() => {
      const focusables = drawer.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) focusables[0].focus();
    });

    function onKeyDown(e) {
      if (e.key !== 'Tab') return;
      const focusables = Array.from(drawer.querySelectorAll(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    drawer.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(initialFocusId);
      drawer.removeEventListener('keydown', onKeyDown);
    };
  }, [visible]);

  // ---- close with dirty guard ---------------------------------------------
  const attemptClose = useCallback(() => {
    if (busy) return;
    if (dirty) {
      if (!window.confirm('Discard changes?')) return;
    }
    onClose();
  }, [busy, dirty, onClose]);

  // ---- send ---------------------------------------------------------------
  async function doSend() {
    if (!canSend) return;
    setSending(true);
    setSendError(null);

    const url =
      docType === 'invoice'
        ? `/api/tenant/ar/invoices/${contextId}/send-email`
        : `/api/tenant/ar/charge-sets/${contextId}/send-rate-con-email`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, cc, bcc, subject, body_text: bodyText, body_html: bodyHtml, body_format: bodyFormat }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDirty(false);
      onSent?.(data);
      onClose();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  // ---- skip (invoice only) ------------------------------------------------
  async function doSkip() {
    if (busy) return;
    setSkipping(true);
    setSendError(null);

    try {
      const res = await fetch(`/api/tenant/ar/invoices/${contextId}/skip-email`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDirty(false);
      onSkipped?.(data);
      onClose();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSkipping(false);
    }
  }

  // ---- do not render when closed ------------------------------------------
  if (!visible) return null;

  const isInvoice = docType === 'invoice';
  // `titleProp` (bulk mode) overrides the derived title
  const headerTitle = titleProp || (isInvoice ? 'Send Invoice' : 'Send Rate Confirmation');

  return (
    <div className="fixed inset-0 z-[200] flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/40 dark:bg-black/60"
        onClick={busy ? undefined : attemptClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-compose-title"
        className="flex flex-col w-full max-w-[540px] h-full bg-white dark:bg-slate-800 shadow-2xl overflow-hidden"
      >
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700 flex-shrink-0">
          <h2 id="email-compose-title" className="text-base font-semibold text-gray-900 dark:text-slate-100">{headerTitle}</h2>
          <button
            type="button"
            onClick={attemptClose}
            disabled={busy}
            className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* ---- Scrollable body ---- */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Loading */}
          {loading && (
            <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>
          )}

          {/* Fetch error */}
          {!loading && fetchError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              Failed to load: {fetchError}
            </p>
          )}

          {/* Form — only when loaded successfully */}
          {!loading && !fetchError && (
            <>
              {/* Send error banner */}
              {sendError && (
                <div className="rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3">
                  <p className="text-sm text-red-700 dark:text-red-300">{sendError}</p>
                </div>
              )}

              {/* recipients_source banners */}
              {recipientsSource === 'none' && (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-4 py-3">
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    No billing email on file for this customer. Type a recipient to send, or skip to save as draft.
                  </p>
                </div>
              )}
              {recipientsSource === 'customer.billing_email' && (
                <div className="rounded-md bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600 px-4 py-3">
                  <p className="text-sm text-gray-600 dark:text-slate-400">
                    Using fallback billing email. Add {isInvoice ? 'invoice' : 'rate-confirmation'}-specific recipients in customer settings.
                  </p>
                </div>
              )}

              {/* To */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  To <span className="text-red-500">*</span>
                </label>
                <RecipientInput
                  value={to}
                  onChange={updateField(setTo)}
                  placeholder="recipient@example.com"
                />
              </div>

              {/* CC */}
              {ccVisible ? (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">CC</label>
                  <RecipientInput
                    value={cc}
                    onChange={updateField(setCc)}
                    placeholder="cc@example.com"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCcVisible(true)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  + Add CC
                </button>
              )}

              {/* BCC */}
              {bccVisible ? (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">BCC</label>
                  <RecipientInput
                    value={bcc}
                    onChange={updateField(setBcc)}
                    placeholder="bcc@example.com"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setBccVisible(true)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  + Add BCC
                </button>
              )}

              {/* Subject */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => updateField(setSubject)(e.target.value)}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 py-1.5 text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400"
                  placeholder="Email subject"
                />
              </div>

              {/* Body format toggle + textarea */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-700 dark:text-slate-300">Body</label>
                  <div className="flex gap-1">
                    {['plain', 'html'].map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => updateField(setBodyFormat)(fmt)}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          bodyFormat === fmt
                            ? 'bg-blue-600 dark:bg-blue-700 text-white'
                            : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                        }`}
                      >
                        {fmt === 'plain' ? 'Plain' : 'HTML'}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  rows={10}
                  value={bodyFormat === 'plain' ? bodyText : bodyHtml}
                  onChange={(e) => {
                    if (bodyFormat === 'plain') {
                      updateField(setBodyText)(e.target.value);
                    } else {
                      updateField(setBodyHtml)(e.target.value);
                    }
                  }}
                  className="w-full border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 resize-y font-mono"
                  placeholder={bodyFormat === 'plain' ? 'Email body…' : '<p>Email body HTML…</p>'}
                />
              </div>

              {/* Attachment(s) */}
              {/* Bulk mode: multi-attachment read-only list (array with > 1 item) */}
              {attachments && attachments.length > 1 ? (
                <div className="rounded border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/50 px-3 py-2 space-y-1">
                  <p className="text-xs font-medium text-gray-700 dark:text-slate-300">
                    Attachments ({attachments.length})
                  </p>
                  {attachments.map((att, i) => (
                    <div key={att.invoice_id ?? i} className="flex items-center gap-2">
                      <span className="text-gray-500 dark:text-slate-400 text-sm">📎</span>
                      <span className="text-sm text-gray-800 dark:text-slate-200 flex-1 truncate">{att.filename}</span>
                      {att.preview_url && (
                        <a
                          href={att.preview_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
                        >
                          Preview ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                /* Single-send: existing single attachment chip (unchanged) */
                attachment && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/50">
                    <span className="text-gray-500 dark:text-slate-400 text-sm">📎</span>
                    <span className="text-sm text-gray-800 dark:text-slate-200 flex-1 truncate">{attachment.filename}</span>
                    <a
                      href={attachment.preview_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
                    >
                      Preview ↗
                    </a>
                  </div>
                )
              )}
            </>
          )}
        </div>

        {/* ---- Sticky footer ---- */}
        {!loading && !fetchError && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-200 dark:border-slate-700 flex-shrink-0 bg-white dark:bg-slate-800">
            {hideSendButton ? (
              /* ---- Bulk mode footer: Cancel + Save ---- */
              <>
                <button
                  type="button"
                  onClick={attemptClose}
                  disabled={busy}
                  className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onSave?.({ to, cc, bcc, subject, body_text: bodyText, body_html: bodyHtml })}
                  disabled={!canSend}
                  className="px-5 py-2 text-sm font-medium rounded bg-blue-600 dark:bg-blue-700 text-white hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saveLabel}
                </button>
              </>
            ) : (
              /* ---- Single-send footer: Skip/Cancel + Send (unchanged) ---- */
              <>
                {/* Left action: Skip (invoice) or Cancel (rate-con) */}
                {isInvoice ? (
                  <button
                    type="button"
                    onClick={doSkip}
                    disabled={busy}
                    className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-40 transition-colors"
                  >
                    {skipping ? 'Skipping…' : 'Skip'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={attemptClose}
                    disabled={busy}
                    className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-40 transition-colors"
                  >
                    Cancel
                  </button>
                )}

                {/* Right: Send */}
                <button
                  type="button"
                  onClick={doSend}
                  disabled={!canSend}
                  className="px-5 py-2 text-sm font-medium rounded bg-blue-600 dark:bg-blue-700 text-white hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
