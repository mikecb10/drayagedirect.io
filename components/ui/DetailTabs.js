import { useEffect } from 'react';

/**
 * Tab bar for detail pages (load detail, driver detail, etc).
 * Pill-style active indicator inside a card container.
 *
 * Keyboard: Ctrl+Left/Right cycles through tabs (skips when typing in inputs).
 *
 * Usage:
 *   <DetailTabs
 *     tabs={[
 *       { id: 'driver',      label: 'Driver',      icon: User },
 *       { id: 'preferences', label: 'Preferences', icon: Sliders },
 *     ]}
 *     active="driver"
 *     onChange={setActive}
 *   />
 */
export default function DetailTabs({ tabs = [], active, onChange, className = '' }) {
  // Ctrl+Arrow keyboard navigation
  useEffect(() => {
    function handleKeyDown(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      e.preventDefault();
      const currentIdx = tabs.findIndex((t) => t.id === active);
      if (currentIdx === -1) return;

      let nextIdx;
      if (e.key === 'ArrowRight') {
        nextIdx = (currentIdx + 1) % tabs.length;
      } else {
        nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
      }
      onChange?.(tabs[nextIdx].id);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [tabs, active, onChange]);
  return (
    <div className={`rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 flex gap-1 overflow-x-auto ${className}`}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange?.(tab.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium whitespace-nowrap rounded-lg transition-all shrink-0 ${
              isActive
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-800'
            }`}
          >
            {Icon && <Icon className={`w-4 h-4 ${isActive ? 'text-blue-200' : ''}`} strokeWidth={1.75} />}
            {tab.label}
            {tab.badge && (
              <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                isActive ? 'bg-blue-500 text-blue-100' : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
