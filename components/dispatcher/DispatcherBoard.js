import { useMemo, useCallback } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import {
  resolveColumns,
  DEFAULT_ORDER,
  DEFAULT_FROZEN,
  computeWarnings,
} from '../../lib/dispatcher-columns';
import { DEFAULT_LOAD_TYPE_COLORS } from '../../lib/dispatcher/load-type-colors';
import {
  deriveState,
  DEFAULT_STATE_COLORS as DEFAULT_EVENT_STATE_COLORS,
} from '../../lib/dispatcher-states';
import ColumnHeader from './ColumnHeader';
import EditableCell from './EditableCell';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * DispatcherBoard
 *
 * Features:
 *   - Two separate SortableContexts (pinned + unpinned) so drag is
 *     constrained to its own section.
 *   - Sticky frozen columns via CSS position: sticky with computed offsets.
 *   - Per-column resize (drag the right edge of a header).
 *   - 3-dot menu per header for Remove / Pin / Unpin actions.
 *   - Auto-save any preference change through onPreferencesChange.
 */
// State colors now come from lib/dispatcher-states.js (17 fine-grained states).
// Tenants can override any of them via /settings/dispatcher-colors.
const DEFAULT_STATE_COLORS = DEFAULT_EVENT_STATE_COLORS;

/**
 * Composite a #rrggbb hex color over a dark background at the given alpha.
 *
 * Returns a SOLID rgb() string instead of rgba(), which is critical for
 * sticky/frozen cells — a semi-transparent background would let content
 * scrolling behind the sticky column bleed through.
 *
 * The dark base color is slate-900 (#0f172a) — matches the dispatcher board
 * card's dark:bg-slate-900 so rows look like subtly tinted versions of the
 * board background rather than solid pastels.
 */
function compositeOverDark(hex, alpha) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  const clean = hex.slice(1);
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;

  // Dark base = slate-900 = rgb(15, 23, 42)
  const BG_R = 15;
  const BG_G = 23;
  const BG_B = 42;

  const rr = Math.round(r * alpha + BG_R * (1 - alpha));
  const gg = Math.round(g * alpha + BG_G * (1 - alpha));
  const bb = Math.round(b * alpha + BG_B * (1 - alpha));
  return `rgb(${rr}, ${gg}, ${bb})`;
}

/**
 * In dark mode, the tenant-customized state colors (chosen for light
 * backgrounds) would glow against the dark page chrome. We composite them
 * over slate-900 at 22% alpha so rows look like subtly tinted dark cards
 * with enough color presence to distinguish states.
 *
 * Returns a SOLID color so sticky columns stay opaque.
 */
function adaptRowColorForDark(hex, isDark) {
  if (!isDark) return hex;
  return compositeOverDark(hex, 0.22);
}

