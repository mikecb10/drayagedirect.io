import { Settings } from 'lucide-react';
import Link from 'next/link';
import SettingsLayout from '../../components/settings/SettingsLayout';
import useSettingsViewPrefs from '../../components/settings/useSettingsViewPrefs';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';
import { SETTINGS_SECTIONS } from '../../lib/settings-nav';
import { useAuth } from '../../contexts/AuthContext';
import { filterByPermissions } from '../../lib/permissions';

// Card-mode descriptions, keyed by item.key. New items default to '' (no description).
const ITEM_DESCRIPTIONS = {
  company: 'Company info, invoice defaults, branding, regional settings.',
  profile: 'Your name, email, password, and personal preferences.',
  charge_profiles: 'AR pricing rules and charge sets.',
  tariffs: 'Customer-facing rate sheets.',
  per_diem: 'Tiered per-diem free day pricing rules.',
  dispatcher_colors: 'Customize how loads appear on the Dispatcher board.',
  document_validation: 'Choose which document types require dispatcher approval.',
  document_designer: 'Customize printed documents per tenant or per customer.',
  container_owners: 'Steamship lines and container owner directory.',
  chassis_owners: 'Pool operators, leased fleets, and your own chassis fleet.',
  equipment_reference: 'Container types, container sizes, chassis types, chassis sizes.',
  terminal_markets: 'Enable the geographic markets where your operation runs.',
  terminals: 'Individual port and rail terminals; toggle and customize names.',
  branches: 'Regional offices or divisions for scoping users and loads.',
  team: 'Users, roles, and granular permissions.',
  comm_formatting: 'Email signature and template formatting defaults.',
  comm_templates: 'Outbound email template library.',
  comm_umbrellas: 'Email triggering rules grouped by event.',
  comm_configurations: 'Per-trigger email configuration.',
  comm_shared_accounts: 'Inbox accounts shared by the team.',
  comm_sender_domains: 'Verified sending domains.',
  comm_sender_addresses: 'Configured sender email addresses.',
  comm_trigger_activity: 'Recent automation trigger activity log.',
};

function SettingsIndex() {
  const { viewMode } = useSettingsViewPrefs();
  const { role, permissions, loading: authLoading } = useAuth();
  const user = { role, permissions };

  const groups = SETTINGS_SECTIONS
    .filter((s) => s.group !== 'Coming Soon')
    .map((section) => ({ ...section, items: filterByPermissions(section.items, user) }))
    .filter((section) => section.items.length > 0);

  const comingSoon = SETTINGS_SECTIONS.find((s) => s.group === 'Coming Soon')?.items || [];

  if (authLoading) {
    return <IndexSkeleton viewMode={viewMode} />;
  }

  if (viewMode === 'card') {
    return <CardGridIndex groups={groups} comingSoon={comingSoon} />;
  }

  // Sidebar-mode index — current Plan C "What's here" summary
  return (
    <div className="max-w-3xl">
      <PageHeader
        variant="plain"
        title={<><Settings className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Settings</>}
        description="Configure your company, team, and operational preferences. Pick a section from the sidebar to get started."
        className="mb-[var(--space-section)]"
      />
      <div className="space-y-[var(--space-section)]">
        <SectionCard title="What's here" columns={0}>
          <DetailPane>
            {groups.map((section) => (
              <DetailRow
                key={section.group}
                label={section.group}
                value={section.items.map((i) => i.label).join(' · ')}
              />
            ))}
          </DetailPane>
        </SectionCard>
        {comingSoon.length > 0 && (
          <SectionCard
            title="Coming soon"
            description="Planned features not yet available."
            columns={0}
          >
            <p className="text-helper text-muted">
              {comingSoon.map((i) => i.label).join(' · ')}
            </p>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function CardGridIndex({ groups, comingSoon }) {
  return (
    <div className="max-w-6xl">
      <PageHeader
        variant="plain"
        title={<><Settings className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Settings</>}
        description="Configure your company, team, and operational preferences."
        className="mb-[var(--space-section)]"
      />
      <div className="space-y-[var(--space-section)]">
        {groups.map((section) => (
          <div key={section.group}>
            <h2 className="text-field-label text-muted mb-[var(--space-field-label)]">{section.group}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-field)]">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="block rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-[var(--space-section-pad)] hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-body font-semibold text-strong group-hover:text-blue-700 dark:group-hover:text-blue-300">
                          {item.label}
                        </div>
                        {ITEM_DESCRIPTIONS[item.key] && (
                          <p className="text-helper text-muted mt-[var(--space-field-helper)]">
                            {ITEM_DESCRIPTIONS[item.key]}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {comingSoon.length > 0 && (
          <div>
            <h2 className="text-field-label text-muted mb-[var(--space-field-label)]">Coming Soon</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-field)]">
              {comingSoon.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.key}
                    className="block rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-900/40 p-[var(--space-section-pad)] opacity-60"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="w-5 h-5 text-muted shrink-0 mt-0.5" />
                      <div>
                        <div className="text-body font-semibold text-muted">{item.label}</div>
                        <p className="text-helper text-muted mt-[var(--space-field-helper)]">Coming soon</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IndexSkeleton({ viewMode }) {
  if (viewMode === 'card') {
    return (
      <div className="max-w-6xl animate-pulse" aria-label="Loading settings">
        <div className="h-7 w-32 bg-gray-200 dark:bg-slate-800 rounded mb-6" />
        {[1, 2].map((g) => (
          <div key={g} className="mb-6">
            <div className="h-4 w-20 bg-gray-200 dark:bg-slate-800 rounded mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-field)]">
              {[1, 2, 3].map((c) => (
                <div key={c} className="h-20 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/40" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="max-w-3xl animate-pulse" aria-label="Loading settings">
      <div className="h-7 w-32 bg-gray-200 dark:bg-slate-800 rounded mb-4" />
      <div className="h-48 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/40" />
    </div>
  );
}

SettingsIndex.getLayout = (page) => (
  <SettingsLayout title="Settings">{page}</SettingsLayout>
);

export default SettingsIndex;
