import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export default function TopBarSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);

  // Keyboard shortcut: Cmd/Ctrl+K to focus search
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Outside click closes dropdown
  useEffect(() => {
    function onClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative flex-1 max-w-xl">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search orders, customers, drivers..."
          className="w-full h-9 pl-9 pr-14 rounded-lg bg-gray-100 border border-transparent text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <kbd className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 bg-white border border-gray-300 rounded">
          ⌘K
        </kbd>
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          {query ? (
            <div className="p-4 text-center">
              <p className="text-sm text-gray-500">
                Search results coming in Phase 5.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                You'll be able to search across orders, customers, drivers, and invoices.
              </p>
            </div>
          ) : (
            <div className="p-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Search Tips
              </div>
              <ul className="text-sm text-gray-600 space-y-1.5">
                <li>• Start typing to find customers, drivers, and orders</li>
                <li>• Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-xs">⌘K</kbd> to focus from anywhere</li>
                <li>• Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-xs">Esc</kbd> to close</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
