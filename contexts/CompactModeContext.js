import { createContext, useContext, useState, useEffect } from 'react';

const CompactModeContext = createContext({
  isCompact: false,
  toggleCompact: () => {},
});

export function useCompactMode() {
  return useContext(CompactModeContext);
}

/**
 * CompactModeProvider — global toggle for compact UI spacing.
 *
 * Reads from localStorage instantly (no flash on page load), then syncs
 * the preference to the API in the background. The `[data-compact]`
 * attribute on the root div triggers CSS overrides in globals.css.
 */
export function CompactModeProvider({ children }) {
  const [isCompact, setIsCompact] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Read from localStorage on mount (client-side only)
  useEffect(() => {
    const stored = localStorage.getItem('dd.compact');
    if (stored === 'true') setIsCompact(true);
    setHydrated(true);
  }, []);

  // Sync to API whenever it changes (skip initial mount)
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem('dd.compact', String(isCompact));
    fetch('/api/tenant/dispatcher-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compact_mode: isCompact }),
    }).catch(() => {});
  }, [isCompact, hydrated]);

  function toggleCompact() {
    setIsCompact((c) => !c);
  }

  return (
    <CompactModeContext.Provider value={{ isCompact, toggleCompact }}>
      {children}
    </CompactModeContext.Provider>
  );
}

export default CompactModeContext;
