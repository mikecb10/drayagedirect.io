import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { buildDatePresets } from '../../lib/kpi-engine';

/**
 * DateFilterDropdown — "Select The Day You Want To Work On"
 *
 * Sits top-left of the dispatcher board. Dropdown with day presets
 * that cascade based on the current day (shows actual day names).
 */
export default function DateFilterDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const presets = buildDatePresets();

  const activePreset = presets.find((p) => p.key === value) || presets[0];

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

  function handleSelect(key) {
    onChange(key);
    setOpen(false);
  }

  // Navigate prev/next preset
  function navigate(dir) {
    const idx = presets.findIndex((p) => p.key === value);
    const next = idx + dir;
    if (next >= 0 && next < presets.length) {
      onChange(presets[next].key);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:border-gray-400 min-w-[180px]"
        >
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="flex-1 text-left">{activePreset.label}</span>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        <button
          type="button"
          onClick={() => navigate(1)}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg w-56 py-1 max-h-[400px] overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-gray-400">
            Select The Day You Want To Work On
          </div>
          {presets.map((p) => {
            const isActive = p.key === value;
            const isPastDue = p.key === 'past_due';
            const isTodayPast = p.key === 'today_and_past';
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => handleSelect(p.key)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : isPastDue
                      ? 'text-red-600 hover:bg-red-50 font-medium'
                      : isTodayPast
                        ? 'text-amber-600 hover:bg-amber-50 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
