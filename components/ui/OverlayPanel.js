import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * OverlayPanel — Full-viewport slide-in panel from the right.
 *
 * Supports stacking: layer 0 is wider, layer 1+ gets progressively narrower
 * to create a visual "deck of cards" effect showing each layer peeking behind.
 *
 * Entrance: mounts with translateX(100%), transitions to 0 on next frame
 * Exit: when `closing` becomes true, reverses the transition back to translateX(100%)
 *
 * @param {function} onClose — called when backdrop is clicked or close button pressed
 * @param {number} stackIndex — 0-based position in the overlay stack (controls z-index + width)
 * @param {boolean} closing — true when the panel should animate out
 * @param {React.ReactNode} children
 */
export default function OverlayPanel({ onClose, stackIndex = 0, closing = false, children }) {
  const [entered, setEntered] = useState(false);
  const panelRef = useRef(null);

  // Slide-in animation: mount with translateX(100%), then transition to 0
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Slide-out animation: when closing flag flips on, reverse the transform
  useEffect(() => {
    if (closing) setEntered(false);
  }, [closing]);

  const zIndex = 60 + stackIndex * 10;

  // Each layer gets a larger left margin to show the layer behind
  const leftOffset = 48 + stackIndex * 48; // layer 0: 48px, layer 1: 96px, layer 2: 144px

  const content = (
    <div className="fixed inset-0" style={{ zIndex }}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-300 ${
          entered ? 'opacity-40' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div
        ref={panelRef}
        className={`absolute top-0 right-0 bottom-0 bg-white dark:bg-slate-900 shadow-2xl rounded-l-2xl overflow-y-auto transition-transform duration-300 ease-out ${
          entered ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: `calc(100vw - ${leftOffset}px)` }}
      >
        {/* Close button — floats in top-right */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Panel content */}
        <div className="min-h-full">
          {children}
        </div>
      </div>
    </div>
  );

  // Render via portal to avoid z-index/overflow issues
  if (typeof window === 'undefined') return null;
  return createPortal(content, document.body);
}
