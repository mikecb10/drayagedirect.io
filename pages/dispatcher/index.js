import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Plus, Download, Columns3, Filter as FilterIcon, Rows3, Rows4, Trash2 } from 'lucide-react';
import TenantLayout from '../../components/tenant/TenantLayout';
import ModuleHeader from '../../components/ui/ModuleHeader';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import NewLoadModal from '../../components/loads/NewLoadModal';
import DispatcherBoard from '../../components/dispatcher/DispatcherBoard';
import BoardColumnsPanel from '../../components/dispatcher/BoardColumnsPanel';
import KpiStrip from '../../components/dispatcher/KpiStrip';
import DateFilterDropdown from '../../components/dispatcher/DateFilterDropdown';
import FilterSidebar from '../../components/dispatcher/FilterSidebar';
import BulkActionBar from '../../components/dispatcher/BulkActionBar';
import LiveIndicator from '../../components/dispatcher/LiveIndicator';
import PresenceAvatars from '../../components/dispatcher/PresenceAvatars';
import LiveCursorLayer from '../../components/dispatcher/LiveCursorLayer';
import useRealtimePresence from '../../hooks/useRealtimePresence';
import useLiveCursors from '../../hooks/useLiveCursors';
import { PERMISSIONS } from '../../lib/permissions';
import { getKpiFilterFn, isInDateRange } from '../../lib/kpi-engine';
import { useOverlay } from '../../contexts/OverlayContext';
import useRealtimeLoads from '../../hooks/useRealtimeLoads';

