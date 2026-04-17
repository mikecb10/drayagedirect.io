import { useEffect, useState } from 'react';

/**
 * DriverGroupSelect — fetches /api/tenant/ap/driver-groups once and
 * renders a simple <select>. Value is the group id (or null for
 * "all groups"). Owns its own internal state (groups + loading).
 *
 * Originally defined inside pages/settings/driver-tariffs/[id].js.
 * Extracted to its own file in Plan G3 with no behavior change.
 */
export default function DriverGroupSelect({ value, onChange }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/tenant/ap/driver-groups');
        if (res.ok) {
          const data = await res.json();
          setGroups(data.driver_groups || data.groups || []);
        }
      } catch {
        // silent — user will see empty dropdown
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={loading}
      className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
    >
      <option value="">All Driver Groups</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>{g.name}</option>
      ))}
    </select>
  );
}
