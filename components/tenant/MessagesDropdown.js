import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';

export default function MessagesDropdown() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onClickOutside);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Messages"
        className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        <MessageSquare className="w-5 h-5" strokeWidth={1.75} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Messages</h3>
            <span className="text-xs text-gray-400">0 unread</span>
          </div>
          <div className="p-8 text-center">
            <MessageSquare className="w-10 h-10 text-gray-300 mx-auto mb-3" strokeWidth={1.25} />
            <p className="text-sm font-medium text-gray-700">No messages yet</p>
            <p className="text-xs text-gray-500 mt-1">
              Team chat and direct messaging are coming soon.
            </p>
          </div>
          <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50">
            <p className="text-[11px] text-gray-500 text-center">
              Phase 5 — send messages to teammates about orders and loads
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
