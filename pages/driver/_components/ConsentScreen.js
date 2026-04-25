import { CONSENT_TITLE, CONSENT_BODY } from '../../../lib/driver-consent/text.js';
import { CURRENT_CONSENT_VERSION } from '../../../lib/driver-consent/version.js';
import { driverFetch } from '../../../lib/driver-app/auth.js';

export default function ConsentScreen({ onAccept, onDecline }) {
  async function handleAccept() {
    const res = await driverFetch('/api/driver/me/consent', {
      method: 'POST',
      body: JSON.stringify({ version: CURRENT_CONSENT_VERSION }),
    });
    if (res.ok) onAccept?.();
    else alert('Could not save consent — try again');
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{CONSENT_TITLE}</h2>
        <pre className="mt-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans">{CONSENT_BODY}</pre>
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onDecline} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">
            Decline
          </button>
          <button onClick={handleAccept} className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