export default function DispatcherBoard({
  loads,
  loading,
  preferences,
  onPreferencesChange,
  onRowClick,
  onCellSave, // (loadId, patch) → Promise — called when user edits a cell
  tenantColors, // { state_colors: {}, load_type_colors: {} }
  selectedIds = new Set(), // Set<string> of selected load ids
  onToggleSelect, // (id) → void
  onToggleSelectAll, // (ids: string[], selected: boolean) → void
  flashingIds = new Set(), // Set<string> of rows to highlight (realtime updates)
  scrollContainerRef, // ref attached to the scroll container for cursor tracking
  cursorLayer = null, // optional JSX overlay (e.g. <LiveCursorLayer />)
}) {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  // Header bg for sticky cells — needs to match the thead bg exactly so the
  // pinned checkbox/stripe header cells occlude content scrolling behind them.
  // thead uses bg-gray-50 (#f9fafb) in light, bg-slate-800 (#1e293b) in dark.
  const headerStickyBg = isDark ? '#1e293b' : '#f9fafb';
  const stateColors = { ...DEFAULT_STATE_COLORS, ...(tenantColors?.state_colors || {}) };
  const loadTypeColors = {
    ...DEFAULT_LOAD_TYPE_COLORS,
    ...(tenantColors?.load_type_colors || {}),
  };
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Resolve the column list (order + visibility + freeze + widths)
  const { columns, frozenCols, unfrozenCols, frozenSet } = useMemo(
    () => resolveColumns(preferences),
    [preferences]
  );

  // Leftmost sticky columns: [checkbox 36px] [stripe 4px] [frozen data columns...]
  const CHECKBOX_WIDTH = 36;
  const STRIPE_WIDTH = 4;
  const LEFT_GUTTER = CHECKBOX_WIDTH + STRIPE_WIDTH;

  // Compute sticky left offset for each frozen column (after checkbox + stripe).
  const stickyOffsets = useMemo(() => {
    const offsets = {};
    let offset = LEFT_GUTTER;
    for (const col of frozenCols) {
      offsets[col.key] = offset;
      offset += col.width;
    }
    return offsets;
  }, [frozenCols]);

  // ===== Selection helpers =====
  const allVisibleSelected =
    loads.length > 0 && loads.every((l) => selectedIds.has(l.id));
  const someVisibleSelected = loads.some((l) => selectedIds.has(l.id));

  function handleSelectAll() {
    if (!onToggleSelectAll) return;
    onToggleSelectAll(loads.map((l) => l.id), !allVisibleSelected);
  }

  const density = preferences?.row_density || 'comfortable';
  const rowPadding = density === 'compact' ? 'py-1.5' : 'py-2.5';

  // === Preference mutation helpers ===

  function currentOrder() {
    return preferences?.column_order?.length ? preferences.column_order : DEFAULT_ORDER;
  }

  function currentFrozen() {
    return preferences?.frozen_columns?.length ? preferences.frozen_columns : DEFAULT_FROZEN;
  }

  // Section-constrained drag: reorder ONLY within the section the active item belongs to.
  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeIsFrozen = frozenSet.has(active.id);
    const overIsFrozen = frozenSet.has(over.id);

    // Cross-section drags are ignored (pin/unpin is handled by the 3-dot menu)
    if (activeIsFrozen !== overIsFrozen) return;

    const order = currentOrder();

    // Build a merged order that includes any new columns not yet in saved order
    const fullOrder = [...order];
    for (const c of columns) {
      if (!fullOrder.includes(c.key)) fullOrder.push(c.key);
    }

    // Indices of the two items in the full order
    const fromIdx = fullOrder.indexOf(active.id);
    const toIdx = fullOrder.indexOf(over.id);
    if (fromIdx === -1 || toIdx === -1) return;

    const newOrder = arrayMove(fullOrder, fromIdx, toIdx);
    onPreferencesChange?.({ ...preferences, column_order: newOrder });
  }

  function handleTogglePin(key) {
    const frozen = new Set(currentFrozen());
    if (frozen.has(key)) frozen.delete(key);
    else frozen.add(key);
    onPreferencesChange?.({ ...preferences, frozen_columns: Array.from(frozen) });
  }

  function handleRemove(key) {
    const hidden = new Set(preferences?.hidden_columns || []);
    hidden.add(key);
    onPreferencesChange?.({ ...preferences, hidden_columns: Array.from(hidden) });
  }

  function handleResize(key, newWidth) {
    const widths = { ...(preferences?.column_widths || {}), [key]: newWidth };
    onPreferencesChange?.({ ...preferences, column_widths: widths });
  }

  // Row background — fine-grained state (derived from status + current routing
  // event + timestamps), with warning overrides for problem loads. In dark
  // mode, the light tenant colors are dimmed via low alpha so the dark page
  // background shows through and rows look like subtly tinted dark cards.
  const rowBgColor = useCallback(
    (row) => {
      const warnings = computeWarnings(row);
      let color;
      if (warnings.includes('Overdue') || warnings.includes('LFD Passed')) color = '#fee2e2'; // red warning
      else if (warnings.includes('LFD Soon') || warnings.includes('Per Diem Risk')) color = '#fef3c7'; // amber warning
      else {
        const stateKey = deriveState(row);
        color = stateColors[stateKey] || (isDark ? '#0f172a' : '#ffffff');
      }
      return adaptRowColorForDark(color, isDark);
    },
    [stateColors, isDark]
  );

  // Load type accent stripe color (left edge)
  const loadTypeStripe = useCallback(
    (row) => loadTypeColors[row.load_type] || '#d1d5db',
    [loadTypeColors]
  );

  const lastFrozenKey = frozenCols.length > 0 ? frozenCols[frozenCols.length - 1].key : null;

  function renderHeaderCell(col) {
    return (
      <ColumnHeader
        key={col.key}
        column={col}
        isFrozen={frozenSet.has(col.key)}
        stickyLeft={stickyOffsets[col.key]}
        onRemove={handleRemove}
        onTogglePin={handleTogglePin}
        onResize={handleResize}
      />
    );
  }

  const renderContext = { loadTypeColors, stateColors };

  function renderBodyCell(col, row, bgColor) {
    const isFrozen = frozenSet.has(col.key);
    const content = <div className="truncate">{col.renderCell(row, renderContext)}</div>;

    return (
      <td
        key={col.key}
        className={`${rowPadding} px-3 text-sm text-gray-700 dark:text-slate-200`}
        style={{
          width: col.width,
          minWidth: col.width,
          maxWidth: col.width,
          backgroundColor: bgColor,
          ...(isFrozen
            ? {
                position: 'sticky',
                left: stickyOffsets[col.key],
                zIndex: 1,
                boxShadow: col.key === lastFrozenKey ? '2px 0 4px rgba(0,0,0,0.04)' : undefined,
              }
            : {}),
        }}
      >
        {col.interaction && onCellSave ? (
          <EditableCell column={col} row={row} onSave={onCellSave}>
            {content}
          </EditableCell>
        ) : (
          content
        )}
      </td>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      {/*
        Bounded height so both scrollbars (horizontal + vertical) live inside
        the board and stay near the viewport edge. Users can scroll horizontally
        from anywhere on the board area — not just within a single row.
      */}
      <div
        ref={scrollContainerRef}
        className="overflow-auto relative"
        style={{ maxHeight: 'calc(100vh - 260px)' }}
      >
        {/* Cursor overlay (lives inside scroll container so coordinates match content) */}
        {cursorLayer}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <table className="border-collapse" style={{ minWidth: '100%' }}>
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                {/* Checkbox column — leftmost, sticky */}
                <th
                  className="border-b border-gray-200 dark:border-slate-800"
                  style={{
                    width: CHECKBOX_WIDTH,
                    minWidth: CHECKBOX_WIDTH,
                    maxWidth: CHECKBOX_WIDTH,
                    padding: 0,
                    position: 'sticky',
                    left: 0,
                    zIndex: 5,
                    backgroundColor: headerStickyBg,
                  }}
                >
                  <div className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                      }}
                      onChange={handleSelectAll}
                      className="w-4 h-4 rounded text-blue-600 border-gray-300 dark:border-slate-600 dark:bg-slate-800 focus:ring-2 focus:ring-blue-500"
                      title="Select all visible"
                    />
                  </div>
                </th>
                {/* Load type accent stripe column — sticky after checkbox */}
                <th
                  className="border-b border-gray-200 dark:border-slate-800"
                  style={{
                    width: STRIPE_WIDTH,
                    minWidth: STRIPE_WIDTH,
                    maxWidth: STRIPE_WIDTH,
                    padding: 0,
                    position: 'sticky',
                    left: CHECKBOX_WIDTH,
                    zIndex: 4,
                    backgroundColor: headerStickyBg,
                  }}
                />
                {/* Frozen section — own sortable context */}
                <SortableContext
                  items={frozenCols.map((c) => c.key)}
                  strategy={horizontalListSortingStrategy}
                >
                  {frozenCols.map(renderHeaderCell)}
                </SortableContext>
                {/* Unfrozen section — own sortable context */}
                <SortableContext
                  items={unfrozenCols.map((c) => c.key)}
                  strategy={horizontalListSortingStrategy}
                >
                  {unfrozenCols.map(renderHeaderCell)}
                </SortableContext>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={columns.length + 2} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
                    Loading loads...
                  </td>
                </tr>
              ) : loads.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 2} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
                    No loads match your filters.
                  </td>
                </tr>
              ) : (
                loads.map((row) => {
                  const bg = rowBgColor(row);
                  const stripe = loadTypeStripe(row);
                  const isSelected = selectedIds.has(row.id);
                  const isFlashing = flashingIds.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      className={`hover:brightness-[0.97] transition-all ${
                        isSelected ? 'ring-2 ring-inset ring-blue-400' : ''
                      } ${isFlashing ? 'dd-row-flash' : ''}`}
                      style={{ backgroundColor: bg }}
                    >
                      {/* Checkbox cell — sticky leftmost */}
                      <td
                        style={{
                          width: CHECKBOX_WIDTH,
                          minWidth: CHECKBOX_WIDTH,
                          maxWidth: CHECKBOX_WIDTH,
                          padding: 0,
                          backgroundColor: bg,
                          position: 'sticky',
                          left: 0,
                          zIndex: 2,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onToggleSelect?.(row.id)}
                            className="w-4 h-4 rounded text-blue-600 border-gray-300 dark:border-slate-600 dark:bg-slate-800 focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </td>
                      {/* Load type accent stripe cell */}
                      <td
                        style={{
                          width: STRIPE_WIDTH,
                          minWidth: STRIPE_WIDTH,
                          maxWidth: STRIPE_WIDTH,
                          padding: 0,
                          backgroundColor: stripe,
                          position: 'sticky',
                          left: CHECKBOX_WIDTH,
                          zIndex: 2,
                        }}
                        title={row.load_type || ''}
                      />
                      {columns.map((col) => renderBodyCell(col, row, bg))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </DndContext>
      </div>
    </div>
  );
}
