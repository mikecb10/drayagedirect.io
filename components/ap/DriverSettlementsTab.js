import { useEffect, useState } from 'react';
import { Plus, Clock, CheckCircle2, Lock } from 'lucide-react';
import Button from '../ui/Button';
import Select from '../ui/Select';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Modal from '../ui/Modal';
import DatePicker from '../ui/DatePicker';

function formatCents(c) {
  if (c == null) return '$0.00';
  return `$${(c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function DriverSettlementsTab() {
  const [settlements, setSettlements] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null);

  // Settlement periods for the selector
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');

  // Generate modal
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genForm, setGenForm] = useState({ period_start: '', period_end: '', settlement_period_id: '' });
  const [generating, setGenerating] = useState(false);

  async function loadPeriods() {
    try {
      const res = await fetch('/api/tenant/ap/settlement-periods');
      if (res.ok) {
        const data = await res.json();
        setPeriods(data.settlement_periods || []);
      }
    } catch { /* ignore */ }
  }

  async function loadSettlements() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeFilter) params.set('status', activeFilter);
      if (selectedPeriod) params.set('settlement_period_id', selectedPeriod);
      const res = await fetch(`/api/tenant/ap/settlements?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setSettlements(data.settlements || []);
      setStats(data.stats || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadPeriods(); }, []);
  useEffect(() => { loadSettlements(); }, [activeFilter, selectedPeriod]);

  async function handleGenerate(e) {
    e.preventDefault();
    if (!genForm.period_start || !genForm.period_end) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/tenant/ap/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(genForm),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to generate');
      }
      const data = await res.json();
      setGenerateOpen(false);
      loadSettlements();
      alert(`Generated ${data.count} settlement${data.count !== 1 ? 's' : ''}`);
    } catch (e) { setError(e.message); }
    finally { setGenerating(false); }
  }

  async function updateStatus(settlementId, status) {
    try {
      const res = await fetch(`/api/tenant/ap/settlements/${settlementId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to update');
      }
      loadSettlements();
    } catch (e) { setError(e.message); }
  }

  const STATUS_BADGES = { pending: 'amber', reviewed: 'purple', finalized: 'green' };

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
          placeholder="All Settlement Periods" options={periods.map((p) => ({ value: p.id, label: p.name }))}
        />
        <div className="ml-auto">
          <Button onClick={() => setGenerateOpen(true)}>
            <Plus className="w-4 h-4 mr-1 inline -mt-0.5" />
            Generate Settlements
          </Button>
        </div>
      </div>

      {/* Pipeline */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label: 'Pending', key: 'pending', icon: Clock, color: 'amber' },
          { label: 'Reviewed', key: 'reviewed', icon: CheckCircle2, color: 'purple' },
          { label: 'Finalized', key: 'finalized', icon: Lock, color: 'emerald' },
        ].map((card) => {
          const count = stats[card.key] || 0;
          const active = activeFilter === card.key;
          return (
            <button key={card.key} type="button"
              onClick={() => setActiveFilter(active ? null : card.key)}
              className={`rounded-xl border p-3 text-left transition-all flex-1 min-w-[140px] ${
                active ? 'ring-2 ring-blue-400 bg-gray-50 dark:bg-slate-800/50 border-gray-200 dark:border-slate-700'
                  : 'bg-gray-50 dark:bg-slate-800/50 border-gray-200 dark:border-slate-700 hover:shadow-sm'
              }`}>
              <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{card.label}</div>
              <div className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-0.5">{count}</div>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40">
                {['Settlement #', 'Driver', 'Period', 'Driver Pay', 'Deductions', 'Net Pay', 'Status', 'Actions'].map((h) => (
                  <th key={h} className={`${h === 'Actions' ? 'text-right' : 'text-left'} px-4 py-2.5 font-semibold text-gray-600 dark:text-slate-300 text-xs uppercase tracking-wide`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
              ) : settlements.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No settlements found. Generate settlements for a pay period.</td></tr>
              ) : (
                settlements.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">{s.settlement_number}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-slate-300">{s.driver?.name || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                      {s.period_start && s.period_end ? `${new Date(s.period_start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(s.period_end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-slate-100">{formatCents(s.driver_pay_cents)}</td>
                    <td className="px-4 py-2.5 text-red-600 dark:text-red-400">{s.deduction_cents > 0 ? `-${formatCents(s.deduction_cents)}` : '$0.00'}</td>
                    <td className="px-4 py-2.5 font-bold text-emerald-700 dark:text-emerald-400">{formatCents(s.net_pay_cents)}</td>
                    <td className="px-4 py-2.5"><Badge variant={STATUS_BADGES[s.status] || 'gray'}>{s.status}</Badge></td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex gap-1 justify-end">
                        {s.status === 'pending' && (
                          <button onClick={() => updateStatus(s.id, 'reviewed')}
                            className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 px-2 py-1 rounded hover:bg-purple-50 dark:hover:bg-purple-950/40">
                            Review
                          </button>
                        )}
                        {(s.status === 'pending' || s.status === 'reviewed') && (
                          <button onClick={() => { if (confirm('Finalize this settlement? This cannot be undone.')) updateStatus(s.id, 'finalized'); }}
                            className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                            Finalize
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate Modal */}
      {generateOpen && (
        <Modal isOpen onClose={() => setGenerateOpen(false)} title="Generate Settlements" size="md">
          <form onSubmit={handleGenerate} className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Generate settlements for all drivers with approved pay lines in the selected date range.
            </p>
            <DatePicker label="Period Start" value={genForm.period_start}
              onChange={(e) => setGenForm((f) => ({ ...f, period_start: e.target.value }))} required />
            <DatePicker label="Period End" value={genForm.period_end}
              onChange={(e) => setGenForm((f) => ({ ...f, period_end: e.target.value }))} required />
            <Select label="Settlement Period (optional)"
              value={genForm.settlement_period_id}
              onChange={(e) => setGenForm((f) => ({ ...f, settlement_period_id: e.target.value }))}
              placeholder="— None —" options={periods.map((p) => ({ value: p.id, label: p.name }))}
            />
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => setGenerateOpen(false)}>Cancel</Button>
              <Button type="submit" loading={generating}>Generate</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
