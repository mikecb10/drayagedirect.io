import { useState, useMemo } from 'react';
import { Plus, X } from 'lucide-react';

/**
 * TagInput — labeled tag chip input with autocomplete suggestions.
 *
 * Pure presentational of the tag list (caller owns the array via the
 * onChange callback) but keeps its own internal state for the input
 * field text and the suggestion-dropdown visibility.
 *
 * Originally defined inside pages/settings/charge-profiles/[id].js
 * (line 36 of the pre-G2 file). Extracted to its own file in Plan G2
 * with no behavior change.
 */
export default function TagInput({ tags, onChange, availableTags }) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    if (!input) return availableTags.filter((t) => !tags.includes(t));
    const q = input.toLowerCase();
    return availableTags.filter((t) => t.toLowerCase().includes(q) && !tags.includes(t));
  }, [input, availableTags, tags]);

  function addTag(name) {
    const trimmed = name.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setInput('');
    setShowSuggestions(false);
  }

  function removeTag(idx) { onChange(tags.filter((_, i) => i !== idx)); }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Tag</label>
      <div className="flex flex-wrap items-center gap-1.5 min-h-[36px] rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/40">
        {tags.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-[11px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
            {t}
            <button type="button" onClick={() => removeTag(i)} className="hover:text-blue-900"><X className="w-2.5 h-2.5" /></button>
          </span>
        ))}
        <div className="relative flex-1 min-w-[80px]">
          <input
            type="text" value={input}
            onChange={(e) => { setInput(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(input); } }}
            placeholder={tags.length === 0 ? 'Tag' : ''}
            className="w-full text-sm bg-transparent outline-none border-none py-0.5"
          />
          {showSuggestions && (suggestions.length > 0 || (input && !availableTags.includes(input.trim()))) && (
            <div className="absolute z-50 mt-1 left-0 w-48 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {suggestions.map((s) => (
                <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addTag(s)}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-blue-50 dark:hover:bg-blue-950/40 text-gray-700 dark:text-slate-200">{s}</button>
              ))}
              {input && !availableTags.includes(input.trim()) && (
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addTag(input)}
                  className="w-full px-3 py-1.5 text-left text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 font-medium border-t border-gray-100 dark:border-slate-800">
                  <Plus className="w-3 h-3 inline mr-1" />Create "{input.trim()}"
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
