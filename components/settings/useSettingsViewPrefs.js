import { useState, useEffect, useCallback } from 'react';

const VIEW_MODE_KEY = 'dd.settings.viewMode';
const SHOW_TABS_KEY = 'dd.settings.showTabsInSidebar';

const DEFAULT_VIEW_MODE = 'sidebar';
const DEFAULT_SHOW_TABS = false;

// Custom event broadcast across hook instances within the same tab.
// localStorage's native `storage` event only fires on OTHER tabs, so we need
// our own broadcaster for components in the same tab to stay in sync.
const SYNC_EVENT = 'dd:settings-prefs-updated';

function readViewMode() {
  if (typeof window === 'undefined') return DEFAULT_VIEW_MODE;
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return v === 'card' ? 'card' : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

function readShowTabs() {
  if (typeof window === 'undefined') return DEFAULT_SHOW_TABS;
  try {
    return localStorage.getItem(SHOW_TABS_KEY) === 'true';
  } catch {
    return DEFAULT_SHOW_TABS;
  }
}

function broadcast() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}

/**
 * SSR-safe hook for the two settings nav preferences. Returns defaults during
 * server render, then hydrates from localStorage on mount. Setters write
 * through to localStorage immediately and update local state.
 *
 *   const { viewMode, showTabsInSidebar, setViewMode, setShowTabsInSidebar } =
 *     useSettingsViewPrefs();
 *
 * viewMode:           'sidebar' | 'card'   (default 'sidebar')
 * showTabsInSidebar:  boolean              (default false)
 *
 * The two prefs are independent. showTabsInSidebar is only meaningful when
 * viewMode === 'sidebar'; in card mode the sibling tabs always render
 * regardless of this pref.
 *
 * Cross-instance sync: when any setter runs, all other hook instances within
 * the same tab re-read from localStorage via a custom-event subscription. The
 * native `storage` event handles cross-tab sync for free.
 */
export default function useSettingsViewPrefs() {
  const [viewMode, setViewModeState] = useState(DEFAULT_VIEW_MODE);
  const [showTabsInSidebar, setShowTabsState] = useState(DEFAULT_SHOW_TABS);

  // Hydrate from localStorage after mount (avoids SSR hydration mismatch)
  // and re-sync whenever another hook instance writes a pref.
  useEffect(() => {
    function syncFromStorage() {
      setViewModeState(readViewMode());
      setShowTabsState(readShowTabs());
    }
    syncFromStorage(); // initial hydrate
    window.addEventListener(SYNC_EVENT, syncFromStorage);
    window.addEventListener('storage', syncFromStorage); // cross-tab
    return () => {
      window.removeEventListener(SYNC_EVENT, syncFromStorage);
      window.removeEventListener('storage', syncFromStorage);
    };
  }, []);

  const setViewMode = useCallback((next) => {
    const value = next === 'card' ? 'card' : 'sidebar';
    setViewModeState(value);
    try {
      localStorage.setItem(VIEW_MODE_KEY, value);
    } catch {}
    broadcast();
  }, []);

  const setShowTabsInSidebar = useCallback((next) => {
    const value = !!next;
    setShowTabsState(value);
    try {
      localStorage.setItem(SHOW_TABS_KEY, String(value));
    } catch {}
    broadcast();
  }, []);

  return { viewMode, showTabsInSidebar, setViewMode, setShowTabsInSidebar };
}
