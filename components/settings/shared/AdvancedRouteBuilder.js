import { useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import EventLocationPicker from './EventLocationPicker';

/**
 * AdvancedRouteBuilder — owns columns 2 and 3 of the advanced-mode
 * tariff layout (see the design spec § UI).
 *
 * Props:
 *   value             — advancedRoute shape: { moves, routing_template_id }
 *   onChange(next)    — emits the full value object on any edit
 *   routingTemplates  — list of system + tenant routing_templates (for picker)
 *
 * moves shape (spec): [{ sequence, events: [{ sequence, event_type,
 *   location_match: { mode, org_id, city, state, zip } }] }]
 *
 * Drag-drop is intentionally simple (click-to-add + inline delete)
 * for the first cut rather than @dnd-kit. The routing tab's complex
 * split-move / auto-restructure logic isn't needed here — a tariff
 * template never progresses, so we don't need palette-to-move drop
 * zones. Users click to append; delete via the row's trash icon.
 */

// Mirrors PALETTE_EVENT_TYPES (lib/routing-rules.js) minus operational.
const PALETTE = [
  { type: 'hook_chassis', label: 'Hook Chassis' },
  { type: 'pickup',       label: 'Pick Up Container' },
  { type: 'pull',         label: 'Pull from Terminal' },
  { type: 'deliver',      label: 'Deliver Container' },
  { type: 'return',       label: 'Return Container' },
  { type: 'drop',         label: 'Drop Container' },
  { type: 'hook',         label: 'Hook Container' },
  { type: 'lift_off',     label: 'Lift Off' },
  { type: 'terminate',    label: 'Terminate Chassis' },
];

function emptyLocationMatch() {
  return { mode: 'specific', org_id: null, org_label: null, city: null, state: null, zip: null };
}

function orgTypeForEvent(eventType) {
  if (eventType === 'pull' || eventType === 'return') return 'terminal';
  if (eventType === 'deliver') return 'warehouse';
  // Drop, hook, hook_chassis, lift_off, terminate all typically happen
  // at yards (the container sits there between moves). Scoping the
  // OrgPicker to yards avoids the misleading "Add customer..." default.
  if (['drop', 'hook', 'hook_chassis', 'lift_off', 'terminate'].includes(eventType)) return 'yard';
  return 'customer';
}

export default function AdvancedRouteBuilder({ value, onChange, routingTemplates = [] }) {
  const moves = Array.isArray(value?.moves) ? value.moves : [];
  const templateId = value?.routing_template_id || null;

  function emit(nextMoves, nextTemplateId) {
    onChange({
      ...(value || {}),
      moves: nextMoves,
      routing_template_id: nextTemplateId !== undefined ? nextTemplateId : templateId,
    });
  }

  function onPickTemplate(newTemplateId) {
    const tpl = routingTemplates.find((t) => t.id === newTemplateId);
    if (!tpl) {
      emit(moves, newTemplateId || null);
      return;
    }
    if (moves.length > 0 && !window.confirm('Replace the current route with this template?')) {
      return;
    }
    const seqEvents = Array.isArray(tpl.event_sequence) ? tpl.event_sequence : [];
    const seededEvents = seqEvents
      .filter((e) => PALETTE.some((p) => p.type === e.type))
      .map((e, i) => ({
        sequence: i,
        event_type: e.type,
        location_match: emptyLocationMatch(),
      }));
    const seededMoves = seededEvents.length > 0
      ? [{ sequence: 0, events: seededEvents }]
      : [];
    emit(seededMoves, newTemplateId);
  }

  function onAddMove() {
    emit([...moves, { sequence: moves.length, events: [] }]);
  }

  function onRemoveMove(mIdx) {
    const next = moves.filter((_, i) => i !== mIdx).map((m, i) => ({ ...m, sequence: i }));
    emit(next);
  }

  function onAppendEvent(mIdx, eventType) {
    const next = moves.map((m, i) => {
      if (i !== mIdx) return m;
      const nextEvents = [
        ...(m.events || []),
        { sequence: (m.events || []).length, event_type: eventType, location_match: emptyLocationMatch() },
      ];
      return { ...m, events: nextEvents };
    });
    emit(next);
  }

  function onRemoveEvent(mIdx, eIdx) {
    const next = moves.map((m, i) => {
      if (i !== mIdx) return m;
      const nextEvents = (m.events || [])
        .filter((_, j) => j !== eIdx)
        .map((e, j) => ({ ...e, sequence: j }));
      return { ...m, events: nextEvents };
    });
    emit(next);
  }

  function onUpdateEventLocation(mIdx, eIdx, locationMatch) {
    const next = moves.map((m, i) => {
      if (i !== mIdx) return m;
      const nextEvents = (m.events || []).map((e, j) =>
        j === eIdx ? { ...e, location_match: locationMatch } : e
      );
      return { ...m, events: nextEvents };
    });
    emit(next);
  }

  return (
    <div className="flex gap-3">
      {/* Column 2 — Route Conditions (template picker + palette) */}
      <div className="w-[260px] shrink-0 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
        <div className="px-3 py-2 border-b border-gray-200 dark:border-slate-700 text-xs font-semibold text-gray-700 dark:text-slate-200">
          Route Conditions
        </div>
        <div className="p-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Routing Template</label>
            <select
              value={templateId || ''}
              onChange={(e) => onPickTemplate(e.target.value || null)}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-gray-900 dark:text-slate-100"
            >
              <option value="">(none)</option>
              {routingTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Append Event To Move</label>
            <div className="text-[10px] text-gray-400 dark:text-slate-500 mb-2">Click an event, then the move it should append to.</div>
            <div className="space-y-1">
              {PALETTE.map((p) => (
                <AppendButton key={p.type} label={p.label} type={p.type} moves={moves} onAppend={onAppendEvent} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Column 3 — Container Moves */}
      <div className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-gray-700 dark:text-slate-200">Container Moves</span>
          <button
            type="button"
            onClick={onAddMove}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Move
          </button>
        </div>
        <div className="p-3 space-y-3">
          {moves.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-slate-500 py-8 text-center">
              Pick a routing template or click &quot;Add Move&quot; to start.
            </div>
          ) : (
            moves.map((m, mIdx) => (
              <MoveCard
                key={mIdx}
                index={mIdx}
                events={m.events || []}
                onRemove={() => onRemoveMove(mIdx)}
                onRemoveEvent={(eIdx) => onRemoveEvent(mIdx, eIdx)}
                onUpdateEventLocation={(eIdx, lm) => onUpdateEventLocation(mIdx, eIdx, lm)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AppendButton({ label, type, moves, onAppend }) {
  const [expanded, setExpanded] = useState(false);
  if (moves.length === 0) {
    return (
      <button
        type="button"
        disabled
        className="w-full text-left text-xs px-2 py-1.5 rounded bg-gray-50 dark:bg-slate-950 text-gray-400 dark:text-slate-600 cursor-not-allowed"
        title="Add a move first"
      >
        {label}
      </button>
    );
  }
  if (moves.length === 1) {
    return (
      <button
        type="button"
        onClick={() => onAppend(0, type)}
        className="w-full text-left text-xs px-2 py-1.5 rounded bg-gray-50 dark:bg-slate-950 text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950"
      >
        {label}
      </button>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full text-left text-xs px-2 py-1.5 rounded bg-gray-50 dark:bg-slate-950 text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950"
      >
        {label}
      </button>
      {expanded && (
        <div className="mt-1 ml-2 space-y-0.5">
          {moves.map((_, mIdx) => (
            <button
              key={mIdx}
              type="button"
              onClick={() => { onAppend(mIdx, type); setExpanded(false); }}
              className="block w-full text-left text-[11px] px-2 py-1 rounded text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
            >
              → Move {mIdx + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MoveCard({ index, events, onRemove, onRemoveEvent, onUpdateEventLocation }) {
  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50/60 dark:bg-slate-900/60">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-slate-700">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
          <GripVertical className="w-3.5 h-3.5 text-gray-300 dark:text-slate-600" />
          Container Move {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-gray-400 dark:text-slate-500 hover:text-red-500"
          aria-label="Remove move"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-2 space-y-2">
        {events.length === 0 ? (
          <div className="text-[11px] text-gray-400 dark:text-slate-500 py-4 text-center">
            Append events from the Route Conditions palette.
          </div>
        ) : (
          events.map((e, eIdx) => (
            <div key={eIdx} className="flex items-start gap-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
              <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded shrink-0 mt-1">
                {e.event_type}
              </span>
              <EventLocationPicker
                value={e.location_match}
                onChange={(lm) => onUpdateEventLocation(eIdx, lm)}
                orgType={orgTypeForEvent(e.event_type)}
              />
              <button
                type="button"
                onClick={() => onRemoveEvent(eIdx)}
                className="text-gray-400 dark:text-slate-500 hover:text-red-500 mt-1 shrink-0"
                aria-label="Remove event"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
