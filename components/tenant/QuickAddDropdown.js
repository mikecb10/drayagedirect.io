import { useEffect, useRef, useState } from 'react';
import { Plus, ClipboardList, Users, Truck, UserPlus } from 'lucide-react';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';
import { PERMISSIONS } from '../../lib/permissions';

export default function QuickAddDropdown() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { hasPermission } = useAuth();
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

  const items = [
    {
      label: 'New Load',
      icon: ClipboardList,
      permission: [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
      href: '/dispatcher?new=1',
    },
    {
      label: 'New Organization',
      icon: Users,
      permission: [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
      href: '/organizations?new=1',
    },
    {
      label: 'New Driver',
      icon: Truck,
      permission: [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL],
      href: '/drivers?new=1',
    },
    {
      label: 'Invite User',
      icon: UserPlus,
      permission: [PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
      href: '/settings/team?invite=1',
    },
  ].filter((i) => hasPermission(i.permission));

  if (items.length === 0) return null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Quick add"
        className="flex items-center justify-center w-9 h-9 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
      >
        <Plus className="w-5 h-5" strokeWidth={2.5} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Quick Create
            </div>
          </div>
          <div className="py-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={() => {
                    setOpen(false);
                    router.push(item.href);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Icon className="w-4 h-4 text-gray-500" strokeWidth={1.75} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.comingSoon && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">
                      Soon
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
