import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import AdminSidebar from './AdminSidebar';
import Badge from '../ui/Badge';

export default function AdminLayout({ children, title }) {
  const router = useRouter();
  const { admin, loading, logout } = useAdminAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading && !admin) {
      router.replace('/admin/login');
    }
  }, [loading, admin]);

  if (loading || !admin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <div className="lg:ml-64">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-gray-500 hover:text-gray-700"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {title && <h1 className="text-lg font-semibold text-gray-900">{title}</h1>}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{admin.name}</span>
            <Badge variant={admin.role === 'super_admin' ? 'blue' : 'gray'}>
              {admin.role.replace('_', ' ')}
            </Badge>
            <button
              onClick={logout}
              className="text-sm text-gray-500 hover:text-gray-700 font-medium"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
