import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const OverlayContext = createContext(null);

let _idCounter = 0;

export function OverlayProvider({ children }) {
  const [stack, setStack] = useState([]);

  const openOverlay = useCallback((type, props = {}) => {
    const id = ++_idCounter;
    setStack((prev) => [...prev, { id, type, props }]);
    return id;
  }, []);

  const closeOverlay = useCallback(() => {
    // Two-phase close: mark topmost as "closing" to trigger exit animation,
    // then actually remove from stack after the animation duration (300ms).
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.closing) return prev; // already closing — ignore rapid double-close
      return prev.map((entry, i) =>
        i === prev.length - 1 ? { ...entry, closing: true } : entry
      );
    });

    setTimeout(() => {
      setStack((prev) => {
        // Safety: only pop if the last is still the one we marked closing
        if (prev.length > 0 && prev[prev.length - 1].closing) {
          const remaining = prev.slice(0, -1);
          // If the stack is now empty, clear the ?load= query param from the
          // URL so a refresh goes back to the clean dispatcher board.
          if (remaining.length === 0 && typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            if (url.searchParams.has('load') || url.searchParams.has('tab')) {
              url.searchParams.delete('load');
              url.searchParams.delete('tab');
              window.history.replaceState({}, '', url.pathname + url.search);
            }
          }
          return remaining;
        }
        return prev;
      });
    }, 300);
  }, []);

  const closeAllOverlays = useCallback(() => {
    setStack([]);
  }, []);

  // ESC key — close topmost overlay (but only if it's not already closing)
  useEffect(() => {
    if (stack.length === 0) return;

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        // Don't close overlay if a Modal is open — let Modal handle its own ESC
        const modalOpen = document.querySelector('[data-modal-overlay]');
        if (modalOpen) return;
        // Don't close if user is typing in an input/textarea/select
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        // Don't close if topmost is already animating out
        const topmost = stack[stack.length - 1];
        if (topmost?.closing) return;
        e.stopPropagation();
        closeOverlay();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [stack, closeOverlay]);

  // Body scroll lock — only when there's at least one non-closing overlay
  const hasActiveOverlay = stack.some((e) => !e.closing);
  useEffect(() => {
    if (hasActiveOverlay) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [hasActiveOverlay]);

  return (
    <OverlayContext.Provider value={{ stack, openOverlay, closeOverlay, closeAllOverlays }}>
      {children}
    </OverlayContext.Provider>
  );
}

export function useOverlay() {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('useOverlay must be used within OverlayProvider');
  return ctx;
}
