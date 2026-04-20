// components/settings/communications/SenderPreview.js
/**
 * Read-only "how recipients will see this" preview pane.
 * Renders the final From: and Reply-To as they will appear in the inbox.
 *
 * Props:
 *   fromDisplayName  string   — resolved display name
 *   fromAddress      string   — resolved From: email address
 *   replyToEmail     string?  — resolved Reply-To email (null = hide row)
 *   replyToName      string?  — resolved Reply-To name
 */
export default function SenderPreview({
  fromDisplayName,
  fromAddress,
  replyToEmail,
  replyToName,
}) {
  const replyToCombined = replyToEmail
    ? replyToName
      ? `"${replyToName}" <${replyToEmail}>`
      : replyToEmail
    : null;

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm font-mono dark:border-slate-700 dark:bg-slate-900">
      <div className="flex gap-2">
        <span className="w-16 text-gray-500 dark:text-slate-400">From:</span>
        <span className="text-gray-900 dark:text-slate-100">
          {fromDisplayName} &lt;{fromAddress}&gt;
        </span>
      </div>
      {replyToCombined && (
        <div className="mt-1 flex gap-2">
          <span className="w-16 text-gray-500 dark:text-slate-400">Reply-To:</span>
          <span className="text-gray-900 dark:text-slate-100">{replyToCombined}</span>
        </div>
      )}
    </div>
  );
}
