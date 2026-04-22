const TABS = [
  { id: 'all', label: 'All' },
  { id: 'atPort', label: 'At Port' },
  { id: 'deliveries', label: 'Deliveries' },
  { id: 'return', label: 'Return' },
  { id: 'other', label: 'Other' },
];

export default function BucketTabs({ counts, active, onChange }) {
  return (
    <div className="flex gap-1 p-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
      {TABS.map((t) => {
        const count = t.id === 'all'
          ? counts.atPort + counts.deliveries + counts.return + counts.other
          : counts[t.id];
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={[
              'px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap',
              isActive
                ? 'bg-blue-600 text-white dark:bg-blue-500'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800',
            ].join(' ')}
          >
            {t.label} <span className="opacity-70">({count})</span>
          </button>
        );
      })}
    </div>
  );
}
