import { useRouter } from 'next/router';

const TABS = [
  { id: 'loadBoard', label: 'Load Board' },
  { id: 'planner', label: 'Driver Planner' },
];

export default function DispatcherTabs({ activeTab }) {
  const router = useRouter();

  function selectTab(id) {
    const query = { ...router.query };
    if (id === 'loadBoard') delete query.tab;
    else query.tab = id;
    router.replace({ pathname: '/dispatcher', query }, undefined, { shallow: true });
  }

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div className="flex gap-1 px-4">
        {TABS.map((t) => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              className={[
                'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                active
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
