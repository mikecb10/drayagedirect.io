import { useRouter } from 'next/router';
import Link from 'next/link';
import { SETTINGS_SECTIONS, findGroupForPath } from '../../lib/settings-nav';
import useSettingsViewPrefs from './useSettingsViewPrefs';

/**
 * Self-aware intra-group sibling tab strip for settings pages.
 *
 * Reads the current pathname and view-mode prefs to decide whether to render.
 * In card mode it always renders. In sidebar mode it renders only when the
 * showTabsInSidebar pref is on. Returns null otherwise.
 *
 * When rendering, shows one tab per sibling page in the same group (excluding
 * the "Coming Soon" group). Current page's tab is marked active.
 *
 * Pages just call <SettingsTabs /> once near the top of their content; no
 * props needed. The component figures out the rest.
 */
export default function SettingsTabs({ className = '' }) {
  const router = useRouter();
  const pathname = router.pathname;
  const { viewMode, showTabsInSidebar } = useSettingsViewPrefs();

  // Decide whether to render at all
  const shouldRender =
    viewMode === 'card' || (viewMode === 'sidebar' && showTabsInSidebar);
  if (!shouldRender) return null;

  // Find the group for this path
  const groupName = findGroupForPath(pathname);
  if (!groupName || groupName === 'Coming Soon') return null;

  const section = SETTINGS_SECTIONS.find((s) => s.group === groupName);
  if (!section || section.items.length < 2) return null; // single-item groups don't need tabs

  return (
    <div
      className={`mb-[var(--space-section)] rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 inline-flex flex-wrap gap-1 ${className}`}
    >
      {section.items.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + '/');
        const baseClasses =
          'flex items-center gap-2 px-4 py-2 text-body font-medium rounded-lg transition-all';
        const stateClasses = isActive
          ? 'bg-blue-600 text-white shadow-sm'
          : 'text-muted hover:text-strong hover:bg-gray-100 dark:hover:bg-slate-800';
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`${baseClasses} ${stateClasses}`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
