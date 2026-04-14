export default function DriverNotesTab({ form, update }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Driver Notes</label>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
        Internal notes about this driver. Not visible to the driver in the mobile app.
      </p>
      <textarea
        value={form.notes || ''}
        onChange={(e) => update('notes', e.target.value)}
        rows={10}
        className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
        placeholder="Anything you want to remember about this driver..."
      />
    </div>
  );
}
