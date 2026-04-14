import { useEffect } from 'react';
import { useRouter } from 'next/router';

/**
 * Load Detail Page — redirects to /dispatcher?load=uuid&tab=xxx
 *
 * All loads now open as the slide-in overlay panel on the dispatcher
 * board. This redirect ensures:
 *   - Direct URLs (/loads/abc123) → overlay on the dispatcher
 *   - Shared links land on the correct load
 *   - Prev/next navigation stays in overlay mode
 *   - Bookmarks still work
 *
 * The LoadDetail component is rendered by the OverlayRenderer when the
 * dispatcher page reads ?load= from the URL and calls openOverlay.
 */
export default function LoadDetailRedirect() {
  const router = useRouter();
  const { id, tab } = router.query;

  useEffect(() => {
    if (!router.isReady || !id) return;
    const query = { load: id };
    if (tab) query.tab = tab;
    router.replace({ pathname: '/dispatcher', query });
  }, [router.isReady, id, tab, router]);

  // Brief loading state while redirect happens
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}
