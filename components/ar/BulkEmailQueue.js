import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Mail, AlertCircle, Check, Edit2 } from 'lucide-react';
import { useBulkEmailQueue } from './useBulkEmailQueue';
import EmailComposeSlideOver from './EmailComposeSlideOver'; // lives in components/ar/, not components/ui/

function formatCents(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function StatusPill({ status }) {
  const map = {
    pending:    { cls: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400', label: 'Loading…', icon: RefreshCw, spin: true },
    ready:      { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', label: 'Ready', icon: Check },
    needs_edit: { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', label: 'Needs edit', icon: AlertCircle },
    sending:    { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300', label: 'Sending…', icon: RefreshCw, spin: true },
    sent:       { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', label: 'Sent', icon: Check },
    failed:     { cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300', label: 'Failed', icon: AlertCircle },
  };
  const m = map[status] ?? map.pending;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${m.cls}`}>
      <Icon className={`w-3 h-3 ${m.spin ? 'animate-spin' : ''}`} />
      {m.label}
    </span>
  );
}

export default function BulkEmailQueue({ groups, groupingKind, onClose, onAllSent }) {
  const {
    rows, updateRow, sendReady, retryFailed,
    readyCount, failedCount, sentCount, needsEditCount, allSent,
  } = useBulkEmailQueue(groups, groupingKind);

  const [editingKey, setEditingKey] = useState(null);
  const editingRow = editingKey ? rows.find((r) => r.groupKey === editingKey) : null;

  // Hybrid close: auto-close on all-green after a 1s beat
  useEffect(() => {
    if (!allSent) return;
    const t = setTimeout(() => {
      onAllSent?.();
    }, 1000);
    return () => clearTimeout(t);
  }, [allSent, onAllSent]);

  const totalCents = rows.reduce((a, r) => a + (r.group.total_cents || 0), 0);

  // Send button logic
  let sendLabel, sendHandler, sendDisabled;
  if (failedCount > 0 && readyCount === 0) {
    sendLabel = `Retry ${failedCount} Failed`;
    sendHandler = retryFailed;
    sendDisabled = false;
  } else if (readyCount > 0) {
    sendLabel = `Send ${readyCount} Ready`;
    sendHandler = sendReady;
    sendDisabled = false;
  } else {
    sendLabel = sentCount === rows.length ? 'All sent' : 'Nothing to send';
    sendHandler = () => {};
    sendDisabled = true;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-slate-950/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div>
            <div className="text-base font-semibold text-gray-900 dark:text-slate-100">
              {rows.length} email{rows.length !== 1 ? 's' : ''} queued · {formatCents(totalCents)}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Grouped by {groupingKind} · {readyCount} ready
              {needsEditCount > 0 && ` · ${needsEditCount} need attention`}
              {failedCount > 0 && ` · ${failedCount} failed`}
              {sentCount > 0 && ` · ${sentCount} sent`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={sendHandler}
              disabled={sendDisabled}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              <Mail className="w-3.5 h-3.5" />
              {sendLabel}
            </button>
            <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-800">
          {rows.map((r) => {
            const isSent = r.status === 'sent';
            const isFailed = r.status === 'failed';
            return (
              <div
                key={r.groupKey}
                className={`px-5 py-3 flex items-center justify-between text-sm ${
                  isSent ? 'opacity-60'
                  : isFailed ? 'bg-red-50 dark:bg-red-950/20 border-l-4 border-red-400 dark:border-red-800'
                  : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900 dark:text-slate-100 font-medium truncate">{r.group.label}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 truncate">
                    {r.group.invoice_ids.length} invoice{r.group.invoice_ids.length !== 1 ? 's' : ''} · {formatCents(r.group.total_cents)}
                    {Array.isArray(r.to) && r.to.length > 0 ? ` · To: ${r.to.join(', ')}` : ' · (no recipient)'}
                  </div>
                  {r.error && (
                    <div className="text-xs text-red-600 dark:text-red-400 mt-1 truncate">Error: {r.error}</div>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-3">
                  <StatusPill status={r.status} />
                  {!isSent && (
                    <button
                      onClick={() => setEditingKey(r.groupKey)}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 inline-flex items-center gap-0.5"
                    >
                      <Edit2 className="w-3 h-3" /> Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700">
            Close
          </button>
        </div>
      </div>

      {/* Edit slide-over — Task 10 adds the props below to EmailComposeSlideOver.
          Current slide-over uses `open` prop; Task 10 will add `isOpen` alias +
          initialTo/initialSubject/initialBodyText/initialBodyHtml/hideSendButton/onSave/saveLabel/title.
          Passing them here is safe — React ignores unrecognized props on function components
          (they land as undefined in the destructure, not a runtime error). */}
      {editingRow && (
        <EmailComposeSlideOver
          isOpen={true}
          onClose={() => setEditingKey(null)}
          initialTo={editingRow.to}
          initialCc={editingRow.cc}
          initialBcc={editingRow.bcc}
          initialSubject={editingRow.subject}
          initialBodyText={editingRow.body_text}
          initialBodyHtml={editingRow.body_html}
          bodyFormat={editingRow.body_format}
          attachments={editingRow.attachments}
          hideSendButton={true}
          saveLabel="Save"
          title={`Edit email — ${editingRow.group.label}`}
          onSave={({ to, cc, bcc, subject, body_text, body_html }) => {
            updateRow(editingRow.groupKey, {
              to: to ?? editingRow.to,
              cc: cc ?? editingRow.cc,
              bcc: bcc ?? editingRow.bcc,
              subject: subject ?? editingRow.subject,
              body_text: body_text ?? editingRow.body_text,
              body_html: body_html ?? editingRow.body_html,
            });
            setEditingKey(null);
          }}
        />
      )}
    </div>
  );
}
