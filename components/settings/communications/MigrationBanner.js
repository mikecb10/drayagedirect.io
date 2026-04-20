import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';

/**
 * One-time informational banner for tenants auto-migrated to the default
 * sender tier. Dismissal stored in localStorage keyed by tenant_id.
 *
 * Props:
 *   tenantId       UUID  — for the localStorage key
 *   migratedAt     string|null — tenants.sender_migration_at; null = hide
 *   fromAddress    string — platform-domain from-address (e.g. "acme@drayagedirect.io")
 *   replyToEmail   string — resolved reply-to email
 */
export default function MigrationBanner({ tenantId, migratedAt, fromAddress, replyToEmail }) {
  const [dismissed, setDismissed] = useState(true); // start dismissed until we read LS

  useEffect(() => {
    if (!tenantId) return;
    const key = `sender_migration_dismissed:${tenantId}`;
    setDismissed(localStorage.getItem(key) === '1');
  }, [tenantId]);

  if (!migratedAt || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(`sender_migration_dismissed:${tenantId}`, '1');
    setDismissed(true);
  };

  return (
    <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-950">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="flex-1">
          <p className="font-semibold text-blue-900 dark:text-blue-100">
            We&apos;ve upgraded your email sender
          </p>
          <p className="mt-1 text-blue-800 dark:text-blue-200">
            Your emails now send from{' '}
            <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs dark:bg-blue-900">
              {fromAddress}
            </code>{' '}
            for better deliverability. Customer replies still come to you at{' '}
            <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs dark:bg-blue-900">
              {replyToEmail || '(your account email)'}
            </code>
            .
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
