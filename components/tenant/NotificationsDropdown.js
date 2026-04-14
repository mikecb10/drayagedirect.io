import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

export default function NotificationsDropdown() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const unreadCount = 0;

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
        title="Notifications"
        className="relative flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        <Bell className="w-5 h-5" strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 text-[10px] font-bold text-white bg-red-500 rounded-full flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            <button className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              Mark all read
            </button>
          </div>
          <div className="p-8 text-center">
            <Bell className="w-10 h-10 text-gray-300 mx-auto mb-3" strokeWidth={1.25} />
            <p className="text-sm font-medium text-gray-700">You're all caught up</p>
            <p className="text-xs text-gray-500 mt-1">
              Notifications about orders, drivers, and invoices will appear here.
            </p>
          </div>
          <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50">
            <p className="text-[11px] text-gray-500 text-center">
              Phase 5 — real-time alerts for your operations
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
