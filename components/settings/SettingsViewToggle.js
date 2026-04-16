import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, LayoutGrid, SidebarOpen } from 'lucide-react';
import useSettingsViewPrefs from './useSettingsViewPrefs';

/**
 * "View ⇣" dropdown for settings nav preferences. Two controls:
 *   - Layout: radio between Sidebar view and Card view
 *   - Show sibling tabs: checkbox; disabled (forced-on) when Card view
 *     is selected, since tabs are mandatory in card mode
 *
 * Self-contained — reads/writes prefs via useSettingsViewPrefs. Closes
 * on outside click. No props required.
 *
 * The dropdown panel is rendered into document.body via a portal so it can
 * escape `overflow-y-auto`/`overflow-hidden` ancestors (e.g. the sticky
 * sidebar shell). Position is computed from the trigger's bounding rect.
 */
export default function SettingsViewToggle({ className = '' }) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState(null); // { top, right }
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const { viewMode, showTabsInSidebar, setViewMode, setShowTabsInSidebar } =
    useSettingsViewPrefs();

  // Close on outside click (covers both trigger and the portaled panel)
  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Recompute panel position when opened or on viewport changes
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    function update() {
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelPos({
        top: rect.bottom + 4, // 4px gap below trigger
        right: window.innerWidth - rect.right,
      });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true); // capture phase to catch nested scrollers
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const tabsForcedOn = viewMode === 'card';

  const panel = open && panelPos && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: panelPos.top, right: panelPos.right }}
          className="w-64 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg p-3 z-[60]"
        >
          {/* Layout radios */}
          <div className="text-field-label text-muted mb-[var(--space-field-label)]">Layout</div>
          <div className="space-y-1 mb-3">
            <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-gray-50 dark:hover:bg-slate-800/60">
              <input
                type="radio"
                name="dd-settings-view-mode"
                checked={viewMode === 'sidebar'}
                onChange={() => setViewMode('sidebar')}
                className="text-blue-600"
              />
              <SidebarOpen className="w-4 h-4 text-muted" />
              <span className="text-body text-strong">Sidebar view</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-gray-50 dark:hover:bg-slate-800/60">
              <input
                type="radio"
                name="dd-settings-view-mode"
                checked={viewMode === 'card'}
                onChange={() => setViewMode('card')}
                className="text-blue-600"
              />
              <LayoutGrid className="w-4 h-4 text-muted" />
              <span className="text-body text-strong">Card view</span>
            </label>
          </div>

          <div className="border-t border-gray-100 dark:border-slate-800 pt-3">
            <label
              className={`flex items-center gap-2 p-1.5 rounded ${
                tabsForcedOn ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/60'
              }`}
            >
              <input
                type="checkbox"
                checked={tabsForcedOn || showTabsInSidebar}
                disabled={tabsForcedOn}
                onChange={(e) => setShowTabsInSidebar(e.target.checked)}
                className="text-blue-600"
              />
              <span className="text-body text-strong">Show sibling tabs</span>
            </label>
            {tabsForcedOn && (
              <p className="text-helper text-muted mt-[var(--space-field-helper)] pl-7">
                Always shown in card view.
              </p>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-helper text-muted hover:text-strong px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
      >
        View
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {panel}
    </div>
  );
}
