import { useEffect, useState } from 'react';
import Head from 'next/head';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import MarginBadge from '../../../components/ui/MarginBadge';
import { computeLoadMargin } from '../../../lib/load-margin';
import { invalidateMarginPalette } from '../../../hooks/useMarginPalette';

export default function MarginThresholdsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [red, setRed] = useState('15');
  const [yellow, setYellow] = useState('30');
  const [includeDryRuns, setIncludeDryRuns] = useState(true);
  const [palette, setPalette] = useState('default');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/tenant/me/margin-thresholds');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        setRed(String(data.red_threshold));
        setYellow(String(data.yellow_threshold));
        setIncludeDryRuns(data.include_dry_runs);
        setPalette(data.palette || 'default');
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const redNum    = Number(red);
  const yellowNum = Number(yellow);
  const orderingValid =
    Number.isFinite(redNum) &&
    Number.isFinite(yellowNum) &&
    yellowNum > redNum;

  async function save() {
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch('/api/tenant/me/margin-thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          red_threshold: redNum,
          yellow_threshold: yellowNum,
          include_dry_runs: includeDryRuns,
          palette,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      // Bust the per-session palette cache so MarginBadge picks up the
      // new choice on next render across the app.
      invalidateMarginPalette();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Live preview sample rows — 10% / 20% / 35% margin under current thresholds.
  const previewScenarios = [
    { revenue: 10000, cost: 9000, label: '10% margin' },
    { revenue: 10000, cost: 8000, label: '20% margin' },
    { revenue: 10000, cost: 6500, label: '35% margin' },
  ];

  if (loading) {
    return (
      <SettingsLayout title="Margin Thresholds">
        <div className="max-w-xl animate-pulse">
          <div className="h-8 w-64 bg-gray-200 dark:bg-slate-800 rounded mb-4" />
          <div className="h-32 bg-gray-100 dark:bg-slate-900 rounded" />
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout title="Margin Thresholds">
      <Head><title>Margin Thresholds · DrayageDirect</title></Head>
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1">
          Margin Thresholds
        </h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          Loads show a colored margin pill across the dispatcher board, AR pipeline, and load detail.
          Set your thresholds here. Margin = (Revenue &minus; Driver Pay) &divide; Revenue &times; 100.
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Red threshold (&le;)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={red}
                  onChange={(e) => setRed(e.target.value)}
                />
                <span className="text-sm text-gray-500 dark:text-slate-400">%</span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Margins at or below this percent paint red.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Yellow upper threshold (&le;)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={yellow}
                  onChange={(e) => setYellow(e.target.value)}
                />
                <span className="text-sm text-gray-500 dark:text-slate-400">%</span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Above red, at-or-below this percent paints yellow. Above this paints green.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="include_dry_runs"
              type="checkbox"
              checked={includeDryRuns}
              onChange={(e) => setIncludeDryRuns(e.target.checked)}
              className="rounded border-gray-300 dark:border-slate-600"
            />
            <label
              htmlFor="include_dry_runs"
              className="text-sm text-gray-700 dark:text-slate-300"
            >
              Include dry runs in margin calc
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Color palette
            </label>
            <div className="flex flex-col gap-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input
                  type="radio"
                  name="margin_palette"
                  value="default"
                  checked={palette === 'default'}
                  onChange={() => setPalette('default')}
                  className="border-gray-300 dark:border-slate-600"
                />
                Default <span className="text-gray-500 dark:text-slate-400">— red / yellow / green</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input
                  type="radio"
                  name="margin_palette"
                  value="colorblind"
                  checked={palette === 'colorblind'}
                  onChange={() => setPalette('colorblind')}
                  className="border-gray-300 dark:border-slate-600"
                />
                Colorblind-friendly <span className="text-gray-500 dark:text-slate-400">— orange / yellow / blue</span>
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              The colorblind-friendly variant swaps red→orange and green→blue so red-green colorblind users (~5% of men) can distinguish the buckets.
            </p>
          </div>

          {!orderingValid && (
            <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              Yellow threshold must be greater than red threshold.
            </div>
          )}

          {error && (
            <div className="rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving || !orderingValid}>
              {saving ? 'Saving\u2026' : 'Save'}
            </Button>
            {saved && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>
            )}
          </div>

          <div className="mt-6 border-t border-gray-200 dark:border-slate-800 pt-4">
            <h2 className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              Preview with current thresholds
            </h2>
            <div className="space-y-2">
              {previewScenarios.map((s) => {
                const m = computeLoadMargin({
                  revenueCents: s.revenue,
                  costCents: s.cost,
                  redThreshold:    orderingValid ? redNum    : 15,
                  yellowThreshold: orderingValid ? yellowNum : 30,
                });
                return (
                  <div key={s.label} className="flex items-center gap-3 text-sm text-gray-600 dark:text-slate-400">
                    <span className="w-24">{s.label}:</span>
                    <MarginBadge marginPct={m.marginPct} bucket={m.bucket} size="sm" palette={palette} />
                    <span className="text-xs text-gray-400 dark:text-slate-500">
                      {palette === 'colorblind' ? 'colorblind preview' : 'default preview'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </SettingsLayout>
  );
}
