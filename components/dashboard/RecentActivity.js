import { Clock } from 'lucide-react';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const d = new Date(dateStr);
  const seconds = Math.floor((now - d) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAction(action) {
  return (action || '')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function RecentActivity({ activity = [] }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Recent Activity</h3>
      {activity.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400 dark:text-slate-500">No recent activity</div>
      ) : (
        <div className="space-y-0">
          {activity.map((event, idx) => (
            <div key={event.id || idx} className="flex items-start gap-3 py-2.5 border-b border-gray-50 dark:border-slate-800 last:border-0">
              <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                <Clock className="w-3 h-3" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-700 dark:text-slate-300">
                  <span className="font-medium">{event.user?.name || 'System'}</span>
                  {' '}
                  <span className="text-gray-500 dark:text-slate-400">{formatAction(event.action)}</span>
                  {event.entity_type && (
                    <span className="text-gray-400 dark:text-slate-500"> ({event.entity_type})</span>
                  )}
                </div>
              </div>
              <span className="text-[11px] text-gray-400 dark:text-slate-500 shrink-0">
                {timeAgo(event.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
