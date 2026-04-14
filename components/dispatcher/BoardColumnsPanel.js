import { useMemo, useState } from 'react';
import { Search, Pin, Eye, EyeOff, X, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DISPATCHER_COLUMNS, DEFAULT_FROZEN, DEFAULT_HIDDEN, DEFAULT_ORDER } from '../../lib/dispatcher-columns';

function SortableColumnRow({ col, isHidden, isFrozen, onToggleVisibility, onToggleFrozen, isDragDisabled }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: col.key, disabled: isDragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800/60 ${
        isHidden ? 'opacity-50' : ''
      } ${isDragging ? 'bg-blue-50 dark:bg-blue-950/40 shadow-lg ring-2 ring-blue-300 dark:ring-blue-700' : ''}`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className={`shrink-0 cursor-grab active:cursor-grabbing text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400 ${isDragDisabled ? 'invisible' : ''}`}
        title="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Visibility toggle */}
      <button
        onClick={() => onToggleVisibility(col.key)}
        className="shrink-0"
        title={isHidden ? 'Show column' : 'Hide column'}
      >
        {isHidden ? (
          <EyeOff className="w-4 h-4 text-gray-400 dark:text-slate-500" />
        ) : (
          <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        )}
      </button>

      {/* Label */}
      <span className="flex-1 text-sm text-gray-800 dark:text-slate-200 truncate">{col.label}</span>

      {/* Freeze toggle */}
      <button
        onClick={() => onToggleFrozen(col.key)}
        className={`shrink-0 rounded p-1 transition-colors ${
          isFrozen
            ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
            : 'text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400'
        }`}
        title={isFrozen ? 'Unfreeze column' : 'Freeze column'}
      >
        <Pin className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * Board Columns Panel — modal with all columns.
 * Each row has a drag handle, visibility toggle, and a freeze (pin) toggle.
 * Drag to reorder columns — order is saved to user preferences.
 */
export default function BoardColumnsPanel({ isOpen, onClose, preferences, onChange }) {
  const [search, setSearch] = useState('');

  const hiddenSet = useMemo(
    () => new Set(preferences?.hidden_columns?.length ? preferences.hidden_columns : DEFAULT_HIDDEN),
    [preferences?.hidden_columns]
  );
  const frozenSet = useMemo(
    () => new Set(preferences?.frozen_columns?.length ? preferences.frozen_columns : DEFAULT_FROZEN),
    [preferences?.frozen_columns]
  );

  // Current column order (user-saved or default)
  const columnOrder = useMemo(() => {
    const saved = preferences?.column_order;
    if (saved?.length) {
      // Merge: saved order first, then any new columns not yet in saved order
      const allKeys = [...saved];
      for (const c of DISPATCHER_COLUMNS) {
        if (!allKeys.includes(c.key)) allKeys.push(c.key);
      }
      return allKeys;
    }
    return DEFAULT_ORDER;
  }, [preferences?.column_order]);

  // Build ordered column list
  const columnMap = useMemo(() => {
    const map = {};
    for (const c of DISPATCHER_COLUMNS) map[c.key] = c;
    return map;
  }, []);

  const orderedColumns = useMemo(() => {
    return columnOrder.map((key) => columnMap[key]).filter(Boolean);
  }, [columnOrder, columnMap]);

  // Filter for search
  const filteredColumns = useMemo(() => {
    if (!search) return orderedColumns;
    const q = search.toLowerCase();
    return orderedColumns.filter((c) => c.label.toLowerCase().includes(q));
  }, [search, orderedColumns]);

  const isSearching = search.length > 0;

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = columnOrder.indexOf(active.id);
    const newIndex = columnOrder.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
    onChange({ ...preferences, column_order: newOrder });
  }

  function toggleVisibility(key) {
    const next = new Set(hiddenSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange({ ...preferences, hidden_columns: Array.from(next) });
  }

  function toggleFrozen(key) {
    const next = new Set(frozenSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange({ ...preferences, frozen_columns: Array.from(next) });
  }

  const visibleCount = DISPATCHER_COLUMNS.length - hiddenSet.size;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Board Columns</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {visibleCount} of {DISPATCHER_COLUMNS.length} columns visible · {frozenSet.size}{' '}
              frozen · Drag to reorder
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search columns..."
              className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
            />
          </div>
        </div>

        {/* Column list — drag-sortable when not searching */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filteredColumns.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
              No columns match &quot;{search}&quot;
            </div>
          ) : isSearching ? (
            // Static list when searching (can't reorder filtered subset)
            <div className="space-y-0.5">
              {filteredColumns.map((col) => (
                <SortableColumnRow
                  key={col.key}
                  col={col}
                  isHidden={hiddenSet.has(col.key)}
                  isFrozen={frozenSet.has(col.key)}
                  onToggleVisibility={toggleVisibility}
                  onToggleFrozen={toggleFrozen}
                  isDragDisabled
                />
              ))}
            </div>
          ) : (
            // Drag-sortable list
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredColumns.map((c) => c.key)} strategy={verticalListSortingStrategy}>
                <div className="space-y-0.5">
                  {filteredColumns.map((col) => (
                    <SortableColumnRow
                      key={col.key}
                      col={col}
                      isHidden={hiddenSet.has(col.key)}
                      isFrozen={frozenSet.has(col.key)}
                      onToggleVisibility={toggleVisibility}
                      onToggleFrozen={toggleFrozen}
                      isDragDisabled={false}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-950/50 rounded-b-xl">
          <div className="text-xs text-gray-500 dark:text-slate-400">
            <GripVertical className="w-3 h-3 inline -mt-0.5 mr-1" />
            Drag to reorder ·
            <Eye className="w-3 h-3 inline -mt-0.5 mx-1 text-blue-600 dark:text-blue-400" />
            Visibility ·
            <Pin className="w-3 h-3 inline -mt-0.5 mx-1 text-blue-600 dark:text-blue-400" />
            Pin
          </div>
          <button
            onClick={onClose}
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
