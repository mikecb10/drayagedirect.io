import { useCallback, useEffect, useState } from 'react';

/**
 * Fetches + persists the current user's AR custom tabs. Exposes:
 *   customTabs         - Array<{id, section, name, filters, created_at}>
 *   saveCustomTab(tab) - Upsert a tab (matched by id if present, else appended)
 *   deleteCustomTab(id) - Remove a tab by id
 *   loading            - true until the initial GET resolves
 *   error              - last error message or null
 *
 * The hook optimistically updates local state and POSTs the full list
 * (upsert semantics — the endpoint always replaces custom_tabs wholesale).
 */
export function useArUserPreferences() {
  const [customTabs, setCustomTabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tenant/ar/user-preferences');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (!cancelled) setCustomTabs(Array.isArray(body.custom_tabs) ? body.custom_tabs : []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load preferences');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (nextTabs) => {
    // Optimistic — client sees the update immediately; rollback on failure.
    setCustomTabs(nextTabs);
    try {
      const res = await fetch('/api/tenant/ar/user-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_tabs: nextTabs }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = await res.json();
      // Normalize to server response (id / created_at may have been filled in).
      if (Array.isArray(body.custom_tabs)) setCustomTabs(body.custom_tabs);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to save preferences');
      // Rollback on failure by re-fetching.
      try {
        const res = await fetch('/api/tenant/ar/user-preferences');
        if (res.ok) {
          const body = await res.json();
          setCustomTabs(Array.isArray(body.custom_tabs) ? body.custom_tabs : []);
        }
      } catch (_) { /* swallow — next user action will retry */ }
    }
  }, []);

  const saveCustomTab = useCallback((tab) => {
    const existing = customTabs.find((t) => t.id === tab.id);
    const next = existing
      ? customTabs.map((t) => (t.id === tab.id ? { ...t, ...tab } : t))
      : [...customTabs, tab];
    return persist(next);
  }, [customTabs, persist]);

  const deleteCustomTab = useCallback((id) => {
    return persist(customTabs.filter((t) => t.id !== id));
  }, [customTabs, persist]);

  return { customTabs, saveCustomTab, deleteCustomTab, loading, error };
}