export default function DispatcherIndex() {
  const router = useRouter();
  const { openOverlay } = useOverlay();

  const [loads, setLoads] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [kpiFilter, setKpiFilter] = useState(null);
  const [dateFilter, setDateFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [columnsPanelOpen, setColumnsPanelOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const [preferences, setPreferences] = useState(null);
  const [tenantColors, setTenantColors] = useState(null);
  const [tenantSettings, setTenantSettings] = useState(null); // full settings (for feature flags)
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkFlash, setBulkFlash] = useState(null); // { message, kind }
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const saveTimerRef = useRef(null);
  const boardScrollRef = useRef(null); // scroll container for cursor tracking

  // Fetch preferences + tenant color settings on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      try {
        const [prefRes, settingsRes] = await Promise.all([
          fetch('/api/tenant/dispatcher-preferences'),
          fetch('/api/tenant/settings'),
        ]);
        if (prefRes.ok) {
          const data = await prefRes.json();
          if (!cancelled) setPreferences(data.preferences);
        }
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          if (!cancelled) {
            setTenantColors({
              state_colors: data.settings?.state_colors || {},
              load_type_colors: data.settings?.load_type_colors || {},
            });
            setTenantSettings(data.settings || {});
          }
        }
      } catch {
        // Ignore — board will render with defaults
      }
    }
    fetchAll();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch loads whenever filters change
  async function fetchLoads({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (dateFilter) params.set('date_filter', dateFilter);
      for (const [k, v] of Object.entries(filters)) {
        if (v !== '' && v != null) params.set(k, v);
      }
      const res = await fetch(`/api/tenant/loads?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load dispatcher');
      }
      const data = await res.json();
      setLoads(data.loads || []);
      setStats(data.stats || {});
      setLastFetchedAt(Date.now()); // NEW — update timestamp on success
      // Store pending doc order IDs for the "Pending Docs" KPI card filter
      if (data.pendingDocOrderIds) {
        sessionStorage.setItem('dd.pendingDocIds', JSON.stringify(data.pendingDocOrderIds));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLoads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters, dateFilter]);

  useEffect(() => {
    if (router.query.new === '1') setModalOpen(true);
  }, [router.query.new]);

  // URL persistence: if ?load=uuid is in the URL, auto-open that load.
  // This lets users refresh the page without losing the open load, and
  // also allows sharing direct links to a specific load.
  // The small delay ensures the OverlayProvider + OverlayRenderer are
  // fully mounted after hydration before we push to the stack — without
  // it, the load sometimes renders as a full page instead of a popup.
  useEffect(() => {
    if (!router.isReady) return;
    const loadId = router.query.load;
    if (loadId && typeof loadId === 'string') {
      const tab = router.query.tab || 'info';
      const timer = setTimeout(() => {
        openOverlay('load', {
          loadId,
          tab,
          // Silent refetch on close so the board reflects any edits made
          // inside the overlay (status, driver, dates) without flashing.
          onClose: () => fetchLoads({ silent: true }),
        });
      }, 150);
      return () => clearTimeout(timer);
    }
    // Only run on initial mount — not on every query change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  // Save preferences with 500ms debounce
  function updatePreferences(next) {
    setPreferences(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch('/api/tenant/dispatcher-preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            column_order: next.column_order,
            hidden_columns: next.hidden_columns,
            frozen_columns: next.frozen_columns,
            row_density: next.row_density,
            saved_filters: next.saved_filters,
          }),
        });
      } catch {
        // Best-effort; next update will retry
      }
    }, 500);
  }

  // Surgically refresh a single load row in place (no full board re-render)
  async function refreshSingleLoad(loadId) {
    try {
      const res = await fetch(`/api/tenant/loads/${loadId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.load) {
        setLoads((prev) => prev.map((l) => (l.id === loadId ? { ...l, ...data.load } : l)));
      }
    } catch {}
  }

  // Highlight a row briefly to show it was just updated by another user
  const [flashingIds, setFlashingIds] = useState(() => new Set());
  function flashRow(loadId) {
    setFlashingIds((prev) => {
      const next = new Set(prev);
      next.add(loadId);
      return next;
    });
    setTimeout(() => {
      setFlashingIds((prev) => {
        const next = new Set(prev);
        next.delete(loadId);
        return next;
      });
    }, 1500);
  }

  // ===== Supabase Realtime — live multi-dispatcher sync =====
  // Realtime payloads are raw columns (no joins), so UPDATE/INSERT calls
  // refreshSingleLoad to pull the joined customer/driver/etc. data.
  // This is still surgical — only one row re-renders.
  const { markSelfEdit, connectedRef: realtimeConnectedRef } = useRealtimeLoads({
    enabled: true,
    onInsert: async (row) => {
      // Fetch full joined data and prepend to the board
      try {
        const res = await fetch(`/api/tenant/loads/${row.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.load) {
          setLoads((prev) => {
            if (prev.some((l) => l.id === row.id)) return prev; // already present
            return [data.load, ...prev];
          });
          flashRow(row.id);
        }
      } catch {}
    },
    onUpdate: async (row) => {
      // Only refresh if this load is currently on the board
      setLoads((prev) => {
        if (!prev.some((l) => l.id === row.id)) return prev;
        return prev; // no-op, just checking
      });
      // Refresh joined data in background
      await refreshSingleLoad(row.id);
      flashRow(row.id);
    },
    onDelete: (loadId) => {
      setLoads((prev) => prev.filter((l) => l.id !== loadId));
    },
  });

  // ===== Live Presence + Cursors (gated on tenant setting) =====
  // Default to enabled; flip off if tenant admin explicitly disabled it.
  const livePresenceEnabled = tenantSettings?.live_presence_enabled !== false;

  const {
    users: presenceUsers,
    channelRef: presenceChannelRef,
    channelReady: presenceReady,
    tabId: presenceTabId,
  } = useRealtimePresence({
    enabled: livePresenceEnabled,
    room: 'dispatcher',
  });

  const { cursors: liveCursors } = useLiveCursors({
    enabled: livePresenceEnabled,
    channelRef: presenceChannelRef,
    channelReady: presenceReady,
    tabId: presenceTabId,
    scrollContainerRef: boardScrollRef,
    users: presenceUsers,
  });

  // Called when a user edits a cell on the board.
  // Optimistically updates local state, then PUTs the patch to the API.
  async function handleCellSave(loadId, patch) {
    // Tell realtime hook to ignore the echo for this load
    markSelfEdit(loadId);

    // Optimistic update: apply the patch to the loaded row immediately
    setLoads((prev) =>
      prev.map((l) => {
        if (l.id !== loadId) return l;
        const next = { ...l, ...patch };
        // If caller cleared an FK snapshot, also clear the joined object
        if ('customer_id' in patch && !patch.customer_id) next.customer = null;
        if ('pickup_location_id' in patch && !patch.pickup_location_id) next.pickup_org = null;
        if ('delivery_location_id' in patch && !patch.delivery_location_id) next.delivery_org = null;
        if ('return_location_id' in patch && !patch.return_location_id) next.return_org = null;
        if ('driver_id' in patch && !patch.driver_id) next.driver = null;
        return next;
      })
    );

    const res = await fetch(`/api/tenant/loads/${loadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      // Revert by refetching just this row
      await refreshSingleLoad(loadId);
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to save');
    }

    // If an FK was assigned (not cleared), refresh just this single row
    // in the background so the joined object (driver, customer, etc.) is fresh.
    // No full fetchLoads — that caused the whole board to flash.
    const assignedFK =
      ('driver_id' in patch && patch.driver_id) ||
      ('customer_id' in patch && patch.customer_id) ||
      ('pickup_location_id' in patch && patch.pickup_location_id) ||
      ('delivery_location_id' in patch && patch.delivery_location_id) ||
      ('return_location_id' in patch && patch.return_location_id);
    if (assignedFK) {
      refreshSingleLoad(loadId);
    }
  }

  // ===== Driver dispatch/remove handlers =====

  async function handleDispatchDriver(loadId) {
    markSelfEdit(loadId);
    // Optimistic update — no flash
    const now = new Date().toISOString();
    setLoads((prev) =>
      prev.map((l) => (l.id === loadId ? { ...l, status: 'dispatched', dispatched_at: now } : l))
    );

    try {
      const res = await fetch(`/api/tenant/loads/${loadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispatched_at: now, status: 'dispatched' }),
      });
      if (!res.ok) throw new Error('Failed to dispatch');

      // Open the load's routing tab so dispatcher can verify
      const openRouting = preferences?.open_routing_on_dispatch !== false; // default: true
      if (openRouting) {
        openLoadOverlay(loadId, 'routing');
      }
    } catch {
      // Revert on failure
      refreshSingleLoad(loadId);
    }
  }

  async function handleRemoveDriver(loadId) {
    // Defensive guard: if this load has ANY routing event with an arrived_at
    // timestamp, the driver is already en route and should not be removable
    // from the board. The red X is already hidden in that case (see
    // lib/dispatcher-columns.js), but this guard also catches stale clicks
    // from race conditions or optimistic state that hasn't refetched yet.
    const load = loads.find((l) => l.id === loadId);
    const hasStartedMove = (load?.routing_events || []).some((e) => e.arrived_at);
    if (hasStartedMove) {
      setError(
        'Cannot remove driver — this load has already started. Clear the routing event timestamps first if you need to reassign.'
      );
      return;
    }

    markSelfEdit(loadId);
    // Optimistic update — no flash
    setLoads((prev) =>
      prev.map((l) =>
        l.id === loadId
          ? { ...l, driver_id: null, driver: null, dispatched_at: null, status: l.status === 'dispatched' ? 'available' : l.status }
          : l
      )
    );

    try {
      const res = await fetch(`/api/tenant/loads/${loadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: null, dispatched_at: null }),
      });
      if (!res.ok) throw new Error('Failed to remove driver');
    } catch {
      // Revert on failure
      refreshSingleLoad(loadId);
    }
  }

  // Board lifecycle filter: completed/cancelled loads fall off the dispatcher
  // board after their finish day. They only appear on the board if
  // actual_delivery_at === today (so the "Finished Today" KPI can still see
  // them). After today, they're gone — billing picks them up from /ar.
  //
  // This is board-specific — billing / AR pages query /api/tenant/loads with
  // their own scoping and are unaffected.
  function passesLifecycleFilter(load) {
    if (!['completed', 'cancelled'].includes(load.status)) return true;
    // Completed/cancelled — keep only if finished today.
    return isInDateRange(load.actual_delivery_at, 'today');
  }

  // Date filter: check if ANY of the load's key dates match the selected filter.
  // This makes the date dropdown actually filter the board, not just KPI stats.
  //
  // Must include appointment windows (pickup_apt_from/to, delivery_apt_from/to,
  // return_apt_from/to) in addition to base dates — otherwise a load with only
  // appointment dates set (no pickup_date / delivery_date / etc.) gets filtered
  // out here before KPI card predicates can evaluate it, producing the symptom
  // where a KPI card counts N loads but clicking the card shows an empty board.
  function applyDateFilter(loadList) {
    if (!dateFilter || dateFilter === 'all') return loadList;
    return loadList.filter((load) =>
      // Base dates
      isInDateRange(load.pickup_date, dateFilter) ||
      isInDateRange(load.delivery_date, dateFilter) ||
      isInDateRange(load.ready_to_return_date, dateFilter) ||
      isInDateRange(load.last_free_day, dateFilter) ||
      isInDateRange(load.cutoff_date, dateFilter) ||
      isInDateRange(load.per_diem_free_day, dateFilter) ||
      // Appointment windows — KPI cards count loads via these, so the
      // board-level filter must include them too.
      isInDateRange(load.pickup_apt_from, dateFilter) ||
      isInDateRange(load.pickup_apt_to, dateFilter) ||
      isInDateRange(load.delivery_apt_from, dateFilter) ||
      isInDateRange(load.delivery_apt_to, dateFilter) ||
      isInDateRange(load.return_apt_from, dateFilter) ||
      isInDateRange(load.return_apt_to, dateFilter)
    );
  }

  // Apply KPI filter to loads — handles both standard filters from kpi-engine
  // AND the special "pending_docs" filter that uses pendingDocOrderIds.
  // Lifecycle filter applies ALWAYS (regardless of KPI card). Date filter is
  // applied next, then KPI filter narrows further.
  function applyKpiFilter(loadList) {
    let filtered = loadList.filter(passesLifecycleFilter);
    filtered = applyDateFilter(filtered);
    if (!kpiFilter) return filtered;
    if (kpiFilter === 'pending_docs') {
      try {
        const ids = JSON.parse(sessionStorage.getItem('dd.pendingDocIds') || '[]');
        const idSet = new Set(ids);
        return filtered.filter((l) => idSet.has(l.id));
      } catch {
        return filtered;
      }
    }
    return filtered.filter(getKpiFilterFn(kpiFilter, dateFilter));
  }

  // Helper: open a load overlay AND sync the URL so refresh preserves it.
  // Uses window.history directly (not router.replace) to avoid triggering
  // any Next.js re-renders that could reset the overlay stack.
  function openLoadOverlay(loadId, tab = 'info') {
    const displayedLoads = applyKpiFilter(loads);
    sessionStorage.setItem('dd.loadIds', JSON.stringify(displayedLoads.map((l) => l.id)));
    openOverlay('load', {
      loadId,
      tab,
      // Silent refetch on close so the board reflects any edits made
      // inside the overlay (status, driver, dates) without flashing.
      onClose: () => fetchLoads({ silent: true }),
    });
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('load', loadId);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.pathname + '?' + url.searchParams.toString());
    }
  }

  // Handle clicks on dispatch/remove/open buttons in the board (event delegation)
  function handleBoardClick(e) {
    // Open load (from Load # column or expand icon)
    const openBtn = e.target.closest('[data-open-load]');
    if (openBtn) {
      e.stopPropagation();
      const loadId = openBtn.getAttribute('data-load-id');
      if (loadId) {
        openLoadOverlay(loadId, 'info');
      }
      return;
    }
    // Dispatch driver
    const dispatchBtn = e.target.closest('[data-dispatch]');
    if (dispatchBtn) {
      e.stopPropagation();
      const loadId = dispatchBtn.getAttribute('data-load-id');
      if (loadId) handleDispatchDriver(loadId);
      return;
    }
    // Remove driver
    const removeBtn = e.target.closest('[data-remove-driver]');
    if (removeBtn) {
      e.stopPropagation();
      const loadId = removeBtn.getAttribute('data-load-id');
      if (loadId) handleRemoveDriver(loadId);
      return;
    }
  }

  // ===== Bulk selection handlers =====

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids, selected) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        ids.forEach((id) => next.add(id));
      } else {
        ids.forEach((id) => next.delete(id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function applyBulkPatch(patch) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const res = await fetch('/api/tenant/loads/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ load_ids: ids, patch }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Bulk update failed');
      }
      const data = await res.json();
      showBulkFlash(`Updated ${data.updated} load${data.updated === 1 ? '' : 's'}`);
      await fetchLoads();
    } catch (e) {
      showBulkFlash(e.message, 'error');
    }
  }

  function showBulkFlash(message, kind = 'success') {
    setBulkFlash({ message, kind });
    setTimeout(() => setBulkFlash(null), 2500);
  }

  function handleNewLoadSuccess(newLoad) {
    setModalOpen(false);
    if (router.query.new) {
      router.replace('/dispatcher', undefined, { shallow: true });
    }
    if (newLoad?.id) openLoadOverlay(newLoad.id, 'info');
  }

  function toggleDensity() {
    const next = preferences?.row_density === 'compact' ? 'comfortable' : 'compact';
    updatePreferences({ ...preferences, row_density: next });
  }

  return (
    <TenantLayout
      title="Dispatcher"
      requiredPermission={[PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL]}
    >
      <div className="space-y-4 min-h-[calc(100vh-80px)]">
        <ModuleHeader
          title="Dispatcher"
          description="Drag column headers to reorder · right-edge drag to resize · 3-dot menu to pin or hide"
          actions={
            <>
              <LiveIndicator connectedRef={realtimeConnectedRef} lastFetchedAt={lastFetchedAt} />
              {livePresenceEnabled && <PresenceAvatars users={presenceUsers} />}
              <Button variant="secondary" onClick={toggleDensity} title="Toggle row density">
                {preferences?.row_density === 'compact' ? (
                  <Rows4 className="w-4 h-4 inline -mt-0.5" strokeWidth={2} />
                ) : (
                  <Rows3 className="w-4 h-4 inline -mt-0.5" strokeWidth={2} />
                )}
              </Button>
              <Button variant="secondary" onClick={() => setColumnsPanelOpen(true)}>
                <Columns3 className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                Columns
              </Button>
              <Button variant="secondary" onClick={() => setFilterPanelOpen(true)}>
                <FilterIcon className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                Filters
                {Object.keys(filters).length > 0 && (
                  <span className="ml-1.5 text-[10px] bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                    {Object.keys(filters).length}
                  </span>
                )}
              </Button>
              <Button variant="secondary">
                <Download className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                Export
              </Button>
              <Button variant="secondary" onClick={() => router.push('/dispatcher/deleted')}>
                <Trash2 className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                Trash
              </Button>
              <Button onClick={() => setModalOpen(true)}>
                <Plus className="w-4 h-4 mr-1 inline -mt-0.5" strokeWidth={2.5} />
                New Load
              </Button>
            </>
          }
        />

        {/* Date filter + KPI strip */}
        <div className="space-y-3">
          <DateFilterDropdown value={dateFilter} onChange={setDateFilter} />
          <KpiStrip stats={stats} activeKey={kpiFilter} onSelect={setKpiFilter} />
        </div>

        {/* Search bar */}
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by load #, container #, BOL, booking..."
            className="flex-1 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
          />
        </div>

        {error && <Alert type="error" message={error} />}

        {/* Board — apply KPI filter client-side */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions */}
        <div onClick={handleBoardClick}>
        <DispatcherBoard
          loads={applyKpiFilter(loads)}
          loading={loading}
          preferences={preferences}
          onPreferencesChange={updatePreferences}
          onCellSave={handleCellSave}
          tenantColors={tenantColors}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          flashingIds={flashingIds}
          scrollContainerRef={boardScrollRef}
          cursorLayer={livePresenceEnabled ? <LiveCursorLayer cursors={liveCursors} /> : null}
        />

        {/* Spacer so rows aren't hidden behind the bulk action bar */}
        {selectedIds.size > 0 && <div className="h-20" />}
        </div>
      </div>

      <NewLoadModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          if (router.query.new) {
            router.replace('/dispatcher', undefined, { shallow: true });
          }
        }}
        onSuccess={handleNewLoadSuccess}
      />

      <BoardColumnsPanel
        isOpen={columnsPanelOpen}
        onClose={() => setColumnsPanelOpen(false)}
        preferences={preferences}
        onChange={updatePreferences}
      />

      <FilterSidebar
        isOpen={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        filters={filters}
        onApply={(f) => setFilters(f)}
      />

      {/* Floating bulk action bar */}
      <BulkActionBar
        selectedIds={selectedIds}
        loads={loads}
        onApply={applyBulkPatch}
        onClear={clearSelection}
        onFlash={showBulkFlash}
      />

      {/* Bulk operation toast */}
      {bulkFlash && (
        <div
          className={`fixed bottom-28 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
            bulkFlash.kind === 'error'
              ? 'bg-red-600 text-white'
              : bulkFlash.kind === 'info'
                ? 'bg-slate-700 text-white'
                : 'bg-green-600 text-white'
          }`}
        >
          {bulkFlash.message}
        </div>
      )}
    </TenantLayout>
  );
}
