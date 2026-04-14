import { useEffect, useMemo, useRef } from 'react';
import { AtSign } from 'lucide-react';
import { EMAIL_VARIABLES, VARIABLE_CATEGORIES } from '../../lib/email-variables';

/**
 * InlineVariablePicker — compact autocomplete that floats next to the
 * cursor when the user types `@` in a template field. Mirrors the
 * Slack / Notion / Linear @-mention pattern:
 *
 *   - Appears as soon as `@` is detected with no whitespace before the cursor
 *   - Filters the variable catalog live as the user keeps typing
 *   - Keyboard navigation: ↑ ↓ to move, Enter / Tab to insert, Esc to close
 *   - Mouse: click a row to insert
 *   - On select: replaces the `@query` with `{{variable.path}}` and keeps
 *     the caret after the inserted token so the user can keep typing
 *
 * This is distinct from VariablePicker.js (the click-the-#-button popover)
 * because the interaction model is fundamentally different:
 *
 *   VariablePicker        — deliberate, browsable, full 14-category accordion
 *   InlineVariablePicker  — fast, inline, flat top-matches list
 *
 * The caller owns the @-detection state. This component is a dumb
 * presentational dropdown that receives `query`, `activeIndex`, and
 * `onSelect`. Keyboard events are routed from the parent field's
 * onKeyDown handler because only that handler knows whether the field
 * is currently focused.
 */

// Map from category key → sort position, so empty-query results come out
// in the same order as the VARIABLE_CATEGORIES list (load → container →
// chassis → customer → pickup → delivery → return → driver → truck →
// charges → dates → tenant → user → system). Within each category we
// sort alphabetically by label.
const CATEGORY_ORDER = new Map(VARIABLE_CATEGORIES.map((c, i) => [c.key, i]));

function compareByCategoryThenLabel(a, b) {
  const aIdx = CATEGORY_ORDER.get(a.category) ?? 999;
  const bIdx = CATEGORY_ORDER.get(b.category) ?? 999;
  if (aIdx !== bIdx) return aIdx - bIdx;
  return a.label.localeCompare(b.label);
}

/**
 * Filter and rank the catalog against the query.
 *
 * - Empty query: returns the FULL catalog (all ~100 variables) sorted by
 *   category order then alphabetically within category. This lets users
 *   type `@` alone and scroll through every available token rather than
 *   having to guess a letter to get results.
 *
 * - Typed query: ranks by match specificity. Label start-match >
 *   path start-match > label substring > path substring > description
 *   substring. Ties broken alphabetically by label. No cap — the panel
 *   scrolls and we'd rather show everything relevant than hide matches.
 */
