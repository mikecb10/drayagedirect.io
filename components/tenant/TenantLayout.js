import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';
import { useCompactMode } from '../../contexts/CompactModeContext';
import { hasPermission } from '../../lib/permissions';
import TenantSidebar from './TenantSidebar';
import TopBar from './TopBar';

const SIDEBAR_STORAGE_KEY = 'dd.sidebar.collapsed';

export default function TenantLayout({ children, title, requiredPermission }) {
  const router = useRouter();
  const { user, profile, role, permissions, loading } = useAuth();
  const { isCompact } = useCompactMode();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // Restore sidebar collapsed state from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored === 'true') setCollapsed(true);
    } catch {}
    setReady(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }

  // Auth redirects
  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace('/login');
      return;
    }

    if (profile?.password_change_required && router.pathname !== '/change-password') {
      router.replace('/change-password');
      return;
    }
  }, [loading, user, profile, router]);

  const hasRequired =
    !requiredPermission || hasPermission({ role, permissions }, requiredPermission);

  if (loading || !user || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400" />
      </div>
    );
  }

  if (!hasRequired) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
        <TenantSidebar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className={`transition-all ${ready && collapsed ? 'lg:ml-16' : 'lg:ml-60'}`}>
          <TopBar title={title} onOpenMobileSidebar={() => setMobileOpen(true)} />
          <main className="p-4 lg:p-8">
            <div className="max-w-md mx-auto mt-20 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">Access restricted</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                You don't have permission to view this page. Contact your administrator if you believe this is a mistake.
              </p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950" {...(isCompact ? { 'data-compact': '' } : {})}>
      <TenantSidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className={`transition-all ${ready && collapsed ? 'lg:ml-16' : 'lg:ml-60'}`}>
        <TopBar title={title} onOpenMobileSidebar={() => setMobileOpen(true)} />
        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
