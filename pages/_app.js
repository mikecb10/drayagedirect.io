import '@/styles/globals.css';
import { useRouter } from 'next/router';
import { AuthProvider } from '../contexts/AuthContext';
import { AdminAuthProvider } from '../contexts/AdminAuthContext';
import { CompactModeProvider } from '../contexts/CompactModeContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { OverlayProvider } from '../contexts/OverlayContext';
import ImpersonationBanner from '../components/ImpersonationBanner';
import OverlayRenderer from '../components/OverlayRenderer';

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const isAdminRoute = router.pathname.startsWith('/admin');

  if (isAdminRoute) {
    return (
      <ThemeProvider>
        <AdminAuthProvider>
          <Component {...pageProps} />
        </AdminAuthProvider>
      </ThemeProvider>
    );
  }

  return (
    <AuthProvider>
      <ThemeProvider>
        <CompactModeProvider>
          <OverlayProvider>
            <ImpersonationBanner />
            <Component {...pageProps} />
            <OverlayRenderer />
          </OverlayProvider>
        </CompactModeProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
