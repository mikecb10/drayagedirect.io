import { useState, useRef, useEffect } from 'react';
import { Check, X, Clock } from 'lucide-react';
import DateTimePicker from '../../ui/DateTimePicker';

/**
 * Pill-style toggle button for event status (Arrived / Departed / Started).
 *
 * States:
 *   - Disabled: gray, non-clickable
 *   - Unset: outlined gray — click to set to now()
 *   - Set (green): shows ✓ + label + timestamp
 *     - Click the timestamp → opens DateTimePicker calendar+time popover
 *     - Click ✗ → clears the timestamp
 */

function formatTime(isoString, use24h) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (use24h) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ''; }
}

export default function StatusButton({ label, value, onChange, use24h = false, disabled = false }) {
  const isSet = !!value;
  const timeStr = formatTime(value, use24h);
  const [editing, setEditing] = useState(false);
  const wrapperRef = useRef(null);

  // Close editor on outside click — must stay above all early returns
  // so hooks always run in the same order (React rules of hooks).
  useEffect(() => {
    if (!editing) return;
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setEditing(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing]);

  function handleClick() {
    if (disabled) return;
    if (!isSet) {
      onChange(new Date().toISOString());
    }
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange(null);
    setEditing(false);
  }

  function handleTimeClick(e) {
    e.stopPropagation();
    setEditing(!editing);
  }

  function handleDateTimeChange(newIso) {
    if (newIso) {
      onChange(new Date(newIso).toISOString());
    }
    setEditing(false);
  }

  // Disabled + already set (completed load) → read-only green pill
  if (disabled && isSet) {
    return (
      <div className="inline-flex items-center rounded-lg bg-emerald-500/70 overflow-hidden">
        <span className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white">
          <Check className="w-3 h-3" strokeWidth={3} />
          {label}
        </span>
        <span className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-bold text-white/80 border-l border-emerald-400/50">
          <Clock className="w-2.5 h-2.5" />
          {timeStr}
        </span>
      </div>
    );
  }

  // Disabled + not set → gray placeholder
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 px-4 py-1.5 text-xs font-medium text-gray-300 dark:text-slate-600 cursor-not-allowed">
        {label}
      </span>
    );
  }

  // Unset state
  if (!isSet) {
    return (
      <button type="button" onClick={handleClick}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300 hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors">
        {label}
      </button>
    );
  }

  // Set state with editable timestamp
  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <div className="inline-flex items-center rounded-lg bg-emerald-500 shadow-sm overflow-hidden">
        {/* Main label */}
        <span className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white">
          <Check className="w-3 h-3" strokeWidth={3} />
          {label}
        </span>

        {/* Clickable timestamp — opens calendar+time picker */}
        <button type="button" onClick={handleTimeClick}
          title="Click to edit date & time"
          className={`flex items-center gap-1 px-2 py-1.5 text-[10px] font-bold transition-colors border-l border-emerald-400 ${
            editing ? 'bg-emerald-600 text-white' : 'text-white/90 hover:text-white hover:bg-emerald-600'
          }`}>
          <Clock className="w-2.5 h-2.5" />
          {timeStr}
        </button>

        {/* Clear button */}
        <button type="button" onClick={handleClear}
          title="Clear timestamp"
          className="flex items-center px-1.5 py-1.5 text-white/70 hover:text-white hover:bg-red-500 transition-colors border-l border-emerald-400">
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* DateTimePicker popover */}
      {editing && (
        <div className="absolute z-50 top-full mt-1 right-0" onClick={(e) => e.stopPropagation()}>
          <DateTimePicker
            value={value}
            onChange={handleDateTimeChange}
            showTime
            use24h={use24h}
            autoOpen
          />
        </div>
      )}
    </div>
  );
}
