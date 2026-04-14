import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  FileText,
  Receipt,
  FolderOpen,
  Wallet,
  Route,
  MapPin,
  MessageSquare,
  StickyNote,
  History,
  CreditCard,
  Printer,
  Copy,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import DetailTabs from '../ui/DetailTabs';
import LoadSidebar from './LoadSidebar';
import LoadStatusBadge from '../ui/LoadStatusBadge';

const TABS = [
  { id: 'info', label: 'Load Info', icon: FileText },
  { id: 'billing', label: 'Billing', icon: Receipt },
  { id: 'documents', label: 'Documents', icon: FolderOpen },
  { id: 'payments', label: 'Payments & Credits', icon: CreditCard },
  { id: 'routing', label: 'Routing', icon: Route },
  { id: 'driver_pay', label: 'Driver Pay', icon: Wallet },
  { id: 'tracking', label: 'Tracking', icon: MapPin },
  { id: 'communication', label: 'Messaging', icon: MessageSquare },
  { id: 'audit', label: 'Audit', icon: History },
  { id: 'notes', label: 'Notes', icon: StickyNote },
];

/**
 * LoadDetailLayout — PortPro-style two-column layout for the Load Detail page.
 *
 * - Sticky top bar with Load # + status badge (left) and action icons (right)
 * - Fixed-width left sidebar (LoadSidebar) with all load metadata
 * - Right pane with tabs at top and tab content below
 *
 * The sidebar is sticky within its column so it stays visible while scrolling
 * long tab content (routing with many moves, audit log, etc).
 */
export default function LoadDetailLayout({ load, children, activeTab, onTabChange, onDelete, onCopy, onClose: onCloseProp, onNavigate }) {
  const router = useRouter();

  // Load navigation — prev/next from the dispatcher board's load list
  function getAdjacentLoadId(direction) {
    try {
      const ids = JSON.parse(sessionStorage.getItem('dd.loadIds') || '[]');
      if (ids.length === 0) return null;
      const idx = ids.indexOf(load?.id);
      if (idx === -1) return null;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= ids.length) return null;
      return ids[nextIdx];
    } catch {
      return null;
    }
  }

  const prevLoadId = getAdjacentLoadId(-1);
  const nextLoadId = getAdjacentLoadId(1);

  // Keyboard shortcuts:
  //   Ctrl + ← / → = prev/next tab (horizontal movement between tabs)
  //   Ctrl + ↑ / ↓ = prev/next load (vertical movement between loads)
  useEffect(() => {
    function handleKeyDown(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      // Don't intercept when user is typing in an input/textarea/select
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const currentIdx = TABS.findIndex((t) => t.id === activeTab);
        if (currentIdx === -1) return;
        const nextIdx =
          e.key === 'ArrowLeft'
            ? (currentIdx - 1 + TABS.length) % TABS.length
            : (currentIdx + 1) % TABS.length;
        handleTabChange(TABS[nextIdx].id);
      }

      if (e.key === 'ArrowUp' && prevLoadId) {
        e.preventDefault();
        if (onNavigate) onNavigate(prevLoadId);
      }
      if (e.key === 'ArrowDown' && nextLoadId) {
        e.preventDefault();
        if (onNavigate) onNavigate(nextLoadId);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  function handleTabChange(id) {
    if (onTabChange) {
      onTabChange(id);
    } else {
      router.push(
        { pathname: router.pathname, query: { ...router.query, tab: id } },
        undefined,
        { shallow: true }
      );
    }
  }

  function handleClose() {
    if (onCloseProp) {
      onCloseProp();
    } else {
      router.push('/dispatcher');
    }
  }

  return (
    <div className="-mx-4 -mt-4 md:-mx-6 md:-mt-6">
      {/* Top bar — sticky */}
      <div className="sticky top-0 z-20 border-b border-gray-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 md:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-base md:text-lg font-semibold text-gray-900 dark:text-slate-100 truncate">
            Load #: <span className="font-mono text-blue-600 dark:text-blue-400">{load?.order_number}</span>
          </h1>
          {load?.status && <LoadStatusBadge status={load.status} />}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => window.print()}
            className="p-1.5 rounded-md text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800"
            title="Print"
          >
            <Printer className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(window.location.href)}
            className="p-1.5 rounded-md text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800"
            title="Copy link"
          >
            <Copy className="w-4 h-4" />
          </button>
          {onCopy && (
            <button
              type="button"
              onClick={onCopy}
              className="p-1.5 rounded-md text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
              title="Duplicate load"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 rounded-md text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
              title="Delete load"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <div className="w-px h-5 bg-gray-200 dark:bg-slate-700 mx-1" />
          <button
            type="button"
            onClick={() => prevLoadId && (onNavigate ? onNavigate(prevLoadId) : router.push(`/dispatcher?load=${prevLoadId}&tab=${activeTab}`))}
            disabled={!prevLoadId}
            className={`p-1.5 rounded-md transition-colors ${prevLoadId ? 'text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800' : 'text-gray-200 dark:text-slate-700 cursor-not-allowed'}`}
            title={prevLoadId ? 'Previous load' : 'No previous load'}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => nextLoadId && (onNavigate ? onNavigate(nextLoadId) : router.push(`/dispatcher?load=${nextLoadId}&tab=${activeTab}`))}
            disabled={!nextLoadId}
            className={`p-1.5 rounded-md transition-colors ${nextLoadId ? 'text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800' : 'text-gray-200 dark:text-slate-700 cursor-not-allowed'}`}
            title={nextLoadId ? 'Next load' : 'No next load'}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="ml-1 inline-flex items-center gap-1 rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
            Close
          </button>
        </div>
      </div>

      {/* Body — sidebar + tab pane (darker bg makes white cards pop) */}
      <div className="px-4 md:px-6 py-4 flex flex-col md:flex-row gap-5 items-start bg-gray-100/60 dark:bg-slate-950/60">
        <div className="w-full md:w-[280px] md:shrink-0 md:sticky md:top-[64px] md:max-h-[calc(100vh-80px)] md:overflow-y-auto pr-1">
          <LoadSidebar key={`${load?.id}-${load?.container_size}-${load?.container_number}-${load?.customer_id}-${load?.status}`} load={load} />
        </div>
        <div className="flex-1 min-w-0 w-full">
          <DetailTabs tabs={TABS} active={activeTab} onChange={handleTabChange} />
          <div className="pt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export { TABS };
