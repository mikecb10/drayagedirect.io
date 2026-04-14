import { useEffect, useState } from 'react';

export default function ImpersonationBanner() {
  const [impersonation, setImpersonation] = useState(null);

  useEffect(() => {
    // Read the dd_impersonation cookie (not HttpOnly, readable client-side)
    const cookies = document.cookie.split(';').reduce((acc, c) => {
      const [key, ...val] = c.trim().split('=');
      acc[key] = val.join('=');
      return acc;
    }, {});

    if (cookies.dd_impersonation) {
      try {
        setImpersonation(JSON.parse(decodeURIComponent(cookies.dd_impersonation)));
      } catch {}
    }
  }, []);

  if (!impersonation) return null;

  async function exitImpersonation() {
    const res = await fetch('/api/admin/auth/exit-impersonation', { method: 'POST' });
    const data = await res.json();
    // Clear Supabase session
    localStorage.clear();
    window.location.href = data.redirectUrl || '/admin';
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-orange-500 text-white text-center py-2 px-4 text-sm font-medium">
      Impersonating: {impersonation.impersonatedName || impersonation.impersonatedUser}
      <button
        onClick={exitImpersonation}
        className="ml-4 underline font-semibold hover:text-orange-100"
      >
        Exit Impersonation
      </button>
    </div>
  );
}