export function matchVariables(query) {
  const q = (query || '').toLowerCase().trim();

  if (!q) {
    return [...EMAIL_VARIABLES].sort(compareByCategoryThenLabel);
  }

  const scored = [];
  for (const v of EMAIL_VARIABLES) {
    const label = v.label.toLowerCase();
    const path = v.path.toLowerCase();
    const desc = (v.description || '').toLowerCase();

    let score = 0;
    if (label.startsWith(q)) score = 100;
    else if (path.startsWith(q)) score = 90;
    else if (label.includes(q)) score = 70;
    else if (path.includes(q)) score = 60;
    else if (desc.includes(q)) score = 30;

    if (score > 0) {
      scored.push({ v, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.v.label.localeCompare(b.v.label);
  });

  return scored.map((s) => s.v);
}

export default function InlineVariablePicker({
  query,
  matches,
  activeIndex,
  anchorRect,
  onSelect,
  onHover,
  onClose,
}) {
  const panelRef = useRef(null);

  // Close on click-outside
  useEffect(() => {
    function onPointer(e) {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target)) return;
      // Ignore clicks on the originating field — the parent tracks focus
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      onClose?.();
    }
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [onClose]);

  // Scroll the active row into view as the user arrow-keys through
  useEffect(() => {
    if (!panelRef.current) return;
    const active = panelRef.current.querySelector('[data-active="true"]');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!anchorRect || !matches) return null;

  // Position the panel near the anchor. Prefer below-right; flip up if
  // there's not enough room at the bottom of the viewport.
  const panelWidth = 360;
  const panelHeight = Math.min(420, matches.length * 56 + 60);
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const flipUp = spaceBelow < panelHeight + 20;

  const style = {
    position: 'fixed',
    zIndex: 120,
    width: panelWidth,
    maxHeight: 420,
    left: Math.min(anchorRect.left, window.innerWidth - panelWidth - 12),
    top: flipUp
      ? Math.max(12, anchorRect.top - panelHeight - 6)
      : Math.min(anchorRect.bottom + 4, window.innerHeight - panelHeight - 12),
  };

  return (
    <div
      ref={panelRef}
      style={style}
      className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl flex flex-col overflow-hidden"
      role="listbox"
      aria-label="Insert variable"
      data-popover-safe-zone="true"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60">
        <AtSign className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
        <div className="flex-1 text-xs font-semibold text-gray-700 dark:text-slate-200 truncate">
          {query ? (
            <>
              Variables matching{' '}
              <code className="font-mono text-blue-600 dark:text-blue-400">@{query}</code>
            </>
          ) : (
            <>All variables &mdash; scroll or keep typing to filter</>
          )}
        </div>
        <div className="text-[10px] text-gray-400 dark:text-slate-500 shrink-0">
          {matches.length} {matches.length === 1 ? 'variable' : 'variables'}
        </div>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto">
        {matches.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-500 dark:text-slate-400">
            No variables match &quot;{query}&quot;
            <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
              Press <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-700">Esc</kbd> to cancel
            </div>
          </div>
        ) : (
          matches.map((v, idx) => {
            const isActive = idx === activeIndex;
            return (
              <button
                key={v.path}
                type="button"
                data-active={isActive}
                onMouseEnter={() => onHover?.(idx)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect?.(v);
                }}
                className={`w-full flex items-start gap-3 px-3 py-2 text-left transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-950/40'
                    : 'hover:bg-gray-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <div
                      className={`text-xs font-semibold truncate ${
                        isActive
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-gray-900 dark:text-slate-100'
                      }`}
                    >
                      {v.label}
                    </div>
                    <div
                      className={`text-[10px] uppercase tracking-wider shrink-0 ${
                        isActive
                          ? 'text-blue-600/70 dark:text-blue-400/70'
                          : 'text-gray-400 dark:text-slate-500'
                      }`}
                    >
                      {v.category}
                    </div>
                  </div>
                  <div className="font-mono text-[10px] text-gray-500 dark:text-slate-400 truncate">
                    {`{{${v.path}}}`}
                  </div>
                  {v.sample && (
                    <div className="text-[10px] text-gray-400 dark:text-slate-500 italic truncate">
                      e.g. {v.sample}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 text-[10px] text-gray-500 dark:text-slate-400 flex items-center gap-2">
        <kbd className="px-1 py-0.5 rounded bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300">↑ ↓</kbd>
        <span>navigate</span>
        <kbd className="px-1 py-0.5 rounded bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300">Enter</kbd>
        <span>insert</span>
        <kbd className="px-1 py-0.5 rounded bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300">Esc</kbd>
        <span>cancel</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// @-detection helper — given a field value and the current caret
// position, returns { active, query, startPos } describing whether
// the caret is inside an @-mention and if so, the text between the
// `@` and the caret. The parent uses this on every onChange to
// decide whether to show the picker.
// ──────────────────────────────────────────────────────────────
export function detectAtMention(value, caretPos) {
  if (!value || caretPos == null) return { active: false };
  const before = value.slice(0, caretPos);
  // Walk back from caret to find the most recent @, bailing if we hit
  // whitespace (since a space after @ means the mention ended).
  let i = before.length - 1;
  while (i >= 0) {
    const ch = before[i];
    if (ch === '@') {
      // Check that the char BEFORE @ is either start-of-string or whitespace
      // so we don't trigger on "email@example.com".
      const prev = i > 0 ? before[i - 1] : '';
      if (i === 0 || /\s/.test(prev)) {
        const query = before.slice(i + 1);
        return { active: true, query, startPos: i };
      }
      return { active: false };
    }
    if (/\s/.test(ch)) return { active: false };
    i--;
  }
  return { active: false };
}
