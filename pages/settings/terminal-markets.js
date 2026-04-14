import { useEffect, useState, useMemo } from 'react';
import { MapPin, Ship, Train, Search, Globe } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import Alert from '../../components/ui/Alert';


export default function TerminalMarketsPage() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  async function fetchMarkets() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/terminal-markets');
      if (!res.ok) throw new Error('Failed to load markets');
      const data = await res.json();
      setMarkets(data.markets || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMarkets();
  }, []);

  async function toggleMarket(market, enabled) {
    // Optimistic
    setMarkets((ms) => ms.map((m) => (m.market === market ? { ...m, enabled } : m)));
    try {
      const res = await fetch('/api/tenant/terminal-markets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market, enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle market');
    } catch (e) {
      setError(e.message);
      fetchMarkets();
    }
  }

  async function batchToggle(country, enabled) {
    const targets = markets.filter((m) => m.country === country);
    setMarkets((ms) =>
      ms.map((m) => (m.country === country ? { ...m, enabled } : m))
    );
    try {
      await Promise.all(
        targets.map((t) =>
          fetch('/api/tenant/terminal-markets', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ market: t.market, enabled }),
          })
        )
      );
    } catch (e) {
      setError(e.message);
      fetchMarkets();
    }
  }

  const filtered = useMemo(() => {
    if (!search) return markets;
    const q = search.toLowerCase();
    return markets.filter((m) => m.market.toLowerCase().includes(q));
  }, [markets, search]);

  const usMarkets = filtered.filter((m) => m.country === 'US');
  const caMarkets = filtered.filter((m) => m.country === 'CAN');

  const enabledCount = markets.filter((m) => m.enabled).length;
  const totalTerminals = markets.reduce((s, m) => s + m.total, 0);
  const enabledTerminals = markets
    .filter((m) => m.enabled)
    .reduce((s, m) => s + m.total, 0);

  return (
    <SettingsLayout title="Terminal Markets">
      <div className="space-y-6 max-w-6xl">
        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Terminal Markets</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Enable markets to populate terminals (marine ports and rail ramps) into your instance.
            Terminals in enabled markets become available as pickup, delivery, and return locations.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Markets" value={markets.length} />
          <StatCard label="Enabled Markets" value={enabledCount} />
          <StatCard label="Total Terminals" value={totalTerminals} />
          <StatCard label="Active Terminals" value={enabledTerminals} />
        </div>

        {/* Search + batch */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search markets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
            />
          </div>
          <button
            onClick={() => batchToggle('US', true)}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800"
          >
            Enable All US
          </button>
          <button
            onClick={() => batchToggle('CAN', true)}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800"
          >
            Enable All Canada
          </button>
          <button
            onClick={() => {
              batchToggle('US', false);
              batchToggle('CAN', false);
            }}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            Disable All
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400 dark:text-slate-500">Loading markets…</div>
        ) : (
          <>
            {/* US Markets */}
            {usMarkets.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="w-4 h-4 text-blue-500" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">United States</h2>
                  <span className="text-xs text-gray-400 dark:text-slate-500">({usMarkets.length} markets)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {usMarkets.map((m) => (
                    <MarketCard key={m.market} market={m} onToggle={toggleMarket} />
                  ))}
                </div>
              </div>
            )}

            {/* CA Markets */}
            {caMarkets.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="w-4 h-4 text-red-500" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Canada</h2>
                  <span className="text-xs text-gray-400 dark:text-slate-500">({caMarkets.length} markets)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {caMarkets.map((m) => (
                    <MarketCard key={m.market} market={m} onToggle={toggleMarket} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </SettingsLayout>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
      <div className="text-2xl font-semibold text-gray-900 dark:text-slate-100">{value}</div>
      <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

function MarketCard({ market, onToggle }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-xl border bg-white dark:bg-slate-900 transition-colors ${
        market.enabled ? 'border-blue-200 dark:border-blue-800 ring-1 ring-blue-100 dark:ring-blue-900/60' : 'border-gray-200 dark:border-slate-800'
      }`}
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className={`w-4 h-4 shrink-0 ${market.enabled ? 'text-blue-500 dark:text-blue-400' : 'text-gray-300 dark:text-slate-600'}`} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">{market.market}</div>
            <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500 dark:text-slate-400">
              <button type="button" onClick={() => setExpanded(expanded === 'marine' ? false : 'marine')}
                className={`inline-flex items-center gap-0.5 transition-colors ${expanded === 'marine' ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'hover:text-blue-600 dark:hover:text-blue-400'}`}>
                <Ship className="w-3 h-3" /> {market.marine}
              </button>
              <button type="button" onClick={() => setExpanded(expanded === 'rail' ? false : 'rail')}
                className={`inline-flex items-center gap-0.5 transition-colors ${expanded === 'rail' ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'hover:text-amber-600 dark:hover:text-amber-400'}`}>
                <Train className="w-3 h-3" /> {market.rail}
              </button>
              <span className="text-gray-400 dark:text-slate-500">· {market.total} total</span>
            </div>
          </div>
        </div>
        {/* Toggle */}
        <button
          type="button"
          onClick={() => onToggle(market.market, !market.enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            market.enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-700'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              market.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Expanded terminal list */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-slate-800 px-4 py-2 max-h-48 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-slate-500 mb-1.5">
            {expanded === 'marine' ? `Marine Ports (${market.marine})` : `Rail Ramps (${market.rail})`}
          </div>
          <div className="grid grid-cols-1 gap-0.5">
            {(expanded === 'marine' ? market.marine_names : market.rail_names || []).map((name, i) => (
              <div key={i} className="text-[11px] text-gray-700 dark:text-slate-300 py-0.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-slate-800/60">
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                  expanded === 'marine' ? 'bg-blue-400' : 'bg-amber-400'
                }`} />
                {name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
