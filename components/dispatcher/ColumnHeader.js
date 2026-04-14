import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MoreVertical, Pin, PinOff, EyeOff } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

const MIN_WIDTH = 60;
const MAX_WIDTH = 600;

/**
 * Draggable + resizable column header with a 3-dot actions menu.
 *
 * The 3-dot menu is rendered via a React portal to document.body
 * so it can escape the table's overflow-x clipping boundary.
 */
export default function ColumnHeader({
  column,
  isFrozen,
  stickyLeft,
  onRemove,
  onTogglePin,
  onResize,
}) {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  // Sticky header bg must be SOLID (not rgba) so frozen columns occlude
  // content scrolling behind them. Matches the thead bg-gray-50 / bg-slate-800.
  const headerBg = isDark ? '#1e293b' : '#f9fafb';

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key,
  });

  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState(null);

  // Resize state
  const [resizing, setResizing] = useState(false);
  const [liveWidth, setLiveWidth] = useState(column.width);

  // Keep liveWidth in sync when column prop changes (e.g. prefs loaded)
  useEffect(() => {
    if (!resizing) setLiveWidth(column.width);
  }, [column.width, resizing]);

  // Open menu: capture button coords for portal positioning
  function openMenu(e) {
    e.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuCoords({
        top: rect.bottom + 4,
        left: rect.right - 176, // menu width 11rem = 176px, right-align to button
      });
    }
    setMenuOpen(true);
  }

  // Close menu on outside click or scroll
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setMenuOpen(false);
      }
    }
    function onScroll() {
      setMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [menuOpen]);

  // Resize drag handlers
  function handleResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);

    const startX = e.clientX;
    const startWidth = column.width;

    function onMove(ev) {
      const delta = ev.clientX - startX;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
      setLiveWidth(next);
    }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setResizing(false);
      const delta = ev.clientX - startX;
      const finalWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
      if (finalWidth !== startWidth) {
        onResize?.(column.key, finalWidth);
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  const width = resizing ? liveWidth : column.width;

  const style = {
    width,
    minWidth: width,
    maxWidth: width,
    transform: CSS.Translate.toString(transform),
    transition: resizing ? 'none' : transition,
    opacity: isDragging ? 0.5 : 1,
    ...(isFrozen
      ? {
          position: 'sticky',
          left: stickyLeft,
          zIndex: 3,
          backgroundColor: headerBg,
        }
      : {}),
  };

  return (
    <th
      ref={setNodeRef}
      style={style}
      className={`relative text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-300 border-b border-gray-200 dark:border-slate-800 select-none group ${
        isFrozen ? 'shadow-[2px_0_4px_rgba(0,0,0,0.04)]' : ''
      }`}
    >
      {/*
        Label takes the full cell width with minimal padding. The drag
        handle and 3-dot menu are absolutely positioned and only visible
        on hover — their opaque background covers whatever text is
        underneath so they never clip the label visually.
      */}
      <div className="relative flex items-center min-w-0 h-4">
        <span
          className="block truncate w-full"
          title={column.label}
        >
          {column.label}
        </span>

        {/* Drag handle — absolute on left, appears on hover with bg cover */}
        <button
          {...attributes}
          {...listeners}
          className="absolute -left-1 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing touch-none opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded"
          title="Drag to reorder"
          style={{ padding: '2px', backgroundColor: headerBg }}
        >
          <GripVertical className="w-3 h-3" />
        </button>

        {/* 3-dot menu trigger — absolute on right, appears on hover with bg cover */}
        <button
          ref={triggerRef}
          type="button"
          onClick={openMenu}
          className="absolute -right-1 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded"
          title="Column options"
          style={{ padding: '2px', backgroundColor: headerBg }}
        >
          <MoreVertical className="w-3 h-3" />
        </button>
      </div>

      {/* Resize handle — right edge of header */}
      <div
        onMouseDown={handleResizeStart}
        className={`absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60 ${
          resizing ? 'bg-blue-500' : 'bg-transparent'
        }`}
        title="Drag to resize column"
      />

      {/* Portaled menu — escapes the table's overflow container */}
      {menuOpen &&
        menuCoords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: menuCoords.top,
              left: Math.max(8, menuCoords.left),
              zIndex: 1000,
              width: 176,
            }}
            className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onTogglePin?.(column.key);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 text-left"
            >
              {isFrozen ? (
                <>
                  <PinOff className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400" />
                  <span>Unpin Column</span>
                </>
              ) : (
                <>
                  <Pin className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400" />
                  <span>Pin Column</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onRemove?.(column.key);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-slate-200 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300 text-left border-t border-gray-100 dark:border-slate-800"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Remove Column</span>
            </button>
          </div>,
          document.body
        )}
    </th>
  );
}
