import { Settings } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';
import { SETTINGS_SECTIONS } from '../../lib/settings-nav';

export default function SettingsIndex() {
  const groups = SETTINGS_SECTIONS.filter((s) => s.group !== 'Coming Soon');
  const comingSoon = SETTINGS_SECTIONS.find((s) => s.group === 'Coming Soon')?.items || [];

  return (
    <SettingsLayout title="Settings">
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
    </SettingsLayout>
  );
}
