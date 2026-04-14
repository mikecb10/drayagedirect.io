import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import Select from './Select';
import Input from './Input';
import Badge from './Badge';
import { getRuleByKey, getRulesByCategory, isRangeOperator } from '../../lib/ar-rule-definitions';

/**
 * ConditionBuilder — reusable AND/OR rules engine UI.
 *
 * Props:
 *   rules         — definitions array (AR_RULES or AP equivalent)
 *   conditions     — current conditions array [{field, operator, values, values2?}]
 *   onChange       — (newConditions) => void
 *
 * Each condition: { field: 'load_type', operator: 'any_in', values: ['import', 'export'] }
 * For BETWEEN: { field: 'commodities_weight', operator: 'between', values: ['100'], values2: ['500'] }
 */

// Cache for API-fetched options
const apiCache = {};

function useApiOptions(rule) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!rule || rule.valueType !== 'multi_select_api' || !rule.valueSource) return;

    const cacheKey = rule.valueSource;
    if (apiCache[cacheKey]) {
      setOptions(apiCache[cacheKey]);
      return;
    }

    setLoading(true);
    fetch(rule.valueSource)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        const items = data[rule.valueKey] || [];
        const opts = items.map((item) => ({
          value: String(item[rule.idField] || item.id),
          label: item[rule.labelField] || item.name || item.label || '',
        }));
        apiCache[cacheKey] = opts;
        setOptions(opts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rule?.valueSource]);

  return { options, loading };
}

