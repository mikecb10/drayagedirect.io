import {
  Ship, Package, Truck, ArrowDownToLine, Send, CheckCircle2,
  ChevronRight, Unlock, Lock, Calendar, MapPin, Warehouse, Building2,
  CheckSquare, XSquare, FileCheck,
} from 'lucide-react';

const KPI_CARDS = [
  {
    key: 'arriving_on_vessel',
    label: 'Arriving On Vessel',
    icon: Ship,
    color: 'sky',
    subCards: [
      { key: 'arriving_released', label: 'Released', color: 'emerald' },
      { key: 'arriving_on_hold', label: 'On Hold', color: 'red' },
    ],
  },
  {
    key: 'need_pickup',
    label: 'Need To Be Picked Up',
    icon: Package,
    color: 'blue',
    subCards: [
      { key: 'need_pickup_lfd', label: 'LFD', color: 'blue' },
      { key: 'need_pickup_apt', label: 'Pickup Apt', color: 'blue' },
    ],
  },
  {
    key: 'need_delivery',
    label: 'Need To Be Delivered',
    icon: Truck,
    color: 'amber',
    subCards: [
      { key: 'need_delivery_at_port', label: 'At Port', color: 'amber' },
      { key: 'need_delivery_in_yard', label: 'In Yard', color: 'amber' },
    ],
  },
  {
    key: 'need_return',
    label: 'Need To Be Returned',
    icon: ArrowDownToLine,
    color: 'orange',
    subCards: [
      { key: 'need_return_ready', label: 'Ready', color: 'emerald' },
      { key: 'need_return_not_ready', label: 'Not Ready', color: 'red' },
    ],
  },
  {
    key: 'containers_dropped',
    label: 'Containers Dropped',
    icon: ArrowDownToLine,
    color: 'purple',
    subCards: [
      { key: 'dropped_in_yard', label: 'In Yard', color: 'slate' },
      { key: 'dropped_at_customer', label: 'At Customer', color: 'purple' },
    ],
  },
  {
    key: 'dispatched_loads',
    label: 'Dispatched Loads',
    icon: Send,
    color: 'emerald',
  },
  {
    key: 'finished_today',
    label: 'Finished Today',
    icon: CheckCircle2,
    color: 'teal',
  },
  {
    key: 'pending_docs',
    label: 'Pending Docs',
    icon: FileCheck,
    color: 'amber',
  },
];

const COLOR_MAP = {
  sky:     { icon: 'bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400', ring: 'ring-sky-400', sub: 'text-sky-700 dark:text-sky-300' },
  blue:    { icon: 'bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400', ring: 'ring-blue-400', sub: 'text-blue-700 dark:text-blue-300' },
  amber:   { icon: 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400', ring: 'ring-amber-400', sub: 'text-amber-700 dark:text-amber-300' },
  orange:  { icon: 'bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400', ring: 'ring-orange-400', sub: 'text-orange-700 dark:text-orange-300' },
  purple:  { icon: 'bg-purple-100 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400', ring: 'ring-purple-400', sub: 'text-purple-700 dark:text-purple-300' },
  emerald: { icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400', ring: 'ring-emerald-400', sub: 'text-emerald-700 dark:text-emerald-300' },
  teal:    { icon: 'bg-teal-100 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400', ring: 'ring-teal-400', sub: 'text-teal-700 dark:text-teal-300' },
  red:     { icon: 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400', ring: 'ring-red-400', sub: 'text-red-700 dark:text-red-300' },
  slate:   { icon: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', ring: 'ring-slate-400', sub: 'text-slate-700 dark:text-slate-300' },
};

/**
 * KpiStrip — horizontal scrolling strip of KPI cards.
 *
 * Main cards contain their sub-cards inline. Clicking the main card
 * activates ALL sub-cards (filters to the parent condition). Clicking
 * a sub-card filters to just that specific subset.
 */
export default function KpiStrip({ stats, activeKey, onSelect }) {
  return (
    <div className="flex gap-3 overflow-x-auto p-1">
      {KPI_CARDS.map((card) => {
        const Icon = card.icon;
        const colors = COLOR_MAP[card.color] || COLOR_MAP.blue;
        const value = stats?.[card.key] ?? 0;
        const isActive = activeKey === card.key;
        const hasActiveSub = card.subCards?.some((s) => activeKey === s.key);

        return (
          <div
            key={card.key}
            className={`shrink-0 rounded-xl border bg-white dark:bg-slate-900 transition-all ${
              isActive || hasActiveSub
                ? `ring-2 ring-offset-1 dark:ring-offset-slate-950 ${colors.ring} border-transparent`
                : 'border-gray-200 dark:border-slate-800 hover:shadow-sm'
            }`}
          >
            {/* Main card header — clickable */}
            <button
              type="button"
              onClick={() => onSelect?.(isActive ? null : card.key)}
              className="flex items-center gap-2.5 px-3 py-2.5 w-full text-left"
            >
              <div className={`rounded-lg p-1.5 ${colors.icon} shrink-0`}>
                <Icon className="w-4 h-4" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 leading-tight whitespace-nowrap">
                  {card.label}
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-slate-100 leading-tight">{value}</div>
              </div>
              {card.subCards && (
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-slate-600 shrink-0 ml-auto" />
              )}
            </button>

            {/* Sub-cards row — inside the main card */}
            {card.subCards && (
              <div className="flex border-t border-gray-100 dark:border-slate-800">
                {card.subCards.map((sub, idx) => {
                  const subColors = COLOR_MAP[sub.color] || COLOR_MAP.blue;
                  const subValue = stats?.[sub.key] ?? 0;
                  const isSubActive = activeKey === sub.key;
                  return (
                    <button
                      key={sub.key}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect?.(isSubActive ? null : sub.key);
                      }}
                      className={`flex-1 px-3 py-2 text-left transition-colors ${
                        idx > 0 ? 'border-l border-gray-100 dark:border-slate-800' : ''
                      } ${isSubActive ? 'bg-gray-50 dark:bg-slate-800' : 'hover:bg-gray-50/50 dark:hover:bg-slate-800/50'}`}
                    >
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500 whitespace-nowrap">
                        {sub.label}
                      </div>
                      <div className={`text-lg font-bold leading-tight ${isSubActive ? subColors.sub : 'text-gray-700 dark:text-slate-300'}`}>
                        {subValue}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
