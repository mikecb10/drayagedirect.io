import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Orchestrates the bulk-email queue for 2a.4:
 *  - On mount: fetches defaults for each group via /email-defaults-bulk (parallel).
 *  - sendReady(): POSTs each ready row to /bulk-send (parallel).
 *  - retryFailed(): re-POSTs only rows whose status === 'failed'.
 *  - updateRow(groupKey, patch): merges Edit-popup saves back into a row.
 *
 * Row shape:
 *   { groupKey, group, status, to, cc, bcc, subject,
 *     body_text, body_html, body_format, attachments, error }
 *
 * @param {Array} groups  - from BulkGroupingModal.onContinue
 * @param {'customer'|'reference'|'charge_set'} groupingKind
 */
export function useBulkEmailQueue(groups, groupingKind, docType = 'invoice') {
  const [rows, setRows] = useState(() => groups.map((g) => ({
    groupKey: g.key,
    group: g,
    status: 'pending',
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    body_text: '',
    body_html: '',
    body_format: 'html',
    attachments: [],
    error: null,
  })));

  // docType routing table: which endpoints + request-body field names
  // apply for this bulk flow. All doc-type differences live here — nowhere
  // else. 'invoice' is the default so 2a.4 callers behave identically.
  const cfg = docType === 'rate_con' ? {
    defaultsUrl: '/api/tenant/ar/charge-sets/email-defaults-bulk-rate-con',
    sendUrl:     '/api/tenant/ar/charge-sets/bulk-send-rate-con',
    idField:     'charge_set_ids',
    defaultsBody: (g) => ({
      // computeGroups writes row-level ids to `invoice_ids` regardless of
      // docType (it's the generic "items in this group" field). Rate-con
      // callers populate that field with charge_set ids, so passing it
      // through as charge_set_ids here is correct.
      charge_set_ids: g.invoice_ids,
      customer_id:    g.customer_id,
    }),
  } : {
    defaultsUrl: '/api/tenant/ar/invoices/email-defaults-bulk',
    sendUrl:     '/api/tenant/ar/invoices/bulk-send',
    idField:     'invoice_ids',
    defaultsBody: (g) => ({
      invoice_ids: g.invoice_ids,
      customer_id: g.customer_id,
    }),
  };

  const initialized = useRef(false);
  // Mirror rows in a ref so async flows can read current state without stale closures.
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // On mount: fetch email-defaults for each group in parallel.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      const results = await Promise.allSettled(
        groups.map((g) =>
          fetch(cfg.defaultsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg.defaultsBody(g)),
          }).then(async (res) => {
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error || `HTTP ${res.status}`);
            }
            return res.json();
          })
        )
      );

      setRows((prev) => prev.map((r, idx) => {
        const result = results[idx];
        if (result.status === 'fulfilled') {
          const d = result.value;
          const hasRecipient = Array.isArray(d.to) && d.to.length > 0;
          return {
            ...r,
            to: d.to ?? [],
            cc: d.cc ?? [],
            bcc: d.bcc ?? [],
            subject: d.subject ?? '',
            body_text: d.body_text ?? '',
            body_html: d.body_html ?? '',
            body_format: d.body_format ?? 'html',
            attachments: d.attachments ?? [],
            status: hasRecipient ? 'ready' : 'needs_edit',
            error: null,
          };
        }
        return {
          ...r,
          status: 'needs_edit',
          error: result.reason?.message ?? 'Failed to load defaults',
        };
      }));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Merge edited fields back into a row (called from EmailComposeSlideOver Save).
  const updateRow = useCallback((groupKey, patch) => {
    setRows((prev) => prev.map((r) => {
      if (r.groupKey !== groupKey) return r;
      const merged = { ...r, ...patch };
      const hasRecipient = Array.isArray(merged.to) && merged.to.length > 0;
      const isFailed = merged.status === 'failed';
      return {
        ...merged,
        status: isFailed ? 'failed' : (hasRecipient ? 'ready' : 'needs_edit'),
        error: isFailed ? merged.error : null,
      };
    }));
  }, []);

  // Internal: send rows matching a status via /bulk-send.
  const sendRowsByStatus = useCallback(async (targetStatus) => {
    // Derive the dispatch list from the ref BEFORE any setRows. This keeps
    // targetKeys, dispatch list, and results index-aligned without relying
    // on side-effects inside a state setter (which strict-mode would double-
    // invoke, previously risking double-send).
    const targetRows = rowsRef.current.filter((r) => r.status === targetStatus);
    if (targetRows.length === 0) return [];
    const targetKeys = targetRows.map((r) => r.groupKey);

    // Pure setter — no side effects inside.
    setRows((prev) => prev.map((r) =>
      targetKeys.includes(r.groupKey)
        ? { ...r, status: 'sending', error: null }
        : r
    ));

    const results = await Promise.allSettled(
      targetRows.map((r) =>
        fetch(cfg.sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            group: {
              // Attachments carry the row-level id. For invoices,
              // email-defaults-bulk writes `invoice_id` per attachment;
              // for rate-cons, email-defaults-bulk-rate-con writes
              // `item_id` (aliased as `charge_set_id`). Accept either
              // via the fallback chain so both flows work without touching
              // existing invoice-side attachment shapes.
              [cfg.idField]: r.attachments.map((a) => a.item_id ?? a.invoice_id ?? a.charge_set_id),
              recipients: { to: r.to, cc: r.cc, bcc: r.bcc },
              subject: r.subject,
              body_text: r.body_text,
              body_html: r.body_html,
              body_format: r.body_format,
              grouping_kind: groupingKind,
              group_label: r.group.label,
            },
          }),
        }).then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
          }
          return res.json();
        })
      )
    );

    // Map groupKey → result. Stable regardless of row reordering or stale
    // ref snapshots — no index-drift footgun.
    const resultByKey = new Map();
    targetRows.forEach((r, i) => { resultByKey.set(r.groupKey, results[i]); });

    setRows((prev) => prev.map((r) => {
      const result = resultByKey.get(r.groupKey);
      if (!result) return r;
      return result.status === 'fulfilled'
        ? { ...r, status: 'sent', error: null }
        : { ...r, status: 'failed', error: result.reason?.message ?? 'Send failed' };
    }));

    return results;
  }, [groupingKind, cfg.sendUrl, cfg.idField]);

  const sendReady   = useCallback(() => sendRowsByStatus('ready'),  [sendRowsByStatus]);
  const retryFailed = useCallback(() => sendRowsByStatus('failed'), [sendRowsByStatus]);

  const readyCount     = rows.filter((r) => r.status === 'ready').length;
  const failedCount    = rows.filter((r) => r.status === 'failed').length;
  const sentCount      = rows.filter((r) => r.status === 'sent').length;
  const needsEditCount = rows.filter((r) => r.status === 'needs_edit').length;
  const allSent        = rows.length > 0 && rows.every((r) => r.status === 'sent');

  return {
    rows,
    updateRow,
    sendReady,
    retryFailed,
    readyCount,
    failedCount,
    sentCount,
    needsEditCount,
    allSent,
  };
}
