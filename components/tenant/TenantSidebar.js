import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { NAV_ITEMS, SETTINGS_NAV } from '../../lib/tenant-nav';
import { filterByPermissions } from '../../lib/permissions';

export default function TenantSidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileClose,
}) {
  const router = useRouter();
  const { role, permissions, branding, user: authUser } = useAuth();
  const user = { role, permissions };
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [badgeCounts, setBadgeCounts] = useState({});

  const items = filterByPermissions(NAV_ITEMS, user);

  // Fetch badge counts for nav items that have a badgeEndpoint
  const fetchBadges = useCallback(async () => {
    if (!authUser) return;
    const itemsWithBadge = NAV_ITEMS.filter((i) => i.badgeEndpoint);
    for (const item of itemsWithBadge) {
      try {
        const res = await fetch(item.badgeEndpoint);
        if (res.ok) {
          const data = await res.json();
          setBadgeCounts((prev) => ({ ...prev, [item.href]: data.count || 0 }));
        }
      } catch {}
    }
  }, [authUser]);

  useEffect(() => {
    fetchBadges();
    // Poll every 30 seconds for new uploads
    const interval = setInterval(fetchBadges, 30000);
    return () => clearInterval(interval);
  }, [fetchBadges]);
  const settingsVisible = true;

  // When collapsed + hovering, temporarily expand
  const isVisuallyExpanded = !collapsed || hoverExpanded;

  const isActive = (href) => {
    const [path, query] = href.split('?');
    if (path === '/dashboard') return router.pathname === '/dashboard';
    if (path === '/settings') return router.pathname.startsWith('/settings');
    if (path === '/coming-soon') {
      if (router.pathname !== '/coming-soon') return false;
      const expected = new URLSearchParams(query || '').get('feature');
      return router.query.feature === expected;
    }
    return router.pathname === path;
  };

  function handleMouseEnter() {
    if (collapsed) setHoverExpanded(true);
  }

  function handleMouseLeave() {
    if (collapsed) setHoverExpanded(false);
  }

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`fixed top-0 left-0 z-50 h-full bg-slate-900 text-white flex flex-col transform transition-all duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 ${isVisuallyExpanded ? 'w-60' : 'w-16'} ${
          hoverExpanded ? 'shadow-2xl' : ''
        }`}
      >
        {/* Logo header — dynamic branding */}
        <div
          className={`flex items-center gap-2 h-16 border-b border-slate-800 ${
            !isVisuallyExpanded ? 'justify-center px-2' : 'px-5'
          }`}
        >
          {/* Collapsed: small logo or fallback initial */}
          {!isVisuallyExpanded ? (
            branding?.logoSmall ? (
              <img src={branding.logoSmall} alt="" className="w-8 h-8 rounded object-contain" />
            ) : (
              <span className="text-2xl font-bold text-blue-400 shrink-0">
                {(branding?.companyName || 'D')[0].toUpperCase()}
              </span>
            )
          ) : (
            <>
              {/* Expanded: large logo or text */}
              {branding?.logoLarge ? (
                <img src={branding.logoLarge} alt={branding.companyName || 'Logo'} className="h-8 max-w-[140px] object-contain" />
              ) : branding?.logoSmall ? (
                <>
                  <img src={branding.logoSmall} alt="" className="w-8 h-8 rounded object-contain shrink-0" />
                  <div className="leading-tight overflow-hidden">
                    <div className="text-sm font-semibold whitespace-nowrap">
                      {branding?.companyName || 'DrayageDirect'}
                    </div>
                    <div className="text-xs text-slate-400 whitespace-nowrap">
                      Carrier Portal
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <span className="text-2xl font-bold text-blue-400 shrink-0">
                    {(branding?.companyName || 'D')[0].toUpperCase()}
                  </span>
                  <div className="leading-tight overflow-hidden">
                    <div className="text-sm font-semibold whitespace-nowrap">
                      {branding?.companyName || 'DrayageDirect'}
                    </div>
                    <div className="text-xs text-slate-400 whitespace-nowrap">
                      Carrier Portal
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={onMobileClose}
                title={!isVisuallyExpanded ? item.label : undefined}
                className={`flex items-center gap-3 rounded-lg text-sm transition-colors group ${
                  !isVisuallyExpanded ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'
                } ${
                  active
                    ? 'bg-blue-600 text-white font-medium'
                    : item.comingSoon
                    ? 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="relative shrink-0">
                  <Icon className="w-5 h-5" strokeWidth={1.75} />
                  {/* Badge on collapsed icon */}
                  {!isVisuallyExpanded && badgeCounts[item.href] > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
                      {badgeCounts[item.href] > 9 ? '9+' : badgeCounts[item.href]}
                    </span>
                  )}
                </div>
                {isVisuallyExpanded && (
                  <span className="flex-1 whitespace-nowrap">{item.label}</span>
                )}
                {/* Badge on expanded label */}
                {isVisuallyExpanded && badgeCounts[item.href] > 0 && (
                  <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                    {badgeCounts[item.href]}
                  </span>
                )}
                {isVisuallyExpanded && item.comingSoon && (
                  <span className="text-[10px] uppercase tracking-wide bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                    Soon
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Settings + collapse toggle */}
        <div className="border-t border-slate-800 p-2 space-y-0.5">
          {settingsVisible && (
            <Link
              href={SETTINGS_NAV.href}
              onClick={onMobileClose}
              title={!isVisuallyExpanded ? SETTINGS_NAV.label : undefined}
              className={`flex items-center gap-3 rounded-lg text-sm transition-colors ${
                !isVisuallyExpanded ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'
              } ${
                isActive(SETTINGS_NAV.href)
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <SETTINGS_NAV.icon className="w-5 h-5 shrink-0" strokeWidth={1.75} />
              {isVisuallyExpanded && (
                <span className="whitespace-nowrap">{SETTINGS_NAV.label}</span>
              )}
            </Link>
          )}

          {/* Pin/Unpin when hovering in collapsed mode */}
          {isVisuallyExpanded && collapsed && hoverExpanded && (
            <button
              onClick={() => { onToggleCollapse(); setHoverExpanded(false); }}
              title="Pin sidebar open"
              className="hidden lg:flex w-full items-center gap-3 rounded-lg text-sm transition-colors text-slate-400 hover:bg-blue-600 hover:text-white px-3 py-2.5"
            >
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4m0 12v4m-6-10H2m20 0h-4M7.05 7.05L4.22 4.22m15.56 15.56l-2.83-2.83M7.05 16.95l-2.83 2.83m15.56-15.56l-2.83 2.83" />
              </svg>
              <span className="whitespace-nowrap">Pin Open</span>
            </button>
          )}
          {/* Collapse button when expanded (pinned) */}
          {!collapsed && (
            <button
              onClick={onToggleCollapse}
              title="Unpin & collapse sidebar"
              className="hidden lg:flex w-full items-center gap-3 rounded-lg text-sm transition-colors text-slate-400 hover:bg-slate-800 hover:text-white px-3 py-2.5"
            >
              <ChevronLeft className="w-5 h-5 shrink-0" strokeWidth={1.75} />
              <span className="whitespace-nowrap">Unpin & Collapse</span>
            </button>
          )}
          {/* Expand icon when collapsed and NOT hovering */}
          {collapsed && !hoverExpanded && (
            <button
              onClick={onToggleCollapse}
              title="Pin sidebar open"
              className="hidden lg:flex w-full items-center justify-center rounded-lg text-sm transition-colors text-slate-400 hover:bg-slate-800 hover:text-white px-2 py-2.5"
            >
              <ChevronRight className="w-5 h-5 shrink-0" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
