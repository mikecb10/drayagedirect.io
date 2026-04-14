import { useEffect, useState } from 'react';

/**
 * useTenantSettings — fetches tenant_settings once per session and caches
 * the result module-level so multiple hook instances share the same fetch.
 *
 * Returns the settings object (or null while loading). Useful for:
 *   - time_format ('12h' | '24h')
 *   - date_format ('MM/DD/YYYY' | ...)
 *   - timezone
 *   - any other tenant-wide preference
 *
 * For derived values, prefer the specific hooks below (e.g. useTenantTimeFormat)
 * which return cleaner shapes.
 */

let cachedSettings = null;
let inflightPromise = null;
const subscribers = new Set();

async function loadSettings() {
  if (cachedSettings) return cachedSettings;
  if (inflightPromise) return inflightPromise;

  inflightPromise = fetch('/api/tenant/settings')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      cachedSettings = d?.settings || {};
      inflightPromise = null;
      // Notify all subscribers (other mounted hook instances) of the loaded value
      subscribers.forEach((fn) => fn(cachedSettings));
      return cachedSettings;
    })
    .catch(() => {
      inflightPromise = null;
      cachedSettings = {};
      return cachedSettings;
    });

  return inflightPromise;
}

/**
 * Invalidate the cached settings — call this after a settings save so the
 * next read picks up the new values.
 */
export function invalidateTenantSettings() {
  cachedSettings = null;
  inflightPromise = null;
}

export function useTenantSettings() {
  const [settings, setSettings] = useState(cachedSettings);

  useEffect(() => {
    if (cachedSettings) {
      setSettings(cachedSettings);
      return;
    }
    let mounted = true;
    loadSettings().then((s) => {
      if (mounted) setSettings(s);
    });
    subscribers.add(setSettings);
    return () => {
      subscribers.delete(setSettings);
      mounted = false;
    };
  }, []);

  return settings;
}

/**
 * Convenience hook: returns true if the tenant uses 24-hour time format,
 * false otherwise (12h is the default). Returns false while settings load.
 */
export function useTenantTimeFormat() {
  const settings = useTenantSettings();
  return settings?.time_format === '24h';
}
