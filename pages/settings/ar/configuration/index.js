import { useState } from 'react';
import Head from 'next/head';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import TemplateEditor from '../../../../components/settings/ar/TemplateEditor';

// Tabs are 1:1 with email_templates.system_slug values so the tab key
// is also the key used by TemplateEditor's GET/PUT/Reset endpoints.
// Order: single variants first, then bulk variants, grouped by doc type.
const TABS = [
  { slug: 'invoice_send',       label: 'Invoice Email (Single)' },
  { slug: 'invoice_bulk_send',  label: 'Invoice Email (Bulk)' },
  { slug: 'rate_con_send',      label: 'Rate Con Email (Single)' },
  { slug: 'rate_con_bulk_send', label: 'Rate Con Email (Bulk)' },
];

export default function ArConfigurationPage() {
  const [tab, setTab] = useState('invoice_send');

  return (
    <SettingsLayout title="AR Configuration">
      <Head><title>AR Configuration · DrayageDirect</title></Head>

      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1">AR Configuration</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          Edit the default email templates used by the Send Invoice and Send Rate Confirmation popups.
          Single variants fire when sending one doc; Bulk variants fire when the same customer gets
          multiple docs in one email.
        </p>

        <div className="border-b border-gray-200 dark:border-slate-700 mb-4 flex gap-4 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => setTab(t.slug)}
              className={`pb-2 text-sm font-medium border-b-2 ${tab === t.slug ? 'border-blue-600 dark:border-blue-400 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 dark:text-slate-400'}`}
            >{t.label}</button>
          ))}
        </div>

        <TemplateEditor key={tab} systemSlug={tab} />
      </div>
    </SettingsLayout>
  );
}
