import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Clock, X } from 'lucide-react';

/**
 * Custom DateTimePicker — calendar grid + 15-minute time slots.
 *
 * Left:  month/year navigation + day grid
 * Right: scrollable time list in 15-min increments
 *
 * Props:
 *   label, value (ISO string or YYYY-MM-DD), onChange(isoString|null)
 *   showTime (default true) — show the time column
 *   use24h (default false) — 24-hour vs 12-hour AM/PM display
 */

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Generate 15-min slots for a day
function buildTimeSlots(use24h) {
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      let label;
      if (use24h) {
        label = val;
      } else {
        const suffix = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        label = `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
      }
      slots.push({ val, label });
    }
  }
  return slots;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

function parseValue(value) {
  if (!value) return { date: null, time: '00:00' };
  const str = String(value);
  if (str.length >= 16) {
    // datetime-local or ISO format
    return { date: str.slice(0, 10), time: str.slice(11, 16) };
  }
  if (str.length === 10) {
    return { date: str, time: '00:00' };
  }
  return { date: null, time: '00:00' };
}

function formatDisplay(value, showTime, use24h) {
  if (!value) return '';
  const { date, time } = parseValue(value);
  if (!date) return '';
  const d = new Date(date + 'T12:00:00'); // noon to avoid timezone issues
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (!showTime) return dateStr;
  const [h, m] = time.split(':').map(Number);
  let timeStr;
  if (use24h) {
    timeStr = time;
  } else {
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    timeStr = `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  }
  return `${dateStr} ${timeStr}`;
}

export default function DateTimePicker({
  label,
  value = '',
  onChange,
  required = false,
  error,
  helpText,
  className = '',
  disabled = false,
  showTime = true,
  use24h = false,
  autoOpen = false,
}) {
  const wrapperRef = useRef(null);
  const timeListRef = useRef(null);
  const [open, setOpen] = useState(autoOpen);
  // openUp = render the dropdown ABOVE the input instead of below.
  // Decided when the user opens the picker by measuring available space.
  // Only relevant when !autoOpen (autoOpen mode renders inline inside a
  // parent floater like CellPopover, which handles its own positioning).
  const [openUp, setOpenUp] = useState(false);

  const parsed = parseValue(value);
  const today = new Date();
  const [viewYear, setViewYear] = useState(parsed.date ? parseInt(parsed.date.slice(0, 4)) : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.date ? parseInt(parsed.date.slice(5, 7)) - 1 : today.getMonth());
  const [selectedDate, setSelectedDate] = useState(parsed.date);
  const [selectedTime, setSelectedTime] = useState(parsed.time || '00:00');

  const timeSlots = buildTimeSlots(use24h);

  // Sync when value changes externally
  useEffect(() => {
    const p = parseValue(value);
    if (p.date) {
      setSelectedDate(p.date);
      setSelectedTime(p.time || '00:00');
      setViewYear(parseInt(p.date.slice(0, 4)));
      setViewMonth(parseInt(p.date.slice(5, 7)) - 1);
    }
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll to selected time when opening
  useEffect(() => {
    if (open && timeListRef.current && selectedTime) {
      const idx = timeSlots.findIndex((s) => s.val === selectedTime);
      if (idx >= 0) {
        const el = timeListRef.current.children[idx];
        el?.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
  }, [open]);

  // Decide dropdown direction (up vs down) when opening. Skip in autoOpen
  // mode — the parent floater (e.g. CellPopover) handles positioning.
  // Reserves 80px at the bottom of the viewport for any fixed-bottom UI
  // (BulkActionBar etc.) so the dropdown doesn't get hidden behind it.
  useEffect(() => {
    if (!open || autoOpen || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const estimatedHeight = showTime ? 420 : 360;
    const spaceBelow = window.innerHeight - rect.bottom - 80;
    const spaceAbove = rect.top - 8;
    setOpenUp(estimatedHeight > spaceBelow && spaceAbove > spaceBelow);
  }, [open, autoOpen, showTime]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  function selectDay(day) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(dateStr);
    if (showTime) {
      // Emit with time
      onChange?.(`${dateStr}T${selectedTime}`);
    } else {
      onChange?.(dateStr);
      setOpen(false);
    }
  }

  function selectTime(timeVal) {
    setSelectedTime(timeVal);
    if (selectedDate) {
      onChange?.(`${selectedDate}T${timeVal}`);
      setOpen(false);
    }
  }

  function handleClear(e) {
    e.stopPropagation();
    setSelectedDate(null);
    setSelectedTime('00:00');
    onChange?.(null);
    setOpen(false);
  }

  // Build calendar grid
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const displayText = formatDisplay(value, showTime, use24h);

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}

      {/* Display field — hidden when autoOpen (used as embedded picker) */}
      {!autoOpen && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen(!open)}
          className={`flex items-center w-full rounded-lg border px-3 py-2.5 text-sm text-left bg-white dark:bg-slate-900 hover:border-gray-400 dark:hover:border-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:bg-gray-50 dark:disabled:bg-slate-900 disabled:text-gray-500 dark:disabled:text-slate-400 cursor-pointer ${
            error ? 'border-red-300 dark:border-red-800' : 'border-gray-300 dark:border-slate-600'
          }`}
        >
          <Calendar className="w-4 h-4 text-gray-400 dark:text-slate-500 mr-2 shrink-0" />
          <span className={`flex-1 ${displayText ? 'text-gray-900 dark:text-slate-100' : 'text-gray-400 dark:text-slate-500'}`}>
            {displayText || 'Select date...'}
          </span>
          {value && (
            <span onClick={handleClear} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 ml-1">
              <X className="w-3.5 h-3.5" />
            </span>
          )}
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div className={`absolute z-50 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg flex overflow-hidden ${
          openUp ? 'bottom-full mb-1' : 'mt-1'
        }`}>
          {/* Calendar */}
          <div className="p-3 w-[280px]">
            {/* Month/Year nav */}
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800">
                <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-slate-300" />
              </button>
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                {MONTHS[viewMonth]} {viewYear}
              </div>
              <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800">
                <ChevronRight className="w-4 h-4 text-gray-600 dark:text-slate-300" />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 gap-0 mb-1">
              {DAYS.map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-gray-400 dark:text-slate-500 uppercase py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-0">
              {cells.map((day, i) => {
                if (day === null) return <div key={`e-${i}`} />;
                const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isSelected = dateStr === selectedDate;
                const isToday = dateStr === todayStr;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => selectDay(day)}
                    className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white'
                        : isToday
                          ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold'
                          : 'text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            {/* Today shortcut */}
            <button
              type="button"
              onClick={() => {
                setViewYear(today.getFullYear());
                setViewMonth(today.getMonth());
                selectDay(today.getDate());
              }}
              className="mt-2 w-full text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium py-1"
            >
              Today
            </button>
          </div>

          {/* Time column */}
          {showTime && (
            <div className="border-l border-gray-200 dark:border-slate-700 w-[110px] flex flex-col">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-slate-800 flex items-center gap-1.5 bg-gray-50/60 dark:bg-slate-900/60">
                <Clock className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Time</span>
              </div>
              <div ref={timeListRef} className="flex-1 overflow-y-auto max-h-[280px]">
                {timeSlots.map((slot) => (
                  <button
                    key={slot.val}
                    type="button"
                    onClick={() => selectTime(slot.val)}
                    className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                      slot.val === selectedTime
                        ? 'bg-blue-600 text-white font-medium'
                        : 'text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                    }`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!error && helpText && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{helpText}</p>}
    </div>
  );
}
