import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * CellPopover — portal-rendered floating box anchored to a cell.
 *
 * Escapes the table's overflow container so it's never clipped.
 * Closes on outside click + Escape key.
 * Repositions on scroll/resize to stay anchored to the cell.
 *
 * Usage:
 *   <CellPopover anchorEl={el} onClose={close}>
 *     <SomePicker onSelect={...} />
 *   </CellPopover>
 */
export default function CellPopover({ anchorEl, onClose, children, width = 260 }) {
  const popRef = useRef(null);
  const [coords, setCoords] = useState(null);

  // Calculate position relative to anchor — recalculate on demand
  const reposition = useCallback(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popHeight = popRef.current?.offsetHeight || 200;
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;

    let top = rect.bottom + 4;
    let left = rect.left;

    // Prevent horizontal overflow
    const maxLeft = viewW - width - 8;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;

    // Flip to above if no room below (use actual popover height)
    const spaceBelow = viewH - rect.bottom - 8;
    const spaceAbove = rect.top - 8;

    if (popHeight > spaceBelow && spaceAbove > spaceBelow) {
      // Place above the anchor
      top = rect.top - popHeight - 4;
      if (top < 8) top = 8;
    }

    // Ensure it doesn't go below viewport
    if (top + popHeight > viewH - 8) {
      top = viewH - popHeight - 8;
    }

    setCoords({ top, left });
  }, [anchorEl, width]);

  // Initial position + reposition after content renders
  useEffect(() => {
    reposition();
    // Reposition again after a tick so popRef.current has dimensions
    const raf = requestAnimationFrame(reposition);
    return () => cancelAnimationFrame(raf);
  }, [reposition]);

  // Reposition when the popover's own bounding box changes — covers cases
  // where children mount/render in multiple passes (12-field forms in
  // particular were positioning against an empty popRef before children
  // populated, anchoring the popover against the bulk bar with bottom
  // content overflowing past the viewport).
  useEffect(() => {
    if (!coords || !popRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => reposition());
    observer.observe(popRef.current);
    return () => observer.disconnect();
  }, [coords !== null, reposition]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click / Escape, reposition on scroll/resize
  useEffect(() => {
    function handleClick(e) {
      // Clicks inside the popover body or its anchor cell are "inside"
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (anchorEl?.contains(e.target)) return;

      // Clicks inside any portal-rendered dropdown that opts into the popover
      // "safe zone" (e.g. ReferenceDataPicker's portalled list) are ALSO
      // considered inside — without this, clicking a dropdown item would close
      // the popover before the item's onClick handler could fire, eating the
      // selection. Any descendant with data-popover-safe-zone="true" counts.
      if (e.target.closest && e.target.closest('[data-popover-safe-zone="true"]')) return;

      onClose?.();
    }
    function handleEsc(e) {
      if (e.key === 'Escape') onClose?.();
    }
    function handleScrollOrResize() {
      reposition();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [anchorEl, onClose, reposition]);

  if (!coords || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={popRef}
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        width,
        zIndex: 1000,
      }}
      className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl p-2"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
