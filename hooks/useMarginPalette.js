import { useEffect, useState } from 'react';

/**
 * useMarginPalette — fetches the tenant's chosen margin pill palette
 * once per session and caches at module level. Mirrors the cache pattern
 * in useTenantSettings.
 *
 * Returns 'default' (red/yellow/green) until the API responds, then the
 * tenant-configured value ('default' | 'colorblind'). MarginBadge reads
 * this to swap its bucket → Tailwind class map without prop-drilling.
 *
 * The palette is stored on the tenants table next to the other margin_*
 * settings (red/yellow thresholds, include_dry_runs); the same endpoint
 * /api/tenant/me/margin-thresholds returns all four.
 */

let cachedPalette = null;
let inflightPromise = null;
const subscribers = new Set();

async function loadPalette() {
  if (cachedPalette) return cachedPalette;
  if (inflightPromise) return inflightPromise;

  inflightPromise = fetch('/api/tenant/me/margin-thresholds')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      cachedPalette = d?.palette || 'default';
      inflightPromise = null;
      subscribers.forEach((fn) => fn(cachedPalette));
      return cachedPalette;
    })
    .catch(() => {
      inflightPromise = null;
      cachedPalette = 'default';
      return cachedPalette;
    });

  return inflightPromise;
}

/**
 * Invalidate the cached palette — call this after a settings save so
 * the next read picks up the new value.
 */
export function invalidateMarginPalette() {
  cachedPalette = null;
  inflightPromise = null;
}

export default function useMarginPalette() {
  const [palette, setPalette] = useState(cachedPalette || 'default');

  useEffect(() => {
    if (cachedPalette) {
      setPalette(cachedPalette);
      return;
    }
    let mounted = true;
    loadPalette().then((p) => {
      if (mounted) setPalette(p);
    });
    subscribers.add(setPalette);
    return () => {
      subscribers.delete(setPalette);
      mounted = false;
    };
  }, []);

  return palette;
}
