import { useRouter } from 'next/router';
import { Clock } from 'lucide-react';
import TenantLayout from '../components/tenant/TenantLayout';

export default function ComingSoon() {
  const router = useRouter();
  const feature = router.query.feature || 'This feature';

  return (
    <TenantLayout title={String(feature)}>
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-6">
            <Clock className="w-8 h-8" strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {feature} — Coming in Phase 5
          </h1>
          <p className="text-gray-500 max-w-md mx-auto">
            We're building this into DrayageDirect now. Your portal shell, team
            management, and settings are ready to go — the core operational
            features are next.
          </p>

          <div className="mt-8 border-t border-gray-100 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold mb-1">
                  What's next
                </div>
                <div className="text-sm text-gray-700">
                  Orders, Customers, Drivers, Rates, Invoices
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold mb-1">
                  Available now
                </div>
                <div className="text-sm text-gray-700">
                  Team, Permissions, Company settings
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold mb-1">
                  Later
                </div>
                <div className="text-sm text-gray-700">
                  Reports, Rail APIs, Messaging
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => router.push('/dashboard')}
            className="mt-8 inline-flex items-center px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    </TenantLayout>
  );
}
