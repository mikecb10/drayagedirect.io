import { useEffect } from 'react';

/**
 * Horizontal sub-tab navigation bar — visually distinct with a card background
 * and pill-style active indicator. Sits below the page title, above content.
 *
 * Keyboard: Ctrl+Left/Right cycles through tabs (skips when typing in inputs).
 *
 * Usage:
 *   <SubTabs
 *     tabs={[
 *       { id: 'organizations', label: 'Organizations', count: 60 },
 *       { id: 'people',        label: 'People' },
 *     ]}
 *     active="organizations"
 *     onChange={setActive}
 *   />
 */
export default function SubTabs({ tabs = [], active, onChange, className = '' }) {
  // Ctrl+Arrow keyboard navigation
  useEffect(() => {
    function handleKeyDown(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      // Skip if user is typing in an input
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
    <div className={`rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 inline-flex gap-1 ${className}`}>
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange?.(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              isActive
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-800'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count !== null && (
              <span
                className={`text-xs rounded-full px-2 py-0.5 ${
                  isActive
                    ? 'bg-blue-500 text-blue-100'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
