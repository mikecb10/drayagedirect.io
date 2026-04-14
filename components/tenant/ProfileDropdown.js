import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { User, Settings as SettingsIcon, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

function initials(name, email) {
  const source = name || email || '';
  const parts = source.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (source[0] || '?').toUpperCase();
}

export default function ProfileDropdown() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const { profile, role, signOut } = useAuth();

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

  if (!profile) return null;

  const displayName = profile.name || profile.email;
  const displayRole = (role || 'user').replace('_', ' ');

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg hover:bg-gray-100 pl-1.5 pr-2.5 py-1 transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold">
          {initials(profile.name, profile.email)}
        </div>
        <span className="hidden md:block text-sm font-medium text-gray-700 max-w-[120px] truncate">
          {displayName}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold shrink-0">
              {initials(profile.name, profile.email)}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">
                {displayName}
              </div>
              <div className="text-xs text-gray-500 truncate">{profile.email}</div>
              <div className="text-[10px] uppercase tracking-wide text-blue-600 font-semibold mt-0.5">
                {displayRole}
              </div>
            </div>
          </div>

          <div className="py-1">
            <Link
              href="/settings/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <User className="w-4 h-4 text-gray-500" strokeWidth={1.75} />
              My Profile
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <SettingsIcon className="w-4 h-4 text-gray-500" strokeWidth={1.75} />
              Settings
            </Link>
          </div>

          <div className="border-t border-gray-100 py-1">
            <button
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.75} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
