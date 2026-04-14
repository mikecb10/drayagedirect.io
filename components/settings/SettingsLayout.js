import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ChevronDown, Settings } from 'lucide-react';
import TenantLayout from '../tenant/TenantLayout';
import { SETTINGS_SECTIONS, findGroupForPath } from '../../lib/settings-nav';
import { PERMISSIONS } from '../../lib/permissions';

const STORAGE_KEY = 'dd.settings.collapsed';

function loadCollapsed() {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCollapsed(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

/**
 * SettingsLayout — PortPro-style two-column settings shell.
 *
 * Left:  sticky sidebar with collapsible grouped navigation
 * Right: settings page content (children)
 *
 * Wraps TenantLayout so the main sidebar (Dispatcher, Orgs, etc) stays intact.
 * The settings sidebar is a second-level navigation inside the content area.
 */
export default function SettingsLayout({ title, children }) {
  const router = useRouter();
  const pathname = router.pathname;
  const activeGroup = findGroupForPath(pathname);

  const [collapsed, setCollapsed] = useState(() => loadCollapsed());

  // Auto-expand the group containing the active page
  useEffect(() => {
    if (activeGroup && collapsed[activeGroup]) {
      setCollapsed((c) => {
        const next = { ...c, [activeGroup]: false };
        saveCollapsed(next);
        return next;
      });
    }
  }, [activeGroup]);

  function toggleGroup(group) {
    setCollapsed((c) => {
      const next = { ...c, [group]: !c[group] };
      saveCollapsed(next);
      return next;
    });
  }

  return (
    <TenantLayout
      title={title || 'Settings'}
      requiredPermission={[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]}
    >
      <div className="flex gap-0 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 min-h-[calc(100vh-64px)]">
        {/* Left sidebar */}
        <aside className="w-[180px] sm:w-[220px] lg:w-[260px] shrink-0 border-r border-gray-200 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-900/60">
          <div className="sticky top-0 overflow-y-auto max-h-screen">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-gray-400 dark:text-slate-500" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Settings</h2>
              </div>
            </div>

            {/* Nav groups */}
            <nav className="py-2">
              {SETTINGS_SECTIONS.map((section) => {
                const isCollapsed = !!collapsed[section.group];
                return (
                  <div key={section.group} className="mb-1">
                    {/* Group header */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(section.group)}
                      className="w-full flex items-center justify-between px-5 py-2 text-[11px] uppercase tracking-wider font-semibold text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
                    >
                      {section.group}
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform ${
                          isCollapsed ? '-rotate-90' : ''
                        }`}
                      />
                    </button>

                    {/* Items */}
                    {!isCollapsed && (
                      <div className="space-y-0.5 pb-1">
                        {section.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                          return (
                            <Link
                              key={item.key}
                              href={item.href}
                              className={`flex items-center gap-2.5 px-5 py-2 text-sm transition-colors ${
                                isActive
                                  ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium border-r-2 border-blue-600 dark:border-blue-400'
                                  : item.comingSoon
                                    ? 'text-gray-400 dark:text-slate-500 hover:text-gray-500 dark:hover:text-slate-400 hover:bg-gray-100/60 dark:hover:bg-slate-800/60'
                                    : 'text-gray-700 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100/60 dark:hover:bg-slate-800/60'
                              }`}
                            >
                              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-slate-500'}`} />
                              <span className="truncate">{item.label}</span>
                              {item.comingSoon && (
                                <span className="ml-auto text-[9px] uppercase tracking-wide font-semibold bg-gray-200 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded shrink-0">
                                  Soon
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Mobile nav — select dropdown */}
        <div className="hidden w-full px-4 pt-4 pb-2 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <select
            value={pathname}
            onChange={(e) => router.push(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          >
            {SETTINGS_SECTIONS.map((section) => (
              <optgroup key={section.group} label={section.group}>
                {section.items.map((item) => (
                  <option key={item.key} value={item.href}>
                    {item.label} {item.comingSoon ? '(Soon)' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Right content */}
        <main className="flex-1 min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </TenantLayout>
  );
}
