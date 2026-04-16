import { useState, useEffect, useCallback } from 'react';

const VIEW_MODE_KEY = 'dd.settings.viewMode';
const SHOW_TABS_KEY = 'dd.settings.showTabsInSidebar';

const DEFAULT_VIEW_MODE = 'sidebar';
const DEFAULT_SHOW_TABS = false;

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
 */
export default function useSettingsViewPrefs() {
  const [viewMode, setViewModeState] = useState(DEFAULT_VIEW_MODE);
  const [showTabsInSidebar, setShowTabsState] = useState(DEFAULT_SHOW_TABS);

  // Hydrate from localStorage after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    setViewModeState(readViewMode());
    setShowTabsState(readShowTabs());
  }, []);

  const setViewMode = useCallback((next) => {
    const value = next === 'card' ? 'card' : 'sidebar';
    setViewModeState(value);
    try {
      localStorage.setItem(VIEW_MODE_KEY, value);
    } catch {}
  }, []);

  const setShowTabsInSidebar = useCallback((next) => {
    const value = !!next;
    setShowTabsState(value);
    try {
      localStorage.setItem(SHOW_TABS_KEY, String(value));
    } catch {}
  }, []);

  return { viewMode, showTabsInSidebar, setViewMode, setShowTabsInSidebar };
}
