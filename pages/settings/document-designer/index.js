import Link from 'next/link';
import { FileText } from 'lucide-react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import { DOCUMENT_TYPES } from '../../../lib/constants/document-types';

export default function DocumentDesignerIndex() {
  return (
    <SettingsLayout title="Document Designer">
      <div className="max-w-4xl">
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Document Designer
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Customize how your printed documents look. Each document type has a <strong>tenant default</strong> applied to every load, plus optional <strong>customer-specific overrides</strong> that take priority for loads with that bill-to customer.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {DOCUMENT_TYPES.map((dt) => (
            <Link
              key={dt.value}
              href={`/settings/document-designer/${dt.value}`}
              className="block rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold text-gray-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-300">
                    {dt.label}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    {dt.description}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </SettingsLayout>
  );
}
