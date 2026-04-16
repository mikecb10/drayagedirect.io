import DatePicker from './DatePicker';

/**
 * EffectiveDateRange — paired start/end DatePicker fields with consistent
 * labels. Used wherever a record has effective_start/effective_end dates
 * (tariffs, charge profiles, driver tariffs).
 *
 *   <EffectiveDateRange
 *     start={form.effective_start}
 *     end={form.effective_end}
 *     onStartChange={(val) => update('effective_start', val)}
 *     onEndChange={(val) => update('effective_end', val)}
 *     startLabel="Effective Start Date"   // optional, defaults shown
 *     endLabel="Effective End Date"       // optional
 *     startRequired                        // optional, prepends *
 *   />
 *
 * Originally inlined in pages/settings/tariffs/[id].js. Promoted in
 * Plan G1 for AP driver-tariffs reuse (Plan G3) and charge-profile reuse
 * (Plan G2).
 */
export default function EffectiveDateRange({
  start,
  end,
  onStartChange,
  onEndChange,
  startLabel = 'Effective Start Date',
  endLabel = 'Effective End Date',
  startRequired = false,
  endRequired = false,
}) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
          {startRequired && '* '}
          {startLabel}
        </label>
        <DatePicker
          value={start || ''}
          onChange={onStartChange}
          placeholder="Select start date"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">
          {endRequired && '* '}
          {endLabel}
        </label>
        <DatePicker
          value={end || ''}
          onChange={onEndChange}
          placeholder="Select end date"
        />
      </div>
    </>
  );
}
