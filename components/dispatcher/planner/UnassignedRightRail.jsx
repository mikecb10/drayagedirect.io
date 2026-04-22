import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import BucketTabs from './BucketTabs';
import UnassignedMoveCard from './UnassignedMoveCard';

export default function UnassignedRightRail({ buckets }) {
  const [active, setActive] = useState('all');
  const [search, setSearch] = useState('');

  const counts = {
    atPort: buckets.atPort.length,
    deliveries: buckets.deliveries.length,
    return: buckets.return.length,
    other: buckets.other.length,
  };

  const items = useMemo(() => {
    const source =
      active === 'all'
        ? [...buckets.atPort, ...buckets.deliveries, ...buckets.return, ...buckets.other]
        : buckets[active] || [];
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((m) => {
      const order = m.order || {};
      const firstEvent = (m.events || [])[0];
      return (
        (order.order_number || '').toLowerCase().includes(q) ||
        (order.container_number || '').toLowerCase().includes(q) ||
        (firstEvent?.location_name || '').toLowerCase().includes(q)
      );
    });
  }, [buckets, active, search]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search unassigned…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-2 py-1 text-xs rounded border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      </div>

      <BucketTabs counts={counts} active={active} onChange={setActive} />

      <div className="flex-1 overflow-auto p-2 space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-gray-500 dark:text-gray-400 p-4 text-center">
            {active === 'atPort'
              ? 'No containers at port for this date.'
              : active === 'deliveries'
              ? 'No deliveries scheduled.'
              : active === 'return'
              ? 'No containers ready for return.'
              : active === 'other'
              ? 'No other unassigned moves.'
              : 'No unassigned moves.'}
          </div>
        )}
        {items.map((m) => (
          <UnassignedMoveCard key={m.id} move={m} />
        ))}
      </div>
    </div>
  );
}
