import { useState } from 'react';
import Head from 'next/head';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import TemplateEditor from '../../../../components/settings/ar/TemplateEditor';

export default function ArConfigurationPage() {
  const [tab, setTab] = useState('invoice_send');

  return (
    <SettingsLayout title="AR Configuration">
      <Head><title>AR Configuration · DrayageDirect</title></Head>

      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1">AR Configuration</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          Edit the default email templates used by the Send Invoice and Send Rate Confirmation popups.
        </p>

        <div className="border-b border-gray-200 dark:border-slate-700 mb-4 flex gap-4">
          <button
            type="button"
            onClick={() => setTab('invoice_send')}
            className={`pb-2 text-sm font-medium border-b-2 ${tab === 'invoice_send' ? 'border-blue-600 dark:border-blue-400 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 dark:text-slate-400'}`}
          >Invoice Email</button>
          <button
            type="button"
            onClick={() => setTab('rate_con_send')}
            className={`pb-2 text-sm font-medium border-b-2 ${tab === 'rate_con_send' ? 'border-blue-600 dark:border-blue-400 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 dark:text-slate-400'}`}
          >Rate Con Email</button>
        </div>

        <TemplateEditor key={tab} systemSlug={tab} />
      </div>
    </SettingsLayout>
  );
}
