import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeContext = createContext({
  theme: 'system',
  effectiveTheme: 'light',
  setTheme: () => {},
  cycleTheme: () => {},
});

const STORAGE_KEY = 'dd.theme';

function getSystemPreference() {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeClass(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const effective = theme === 'system' ? getSystemPreference() : theme;
  if (effective === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/**
 * ThemeProvider — Three-state theme manager (Light / Dark / System).
 *
 * Modeled on CompactModeContext: reads from localStorage on mount,
 * persists every change, and additionally listens to the OS preference
 * when in 'system' mode so the app updates instantly when the user
 * flips their OS dark mode toggle.
 *
 * The `dark` class is applied to <html> so any descendant can use
 * Tailwind's `dark:` variant. An anti-FOUC script in _document.js
 * applies the saved theme BEFORE React hydrates so users with dark
 * mode never see a white flash.
 */
export function ThemeProvider({ children }) {
  // 'light' | 'dark' | 'system' — defaults to 'system' so first-time visitors get OS preference
  const [theme, setThemeState] = useState('system');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount (client-side only)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      setThemeState(stored);
    }
    setHydrated(true);
  }, []);

  // Apply class + persist whenever theme changes (skip first hydration tick)
  useEffect(() => {
    if (!hydrated) return;
    applyThemeClass(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, hydrated]);

  // Listen for OS preference changes when in system mode
  useEffect(() => {
    if (theme !== 'system') return;
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyThemeClass('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
  }, []);

  // Cycle: light → dark → system → light
  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'system';
      return 'light';
    });
  }, []);

  // Effective theme = what's actually showing right now (resolves 'system' to dark/light)
  const effectiveTheme = theme === 'system' ? getSystemPreference() : theme;

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export default ThemeContext;
