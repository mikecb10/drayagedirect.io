import { useDraggable } from '@dnd-kit/core';
import {
  Anchor,
  Package,
  Warehouse,
  Ship,
  ArrowDownToLine,
  ArrowUpFromLine,
  X,
  CheckCircle2,
  Truck,
  Clock,
  Scale,
} from 'lucide-react';

/**
 * EventPalette — "Drag & Drop Events to Load" sidebar.
 *
 * All items are always draggable. Validation happens on the DROP side —
 * each ContainerMoveCard checks if the dropped event is valid for its
 * current state and either accepts it or triggers an auto-restructure.
 */

const PALETTE_ITEMS = [
  { type: 'hook_chassis', label: 'Hook Chassis', icon: Truck },
  { type: 'pickup', label: 'Pickup Container', icon: Anchor },
  { type: 'pull', label: 'Pull from Terminal', icon: Anchor },
  { type: 'deliver', label: 'Deliver Container', icon: Warehouse },
  { type: 'drop', label: 'Drop Container', icon: ArrowDownToLine },
  { type: 'hook', label: 'Hook Container', icon: Package },
  { type: 'return', label: 'Return Container', icon: Ship },
  { type: 'lift_off', label: 'Lift Off', icon: ArrowUpFromLine },
  { type: 'terminate', label: 'Terminate Chassis', icon: X },
  { type: 'scale', label: 'Scale', icon: Scale },
  { type: 'wait', label: 'Wait', icon: Clock },
  { type: 'complete', label: 'Completed', icon: CheckCircle2 },
];

function PaletteItem({ item }) {
  const Icon = item.icon;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${item.type}`,
    data: { type: 'palette', eventType: item.type, label: item.label },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-gray-700 dark:text-slate-200 cursor-grab active:cursor-grabbing hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-700 dark:hover:text-blue-300 transition-colors ${
        isDragging ? 'opacity-40 ring-2 ring-blue-400' : ''
      }`}
    >
      <Icon className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
      {item.label}
    </div>
  );
}

export default function EventPalette() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-2">
        Drag & Drop Events to Load
      </div>
      <div className="space-y-1.5">
        {PALETTE_ITEMS.map((item) => (
          <PaletteItem key={item.type} item={item} />
        ))}
      </div>
    </div>
  );
}