function ValuePicker({ rule, operator, values = [], values2 = [], onChangeValues, onChangeValues2 }) {
  const { options: apiOptions, loading } = useApiOptions(rule);
  const isRange = isRangeOperator(operator);

  if (!rule) return null;

  // Boolean: Yes/No pills
  if (rule.valueType === 'boolean') {
    return (
      <div className="flex gap-2">
        {[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }].map((opt) => {
          const selected = values.includes(opt.value);
          return (
            <button key={opt.value} type="button"
              onClick={() => {
                const next = selected ? values.filter((v) => v !== opt.value) : [...values, opt.value];
                onChangeValues(next);
              }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                selected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-gray-300'
              }`}>
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  // Boolean OR Number (reefer)
  if (rule.valueType === 'boolean_or_number') {
    return (
      <div className="flex gap-2 items-center">
        {[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }].map((opt) => {
          const selected = values.includes(opt.value);
          return (
            <button key={opt.value} type="button"
              onClick={() => onChangeValues(selected ? values.filter((v) => v !== opt.value) : [...values, opt.value])}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400'
              }`}>
              {opt.label}
            </button>
          );
        })}
        <Input placeholder="Or enter value" className="w-32"
          value={values.find((v) => v !== 'true' && v !== 'false') || ''}
          onChange={(e) => {
            const filtered = values.filter((v) => v === 'true' || v === 'false');
            if (e.target.value) filtered.push(e.target.value);
            onChangeValues(filtered);
          }} />
      </div>
    );
  }

  // Number input (single or dual for BETWEEN)
  if (rule.valueType === 'number') {
    return (
      <div className="flex gap-2 items-center">
        <Input type="number" placeholder={rule.helpText || 'Enter value'} className="w-32"
          value={values[0] || ''}
          onChange={(e) => onChangeValues([e.target.value])} />
        {isRange && (
          <>
            <span className="text-xs text-gray-400 dark:text-slate-500">and</span>
            <Input type="number" placeholder="Max" className="w-32"
              value={(values2 || [])[0] || ''}
              onChange={(e) => onChangeValues2([e.target.value])} />
          </>
        )}
      </div>
    );
  }

  // Time input
  if (rule.valueType === 'time') {
    return (
      <div className="flex gap-2 items-center">
        <input type="time"
          value={values[0] || ''}
          onChange={(e) => onChangeValues([e.target.value])}
          className="rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 px-3 py-2 focus:outline-none focus:border-blue-500" />
        {isRange && (
          <>
            <span className="text-xs text-gray-400 dark:text-slate-500">and</span>
            <input type="time"
              value={(values2 || [])[0] || ''}
              onChange={(e) => onChangeValues2([e.target.value])}
              className="rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 px-3 py-2 focus:outline-none focus:border-blue-500" />
          </>
        )}
      </div>
    );
  }

  // Text tags (freetext multi-value: zip codes, city-state, chassis prefix)
  if (rule.valueType === 'text_tags') {
    const [input, setInput] = useState('');
    return (
      <div>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {values.map((v, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-medium">
              {v}
              <button type="button" onClick={() => onChangeValues(values.filter((_, idx) => idx !== i))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
                e.preventDefault();
                onChangeValues([...values, input.trim()]);
                setInput('');
              }
            }}
            placeholder={rule.helpText || 'Type and press Enter'}
            className="flex-1 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 py-1.5 focus:outline-none focus:border-blue-500" />
        </div>
      </div>
    );
  }

  // Multi-select — API-fetched (searchable dropdown with checkboxes for large lists)
  if (rule.valueType === 'multi_select_api') {
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    if (loading) return <div className="text-xs text-gray-400 dark:text-slate-500 py-1">Loading...</div>;

    const filtered = search
      ? apiOptions.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
      : apiOptions;

    const selectedLabels = values
      .map((v) => apiOptions.find((o) => String(o.value) === v)?.label)
      .filter(Boolean);

    return (
      <div className="relative">
        {/* Selected tags */}
        {selectedLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {selectedLabels.map((label, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-[11px] font-medium">
                {label}
                <button type="button" onClick={() => onChangeValues(values.filter((_, idx) => idx !== i))}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search input that opens dropdown */}
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={`Search ${rule.label.toLowerCase()}... (${apiOptions.length} available)`}
          className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 py-1.5 focus:outline-none focus:border-blue-500"
        />

        {/* Dropdown */}
        {open && (
          <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</div>
            ) : (
              filtered.map((opt) => {
                const selected = values.includes(String(opt.value));
                return (
                  <label key={opt.value}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer">
                    <input type="checkbox" checked={selected}
                      onChange={() => {
                        const val = String(opt.value);
                        onChangeValues(selected ? values.filter((v) => v !== val) : [...values, val]);
                      }}
                      className="rounded text-blue-600 w-3.5 h-3.5" />
                    <span className="text-xs text-gray-800 dark:text-slate-200">{opt.label}</span>
                  </label>
                );
              })
            )}
            <button type="button" onClick={() => { setOpen(false); setSearch(''); }}
              className="w-full text-center text-[10px] text-blue-600 dark:text-blue-400 py-1.5 border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60">
              Done
            </button>
          </div>
        )}
      </div>
    );
  }

  // Multi-select — static (pill buttons for small lists like load types, days, states)
  if (rule.valueType === 'multi_select_static') {
    const opts = rule.options || [];

    return (
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
        {opts.map((opt) => {
          const selected = values.includes(String(opt.value));
          return (
            <button key={opt.value} type="button"
              onClick={() => {
                const val = String(opt.value);
                const next = selected ? values.filter((v) => v !== val) : [...values, val];
                onChangeValues(next);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                selected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600'
              }`}>
              {opt.label}
            </button>
          );
        })}
        {opts.length === 0 && <span className="text-xs text-gray-400 dark:text-slate-500">No options available</span>}
      </div>
    );
  }

  return null;
}

function ConditionRow({ condition, index, rules, onChange, onRemove }) {
  const rule = getRuleByKey(condition.field);
  const rulesByCategory = getRulesByCategory();

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {/* Rule number */}
      <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
        {index + 1}
      </div>

      <div className="flex-1 space-y-2">
        {/* Field selector */}
        <select
          value={condition.field || ''}
          onChange={(e) => {
            const newRule = getRuleByKey(e.target.value);
            onChange({
              ...condition,
              field: e.target.value,
              operator: newRule?.operators?.[0]?.value || 'any_in',
              values: [],
              values2: [],
            });
          }}
          className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 px-3 py-2 focus:outline-none focus:border-blue-500"
        >
          <option value="">— Select Rule —</option>
          {Object.entries(rulesByCategory).map(([cat, catRules]) => (
            <optgroup key={cat} label={cat}>
              {catRules.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {rule && (
          <div className="flex items-start gap-2">
            {/* Operator */}
            <select
              value={condition.operator || rule.operators[0]?.value}
              onChange={(e) => onChange({ ...condition, operator: e.target.value, values2: [] })}
              className="rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-gray-900 dark:text-slate-100 px-2 py-1.5 focus:outline-none focus:border-blue-500 shrink-0"
            >
              {rule.operators.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>

            {/* Value picker */}
            <div className="flex-1">
              <ValuePicker
                rule={rule}
                operator={condition.operator}
                values={condition.values || []}
                values2={condition.values2 || []}
                onChangeValues={(v) => onChange({ ...condition, values: v })}
                onChangeValues2={(v) => onChange({ ...condition, values2: v })}
              />
            </div>
          </div>
        )}
      </div>

      {/* Remove button */}
      <button type="button" onClick={onRemove}
        className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0 mt-0.5">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * ConditionBuilder — the main exported component.
 *
 * Renders a list of condition rows with AND logic between them.
 * "Add Rule" adds a new empty condition.
 */
export default function ConditionBuilder({ rules, conditions = [], onChange }) {
  function addRule() {
    onChange([...conditions, { field: '', operator: 'any_in', values: [] }]);
  }

  function updateRule(index, updated) {
    const next = [...conditions];
    next[index] = updated;
    onChange(next);
  }

  function removeRule(index) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
        Select The Conditions When You Want To Calculate The Charge
      </div>

      {conditions.length === 0 && (
        <div className="text-xs text-gray-400 dark:text-slate-500 py-2">
          No conditions — this charge profile will apply to all matching loads.
        </div>
      )}

      {/* AND logic indicator between rules */}
      {conditions.map((cond, idx) => (
        <div key={idx}>
          {idx > 0 && (
            <div className="flex items-center gap-2 py-1">
              <div className="flex-1 border-t border-gray-200 dark:border-slate-800" />
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-full">AND</span>
              <div className="flex-1 border-t border-gray-200 dark:border-slate-800" />
            </div>
          )}
          <ConditionRow
            condition={cond}
            index={idx}
            rules={rules}
            onChange={(updated) => updateRule(idx, updated)}
            onRemove={() => removeRule(idx)}
          />
        </div>
      ))}

      <button type="button" onClick={addRule}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors">
        <Plus className="w-3.5 h-3.5" />
        Add Rule
      </button>
    </div>
  );
}
