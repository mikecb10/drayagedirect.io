// components/settings/communications/SenderIdentityFields.js
import { useMemo } from 'react';
import SenderPreview from './SenderPreview';

/**
 * Form section: Display Name + Reply-To inputs + live preview.
 *
 * Props:
 *   value     { from_display_name, reply_to_email, reply_to_name }
 *   onChange  (patch) => void — merge-patch into parent state.
 *                               Special key `_reply_to_raw` carries the
 *                               unparsed Reply-To input for the parent
 *                               to parse via parseReplyTo() on blur.
 *   tenant    { name, slug, email }
 *   platformDomain  string — e.g. "mail.drayagedirect.com"
 *   errors    { from_display_name?, reply_to?: string }  // validation errors
 */
export default function SenderIdentityFields({
  value,
  onChange,
  tenant,
  platformDomain,
  errors = {},
}) {
  // Build the combined Reply-To display from the structured state.
  const combinedReplyTo = useMemo(() => {
    if (!value.reply_to_email) return '';
    return value.reply_to_name
      ? `"${value.reply_to_name}" <${value.reply_to_email}>`
      : value.reply_to_email;
  }, [value.reply_to_email, value.reply_to_name]);

  const fromAddress = `${tenant.slug}@${platformDomain}`;
  const previewName = (value.from_display_name || tenant.name || 'DrayageDirect Notifications').trim();

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sender Identity</h3>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Display Name
        </label>
        <input
          type="text"
          value={value.from_display_name || ''}
          maxLength={100}
          onChange={(e) => onChange({ from_display_name: e.target.value })}
          placeholder={tenant.name || ''}
          className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          How your company appears in the recipient&apos;s inbox.
        </p>
        {errors.from_display_name && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.from_display_name}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Reply-To Address
        </label>
        <input
          type="text"
          defaultValue={combinedReplyTo}
          onBlur={(e) => onChange({ _reply_to_raw: e.target.value })}
          placeholder='"Acme Trucking" <acme@acmetrucking.com>'
          className="mt-1 block w-full rounded border-gray-300 font-mono shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Where replies go. Format: &quot;Display Name&quot; &lt;email&gt;. Leave blank to use your
          account email.
        </p>
        {errors.reply_to && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.reply_to}</p>
        )}
      </div>

      <SenderPreview
        fromDisplayName={previewName}
        fromAddress={fromAddress}
        replyToEmail={value.reply_to_email}
        replyToName={value.reply_to_name}
        showViaNote={true}
      />
    </section>
  );
}
