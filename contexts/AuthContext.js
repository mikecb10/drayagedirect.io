import { createContext, useContext, useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '../lib/supabase-browser';
import { hasPermission as hasPermissionFn } from '../lib/permissions';

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [branding, setBranding] = useState({});
  const [permissions, setPermissions] = useState([]);
  const [branchIds, setBranchIds] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  const supabase = getSupabaseBrowserClient();

  async function fetchProfile(authUser) {
    if (!authUser) {
      setProfile(null);
      setPermissions([]);
      return;
    }

    // Use the /api/tenant/me endpoint — it uses the server-side service role
    // client to bypass RLS and always returns the fresh profile + permissions.
    try {
      const res = await fetch('/api/tenant/me', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setProfile({
          id: data.id,
          tenant_id: data.tenantId,
          email: data.email,
          name: data.name,
          role: data.role,
          password_change_required: false,
        });
        setPermissions(data.permissions || []);
        setBranchIds(data.branchIds || []);
        setBranches(data.branches || []);
        if (data.branding) setBranding(data.branding);
        return;
      }
    } catch (e) {
      // network error — fall through to fallback
    }

    // Fallback: use JWT app_metadata if available
    const meta = authUser.app_metadata || {};
    if (meta.tenant_id) {
      setProfile({
        id: meta.user_id || authUser.id,
        tenant_id: meta.tenant_id,
        email: authUser.email,
        name: authUser.user_metadata?.name || authUser.email,
        role: meta.role || 'user',
        password_change_required: false,
      });
    }
  }

  useEffect(() => {
    let mounted = true;

    // Set a hard timeout so loading never hangs
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 3000);

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile(s.user).finally(() => {
          clearTimeout(timeout);
          if (mounted) setLoading(false);
        });
      } else {
        clearTimeout(timeout);
        setLoading(false);
      }
    }).catch(() => {
      clearTimeout(timeout);
      if (mounted) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        if (!mounted) return;
        setSession(s);
        setUser(s?.user ?? null);

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          await fetchProfile(s?.user);
        }

        if (event === 'SIGNED_OUT') {
          setProfile(null);
          setPermissions([]);
          setBranchIds([]);
          setBranches([]);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setPermissions([]);
    setBranchIds([]);
    setBranches([]);
    window.location.href = '/login';
  }

  function hasPermission(required) {
    return hasPermissionFn({ role: profile?.role, permissions }, required);
  }

  const isBranchScoped = branchIds.length > 0 && profile?.role !== 'super_admin' && profile?.role !== 'admin';

  const value = {
    user,
    session,
    profile,
    tenantId: profile?.tenant_id,
    role: profile?.role,
    permissions,
    branchIds,
    branches,
    isBranchScoped,
    branding,
    hasPermission,
    loading,
    signOut,
    supabase,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
