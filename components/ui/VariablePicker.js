import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, ChevronRight, X, Hash } from 'lucide-react';
import { groupVariablesByCategory, EMAIL_VARIABLES } from '../../lib/email-variables';

/**
 * VariablePicker — popover for inserting {{variable.path}} tokens into a
 * template editor field (subject or body). Renders a 14-category accordion
 * with click-to-insert rows. Supports fuzzy search across label, path,
 * and description so a dispatcher looking for "container #" finds
 * `container.number` immediately.
 *
 * ## Usage
 *
 *   const [pickerOpen, setPickerOpen] = useState(false);
 *   const textareaRef = useRef(null);
 *
 *   <VariablePicker
 *     open={pickerOpen}
 *     onClose={() => setPickerOpen(false)}
 *     onInsert={(token) => insertAtCursor(textareaRef.current, token)}
 *   />
 *
 * The component does NOT manage anchoring to a button — the caller
 * renders it inline (fixed-positioned by default) and handles showing /
 * hiding via the `open` prop. This keeps it reusable across multiple
 * insertion points (subject, body, future composer) without forcing
 * a single anchor pattern.
 *
 * Click outside closes the picker via the standard pointerdown-outside
 * pattern. Escape key also closes.
 */
export default function VariablePicker({ open, onClose, onInsert, anchorRect }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  // Reset query when re-opened so each invocation starts fresh
  useEffect(() => {
    if (open) {
      setQuery('');
      // Auto-focus the search on open so the user can type immediately
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Close on Escape + click-outside
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    function onPointer(e) {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target)) return;
      // Ignore clicks on the trigger button that opened us — the caller
      // should use stopPropagation on that button, but belt-and-suspenders:
      if (e.target.closest?.('[data-variable-picker-trigger="true"]')) return;
      onClose?.();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose]);

  // Group the catalog once
  const groups = useMemo(() => groupVariablesByCategory(), []);

  // Filtered groups based on the search query. Empty query shows all.
  const filteredGroups = useMemo(() => {
    if (!query.trim()) return groups;
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        variables: g.variables.filter((v) =>
          v.path.toLowerCase().includes(q) ||
          v.label.toLowerCase().includes(q) ||
          (v.description || '').toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.variables.length > 0);
  }, [groups, query]);

  const totalMatches = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.variables.length, 0),
    [filteredGroups]
  );

  function toggleCategory(key) {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }

  function handleInsert(path) {
    onInsert?.(`{{${path}}}`);
    // Don't close automatically — the user may want to insert multiple tokens.
    // They close explicitly via Escape, click-outside, or the X button.
  }

  if (!open) return null;

  // Positioning: if the caller gave us an anchorRect, position next to it.
  // Otherwise fall back to fixed-center for unscoped use.
  const style = anchorRect
    ? {
        position: 'fixed',
        top: Math.min(anchorRect.bottom + 6, window.innerHeight - 500),
        left: Math.min(anchorRect.left, window.innerWidth - 420),
        width: 400,
        maxHeight: 480,
        zIndex: 100,
      }
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 420,
        maxHeight: 520,
        zIndex: 100,
      };

  return (
    <div
      ref={panelRef}
      style={style}
      className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl flex flex-col overflow-hidden"
      role="dialog"
      aria-label="Insert variable"
      data-popover-safe-zone="true"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60">
        <Hash className="w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0" />
        <div className="flex-1 text-xs font-semibold text-gray-700 dark:text-slate-200">
          Insert Variable
        </div>
        <div className="text-[10px] text-gray-400 dark:text-slate-500">
          {totalMatches}/{EMAIL_VARIABLES.length}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-1 p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400"
          aria-label="Close variable picker"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-slate-700">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or path..."
            className="block w-full pl-7 pr-2 py-1.5 rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Scrollable category list */}
      <div className="flex-1 overflow-y-auto">
        {filteredGroups.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-500 dark:text-slate-400">
            No variables match &quot;{query}&quot;
          </div>
        ) : (
          filteredGroups.map((group) => {
            // When searching, auto-expand everything so results are visible.
            // When not searching, respect the user's collapse state (default open).
            const isCollapsed = query.trim() ? false : !!collapsed[group.key];
            return (
              <div key={group.key} className="border-b border-gray-100 dark:border-slate-800 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleCategory(group.key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800/60"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
                  )}
                  <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:text-slate-300">
                    {group.label}
                  </span>
                  <span className="text-[10px] text-gray-400 dark:text-slate-500">
                    {group.variables.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="pb-1">
                    {group.variables.map((v) => (
                      <button
                        key={v.path}
                        type="button"
                        onClick={() => handleInsert(v.path)}
                        className="w-full flex items-start gap-2 px-5 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-blue-950/40 group"
                        title={v.description}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <div className="text-xs font-medium text-gray-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-300 truncate">
                              {v.label}
                            </div>
                            {v.required && (
                              <span className="text-[9px] uppercase tracking-wider font-semibold text-rose-500 dark:text-rose-400 shrink-0">
                                required
                              </span>
                            )}
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
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 text-[10px] text-gray-500 dark:text-slate-400">
        Click any variable to insert it at the cursor. Picker stays open so you can insert multiple. <kbd className="px-1 py-0.5 rounded bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300">Esc</kbd> to close.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Helper exported for editor callers — inserts a token at the
// current cursor position of a textarea, preserving focus and
// correctly setting the resulting caret position after the insertion.
// ──────────────────────────────────────────────────────────────
export function insertAtCursor(textarea, token) {
  if (!textarea) return '';
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const next = `${before}${token}${after}`;
  // Update the textarea's value and restore caret just after the insertion
  // so the user can keep typing naturally.
  textarea.value = next;
  const caretPos = start + token.length;
  textarea.setSelectionRange(caretPos, caretPos);
  textarea.focus();
  // Fire an input event so React's onChange picks up the new value
  const event = new Event('input', { bubbles: true });
  textarea.dispatchEvent(event);
  return next;
}
