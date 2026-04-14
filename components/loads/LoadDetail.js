import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Alert from '../ui/Alert';
import LoadDetailLayout from './LoadDetailLayout';
import LoadInfoTab from './tabs/LoadInfoTab';
import NotesTab from './tabs/NotesTab';
import AuditTab from './tabs/AuditTab';
import DocumentsTab from './tabs/DocumentsTab';
import BillingTab from './tabs/BillingTab';
import DriverPayTab from './tabs/DriverPayTab';
import RoutingTab from './tabs/RoutingTab';
import TrackingTab from './tabs/TrackingTab';
import PlaceholderTab from './tabs/PlaceholderTab';
import DuplicateLoadModal from './DuplicateLoadModal';
import { MessageSquare, CreditCard } from 'lucide-react';
import { useOverlay } from '../../contexts/OverlayContext';

/**
 * LoadDetail — Reusable load detail component.
 *
 * Works both inside an OverlayPanel (overlay mode) and as a standalone page.
 * When `onClose` is provided, it operates in overlay mode:
 *   - Tab changes use internal state (no URL updates)
 *   - Close/delete calls onClose instead of router.push
 *   - Prev/next loads update internal state (no navigation)
 */
export default function LoadDetail({ loadId: initialLoadId, initialTab = 'info', onClose }) {
  const router = useRouter();
  const { openOverlay } = useOverlay();
  const isOverlay = typeof onClose === 'function';

  const [currentLoadId, setCurrentLoadId] = useState(initialLoadId);
  const [load, setLoad] = useState(null);
  const [holds, setHolds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [copyModalOpen, setCopyModalOpen] = useState(false);

  async function loadData(id, silent = false) {
    if (!id) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/loads/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load');
      }
      const data = await res.json();
      setLoad(data.load);
      setHolds(data.holds || []);
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Load data when loadId changes
  useEffect(() => {
    loadData(currentLoadId, false);
  }, [currentLoadId]);

  // Sync if parent changes the loadId prop
  useEffect(() => {
    if (initialLoadId !== currentLoadId) {
      setCurrentLoadId(initialLoadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoadId]);

  async function handleSaved() {
    await loadData(currentLoadId, true);
  }

  async function handleDelete() {
    if (!confirm(`Delete load ${load.order_number}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/tenant/loads/${currentLoadId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      if (isOverlay) {
        onClose();
      } else {
        router.push('/dispatcher');
      }
    } catch (e) {
      setError(e.message);
    }
  }

  function handleClose() {
    if (isOverlay) {
      onClose();
    } else {
      router.push('/dispatcher');
    }
  }

  function handleNavigate(newLoadId) {
    if (isOverlay) {
      setCurrentLoadId(newLoadId);
      // Keep the URL in sync so refresh reopens the correct load
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('load', newLoadId);
        window.history.replaceState({}, '', url.pathname + '?' + url.searchParams.toString());
      }
    } else {
      // Standalone mode redirects to dispatcher overlay
      router.push(`/dispatcher?load=${newLoadId}&tab=${activeTab}`);
    }
  }

  function handleTabChange(tabId) {
    setActiveTab(tabId);
    // Sync the tab to the URL so refresh reopens the correct tab
    if (isOverlay) {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', tabId);
        window.history.replaceState({}, '', url.pathname + '?' + url.searchParams.toString());
      }
    } else {
      router.push(
        { pathname: router.pathname, query: { ...router.query, tab: tabId } },
        undefined,
        { shallow: true }
      );
    }
    // Silently refetch the load when switching tabs so each tab sees
    // up-to-date data. The previous tab may have edited fields that
    // affect what other tabs render (e.g. Load Info edits the prenote
    // values, which the Routing tab's RailCheckInSlip card needs).
    // We use silent: true to avoid the loading spinner flash.
    loadData(currentLoadId, true);
  }

  function handleDuplicateSuccess(copies) {
    setCopyModalOpen(false);
    if (copies.length === 1) {
      if (isOverlay) {
        // Open the new load in the same overlay by swapping ID
        setCurrentLoadId(copies[0].id);
        setActiveTab('info');
      } else {
        router.push(`/dispatcher?load=${copies[0].id}&tab=info`);
      }
    } else {
      if (isOverlay) {
        onClose();
      } else {
        router.push('/dispatcher');
      }
    }
  }

  return (
    <div>
      {error && <Alert type="error" message={error} />}

      {loading ? (
        <div className="py-20 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
        </div>
      ) : load ? (
        <LoadDetailLayout
          load={load}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onDelete={handleDelete}
          onCopy={() => setCopyModalOpen(true)}
          onClose={handleClose}
          onNavigate={handleNavigate}
        >
          {activeTab === 'info' && (
            <LoadInfoTab load={load} holds={holds} onSaved={handleSaved} />
          )}
          {activeTab === 'billing' && <BillingTab load={load} />}
          {activeTab === 'documents' && <DocumentsTab load={load} />}
          {activeTab === 'driver_pay' && <DriverPayTab load={load} />}
          {activeTab === 'routing' && <RoutingTab load={load} onLoadRefresh={() => loadData(currentLoadId, true)} />}
          {activeTab === 'tracking' && <TrackingTab load={load} />}
          {activeTab === 'communication' && (
            <PlaceholderTab
              title="Communication"
              description="Email and messaging history with customers, drivers, and terminals."
              icon={MessageSquare}
            />
          )}
          {activeTab === 'notes' && <NotesTab load={load} />}
          {activeTab === 'audit' && <AuditTab load={load} />}
          {activeTab === 'payments' && (
            <PlaceholderTab
              title="Payments"
              description="Payment history and open balance tracking."
              icon={CreditCard}
            />
          )}
        </LoadDetailLayout>
      ) : null}

      {load && (
        <DuplicateLoadModal
          isOpen={copyModalOpen}
          onClose={() => setCopyModalOpen(false)}
          load={load}
          onSuccess={handleDuplicateSuccess}
        />
      )}
    </div>
  );
}
