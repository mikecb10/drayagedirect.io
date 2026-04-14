import { Settings, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import SettingsLayout from '../../components/settings/SettingsLayout';
import { SETTINGS_SECTIONS } from '../../lib/settings-nav';

export default function SettingsIndex() {
  return (
    <SettingsLayout title="Settings">
      <div className="max-w-4xl">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Settings Overview</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Configure your company, team, and operational preferences. Select a section from the sidebar to get started.
          </p>
        </div>

        {/* Quick-access cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SETTINGS_SECTIONS.filter((s) => s.group !== 'Coming Soon').map((section) => (
            <div key={section.group} className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">{section.group}</h3>
              <div className="space-y-2">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className="flex items-center gap-3 text-sm text-gray-600 dark:text-slate-300 hover:text-blue-600 group"
                    >
                      <Icon className="w-4 h-4 text-gray-400 dark:text-slate-500 group-hover:text-blue-500" />
                      <span className="flex-1">{item.label}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-300 dark:text-slate-600 group-hover:text-blue-400" />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Coming soon section */}
        <div className="mt-6 rounded-xl border border-dashed border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 p-5">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-slate-400 mb-3">Coming Soon</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SETTINGS_SECTIONS.find((s) => s.group === 'Coming Soon')?.items.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.key} className="flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500">
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </SettingsLayout>
  );
}
