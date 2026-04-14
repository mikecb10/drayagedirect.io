import { useRouter } from 'next/router';
import { Plus, Building2, LayoutDashboard } from 'lucide-react';
import Button from '../ui/Button';

export default function QuickActions() {
  const router = useRouter();
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Quick Actions</h3>
      <div className="space-y-2">
        <Button variant="secondary" className="w-full justify-start" onClick={() => router.push('/dispatcher')}>
          <LayoutDashboard className="w-4 h-4 mr-2" /> Open Dispatcher
        </Button>
        <Button variant="secondary" className="w-full justify-start" onClick={() => router.push('/organizations?new=1')}>
          <Building2 className="w-4 h-4 mr-2" /> Add Organization
        </Button>
        <Button variant="secondary" className="w-full justify-start" onClick={() => router.push('/dispatcher')}>
          <Plus className="w-4 h-4 mr-2" /> Create Load
        </Button>
      </div>
    </div>
  );
}
