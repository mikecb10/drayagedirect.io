import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

/**
 * Custom-rendered single-select dropdown. Drop-in replacement for a
 * native `<select>` styled to match dark mode without inheriting OS
 * chrome. Sibling to components/ui/MultiSelect.js.
 *
 * Props:
 *   label, name           — optional <label> + htmlFor
 *   value                 — currently-selected option's value (string|null)
 *   options               — [{ value, label }]
 *   onChange(value)       — called with the new value (no synthetic event)
 *   placeholder           — shown when value is empty (default '— Select —')
 *   disabled, required, error, className
 */
export default function Dropdown({
  label,
  name,
  value,
  options = [],
  onChange,
  placeholder = '— Select —',
  disabled = false,
  required = false,
  error = null,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);

  const currentOption = options.find((o) => o.value === value) || null;
  const currentLabel = currentOption ? currentOption.label : placeholder;

  function recomputePos() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: rect.width,
    });
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      const inWrapper = wrapperRef.current && wrapperRef.current.contains(e.target);
      const inPanel = e.target.closest('[data-dropdown-panel="true"]');
      if (!inWrapper && !inPanel) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDismiss() {
      setOpen(false);
    }
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [open]);

  function openPanel(initialHighlight = -1) {
    if (disabled) return;
    recomputePos();
    setHighlightedIdx(
      initialHighlight === -1
        ? Math.max(0, options.findIndex((o) => o.value === value))
        : initialHighlight
    );
    setOpen(true);
  }

  function commit(idx) {
    const opt = options[idx];
    if (!opt) return;
    onChange?.(opt.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPanel(0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        openPanel(options.length - 1);
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIdx((i) => (i + 1) % options.length);
        return;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIdx((i) => (i - 1 + options.length) % options.length);
        return;
      case 'Home':
        e.preventDefault();
        setHighlightedIdx(0);
        return;
      case 'End':
        e.preventDefault();
        setHighlightedIdx(options.length - 1);
        return;
      case 'Enter':
        e.preventDefault();
        if (highlightedIdx >= 0) commit(highlightedIdx);
        return;
      case 'Tab':
        setOpen(false);
        return;
    }
  }

  const buttonClass =
    `block w-full rounded-lg border px-3 py-2 text-sm text-left flex items-center justify-between ` +
    `bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 ` +
    (error
      ? 'border-red-300 dark:border-red-800 focus:border-red-500 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-900/40 '
      : 'border-gray-300 dark:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 ') +
    'focus:outline-none ' +
    (disabled ? 'opacity-60 cursor-not-allowed ' : 'cursor-pointer ');

  const valueClass = currentOption
    ? 'truncate'
    : 'truncate text-gray-400 dark:text-slate-500';

  return (
    <div ref={wrapperRef} className={className}>
      {label && (
        <label
          htmlFor={name}
          className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5"
        >
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <button
        ref={buttonRef}
        id={name}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={onKeyDown}
        className={buttonClass}
      >
        <span className={valueClass}>{currentLabel}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0" />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <ul
            data-dropdown-panel="true"
            role="listbox"
            style={{
              position: 'absolute',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
              zIndex: 1000,
            }}
            className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg max-h-64 overflow-auto py-1"
          >
            {options.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400 dark:text-slate-500 italic">
                No options
              </li>
            ) : (
              options.map((o, idx) => {
                const isSelected = o.value === value;
                const isHighlighted = idx === highlightedIdx;
                return (
                  <li
                    key={o.value}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIdx(idx)}
                    onClick={() => commit(idx)}
                    className={
                      'px-3 py-2 text-sm cursor-pointer flex items-center justify-between ' +
                      (isHighlighted
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-gray-900 dark:text-slate-100 '
                        : 'text-gray-900 dark:text-slate-100 ') +
                      'hover:bg-blue-50 dark:hover:bg-blue-900/30'
                    }
                  >
                    <span className="truncate">{o.label}</span>
                    {isSelected && (
                      <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    )}
                  </li>
                );
              })
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}
