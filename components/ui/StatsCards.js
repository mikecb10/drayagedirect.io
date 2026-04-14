/**
 * Colored stat card row — PortPro pattern.
 * Each card shows a count + label, optionally clickable to filter the list.
 *
 * Usage:
 *   <StatsCards
 *     cards={[
 *       { key: 'customer', label: 'Customers', count: 60, color: 'blue' },
 *       { key: 'terminal', label: 'Terminals', count: 1716, color: 'green' },
 *     ]}
 *     activeKey="customer"
 *     onSelect={setFilter}
 *   />
 */
const COLORS = {
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-green-600 dark:text-green-400',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
  purple: 'text-purple-600 dark:text-purple-400',
  cyan: 'text-cyan-600 dark:text-cyan-400',
  slate: 'text-slate-600 dark:text-slate-300',
};

export default function StatsCards({ cards = [], activeKey, onSelect, className = '' }) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${className}`}>
      {cards.map((card) => {
        const isActive = activeKey === card.key;
        const clickable = !!onSelect;
        const colorClass = COLORS[card.color] || COLORS.slate;

        return (
          <button
            key={card.key}
            type="button"
            onClick={clickable ? () => onSelect(isActive ? null : card.key) : undefined}
            disabled={!clickable}
            className={`text-left bg-white dark:bg-slate-900 border rounded-xl p-4 transition-all ${
              isActive
                ? 'border-blue-500 ring-2 ring-blue-100 dark:ring-blue-900/40 shadow-sm'
                : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700 hover:shadow-sm'
            } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <div className={`text-2xl font-bold ${colorClass}`}>
              {typeof card.count === 'number' ? card.count.toLocaleString() : card.count}
            </div>
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 mt-1 font-medium">
              {card.label}
            </div>
            {card.subtext && (
              <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{card.subtext}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
