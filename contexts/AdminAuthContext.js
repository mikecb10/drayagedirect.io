import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const AdminAuthContext = createContext({});

export function AdminAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.employee) setAdmin(data.employee);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await fetch('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setAdmin(data.employee);
    return data.employee;
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    setAdmin(null);
    window.location.href = '/admin/login';
  }, []);

  return (
    <AdminAuthContext.Provider value={{ admin, loading, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error('useAdminAuth must be used within AdminAuthProvider');
  }
  return context;
}
