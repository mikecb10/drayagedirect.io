import '@/styles/globals.css';
import { useRouter } from 'next/router';
import { AuthProvider } from '../contexts/AuthContext';
import { AdminAuthProvider } from '../contexts/AdminAuthContext';
import { CompactModeProvider } from '../contexts/CompactModeContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { OverlayProvider } from '../contexts/OverlayContext';
import ImpersonationBanner from '../components/ImpersonationBanner';
import ResilienceBanner from '../components/resilience/ResilienceBanner';
import OverlayRenderer from '../components/OverlayRenderer';

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const isAdminRoute = router.pathname.startsWith('/admin');

  // Per-page layout opt-in: pages may export Component.getLayout to wrap
  // themselves in a persistent layout that survives route changes (e.g. the
  // settings shell). Pages that don't export it use the identity wrapper.
  const getLayout = Component.getLayout ?? ((page) => page);
  const page = getLayout(<Component {...pageProps} />);

  if (isAdminRoute) {
    return (
      <ThemeProvider>
        <AdminAuthProvider>{page}</AdminAuthProvider>
      </ThemeProvider>
    );
  }

  return (
    <AuthProvider>
      <ThemeProvider>
        <CompactModeProvider>
          <OverlayProvider>
            <ResilienceBanner />
            <ImpersonationBanner />
            {page}
            <OverlayRenderer />
          </OverlayProvider>
        </CompactModeProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
