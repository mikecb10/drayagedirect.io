import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Settings } from 'lucide-react';
import TenantLayout from '../tenant/TenantLayout';
import { SETTINGS_SECTIONS, findGroupForPath, findItemForPath } from '../../lib/settings-nav';
import { PERMISSIONS, filterByPermissions } from '../../lib/permissions';
import { useAuth } from '../../contexts/AuthContext';
import SettingsViewToggle from './SettingsViewToggle';
import useSettingsViewPrefs from './useSettingsViewPrefs';

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
  const { viewMode } = useSettingsViewPrefs();

  const { role, permissions, loading: authLoading } = useAuth();
  const user = { role, permissions };

  const activeItem = findItemForPath(pathname);
  const pageRequired = activeItem?.requiredPermission ?? [PERMISSIONS.SETTINGS, PERMISSIONS.ALL];

  const filteredSections = SETTINGS_SECTIONS
    .map((section) => ({ ...section, items: filterByPermissions(section.items, user) }))
    .filter((section) => section.items.length > 0);

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
      requiredPermission={pageRequired}
    >
      {viewMode === 'card' ? (
        <CardModeShell pathname={pathname}>{children}</CardModeShell>
      ) : (
        <SidebarModeShell
          pathname={pathname}
          collapsed={collapsed}
          toggleGroup={toggleGroup}
          filteredSections={filteredSections}
          authLoading={authLoading}
        >
          {children}
        </SidebarModeShell>
      )}
    </TenantLayout>
  );
}

function SidebarModeShell({ pathname, collapsed, toggleGroup, filteredSections, authLoading, children }) {
  return (
    <div className="flex gap-0 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 min-h-[calc(100vh-64px)]">
      {/* Left sidebar */}
      <aside className="w-[180px] sm:w-[220px] lg:w-[260px] shrink-0 border-r border-gray-200 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-900/60">
        <div className="sticky top-0 overflow-y-auto max-h-screen">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-400 dark:text-slate-500" />
              <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Settings</h2>
            </div>
            <SettingsViewToggle />
          </div>

          {/* Nav groups */}
          <nav className="py-2">
            {authLoading ? (
              <SidebarSkeleton />
            ) : (
              filteredSections.map((section) => {
                const isCollapsed = !!collapsed[section.group];
                return (
                  <div key={section.group} className="mb-1">
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
              })
            )}
          </nav>
        </div>
      </aside>

      {/* Right content */}
      <main className="flex-1 min-w-0 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

function CardModeShell({ pathname, children }) {
  const isIndex = pathname === '/settings';
  const groupName = isIndex ? null : findGroupForPath(pathname);

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8 min-h-[calc(100vh-64px)]">
      {/* Top header row: breadcrumb (left) + view toggle (right) */}
      <div className="flex items-start justify-between mb-[var(--space-section)] gap-3">
        {!isIndex ? (
          <div className="flex items-center gap-2 text-helper text-muted">
            <Link href="/settings" className="flex items-center gap-1 hover:text-strong">
              <ArrowLeft className="w-3.5 h-3.5" />
              All Settings
            </Link>
            {groupName && groupName !== 'Coming Soon' && (
              <>
                <span aria-hidden="true">·</span>
                <span>{groupName}</span>
              </>
            )}
          </div>
        ) : (
          <div /> /* spacer so the toggle stays right-aligned on the index */
        )}
        <SettingsViewToggle />
      </div>

      {children}
    </main>
  );
}

function SidebarSkeleton() {
  return (
    <div className="px-5 py-2 space-y-5 animate-pulse" aria-label="Loading settings navigation">
      {[1, 2, 3].map((g) => (
        <div key={g}>
          <div className="h-3 w-20 bg-gray-200 dark:bg-slate-800 rounded mb-2" />
          <div className="space-y-1">
            <div className="h-7 w-full bg-gray-100 dark:bg-slate-800/60 rounded" />
            <div className="h-7 w-4/5 bg-gray-100 dark:bg-slate-800/60 rounded" />
            <div className="h-7 w-full bg-gray-100 dark:bg-slate-800/60 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
