import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

/**
 * ColorPicker — label + swatch that opens a native color picker, plus a hex
 * text input and a clear button. Matches the PortPro state color UX.
 *
 * Props:
 *   label      - field label
 *   value      - current hex color (e.g. "#ff0000") or null/empty for unset
 *   onChange   - fired with new hex string (or null when cleared)
 *   defaultColor - fallback color when value is empty (for display only)
 */
export default function ColorPicker({
  label,
  value,
  onChange,
  defaultColor = '#f3f4f6',
  className = '',
}) {
  const [hex, setHex] = useState(value || '');

  useEffect(() => {
    setHex(value || '');
  }, [value]);

  const displayColor = hex || defaultColor;

  function handleSwatchChange(e) {
    const next = e.target.value;
    setHex(next);
    onChange?.(next);
  }

  function handleHexInput(e) {
    const next = e.target.value;
    setHex(next);
    if (!next) {
      onChange?.(null);
      return;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(next)) {
      onChange?.(next);
    }
  }

  function handleClear(e) {
    e.preventDefault();
    e.stopPropagation();
    setHex('');
    onChange?.(null);
  }

  return (
    <div className={className}>
      {label && (
        <div className="text-xs font-medium text-gray-700 mb-1 truncate" title={label}>
          {label}
        </div>
      )}
      <div className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white p-1.5 hover:border-gray-400 transition-colors">
        <label
          className="relative w-6 h-6 rounded cursor-pointer shrink-0 border border-gray-200"
          style={{ backgroundColor: displayColor }}
          title="Pick a color"
        >
          <input
            type="color"
            value={displayColor}
            onChange={handleSwatchChange}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <input
          type="text"
          value={hex}
          onChange={handleHexInput}
          placeholder="—"
          className="flex-1 min-w-0 text-xs font-mono text-gray-700 bg-transparent border-0 focus:outline-none focus:ring-0 uppercase"
          maxLength={7}
        />
        {hex && (
          <button
            type="button"
            onClick={handleClear}
            className="text-gray-300 hover:text-red-500 shrink-0"
            title="Clear"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
