import ConditionBuilder from '../../ui/ConditionBuilder';
import { AR_RULES } from '../../../lib/ar-rule-definitions';

/**
 * RulesPanel — wraps <ConditionBuilder> with the AR_RULES catalog.
 * Section 3 of the charge profile detail page.
 *
 * Pure presentational. Owns no state.
 */
export default function RulesPanel({ conditions, onChange }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
      <ConditionBuilder
        rules={AR_RULES}
        conditions={conditions}
        onChange={onChange}
      />
    </div>
  );
}
