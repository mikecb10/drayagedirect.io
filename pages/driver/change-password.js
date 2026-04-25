import { useState } from 'react';
import { useRouter } from 'next/router';

export default function DriverChangePassword() {
  const router = useRouter();
  const [oldPwd, setOld] = useState('');
  const [newPwd, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (newPwd !== confirm) {
      setError('New passwords do not match');
      return;
    }
    if (newPwd.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem('dd_driver_token');
      const res = await fetch('/api/driver/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || data.error || 'Password change failed');
        return;
      }
      // password change invalidates current token; clear and re-login
      localStorage.removeItem('dd_driver_token');
      router.push('/driver/login');
    } catch (err) {
      setError('Network error — try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-4 border border-gray-200 dark:border-gray-700"
      >
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Set Your Password</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Your dispatcher gave you a temporary password. Choose a new one to continue.
        </p>
        {[
          { label: 'Current password', val: oldPwd, set: setOld, autoComplete: 'current-password' },
          { label: 'New password', val: newPwd, set: setNew, autoComplete: 'new-password' },
          { label: 'Confirm new password', val: confirm, set: setConfirm, autoComplete: 'new-password' },
        ].map((f) => (
          <div key={f.label}>
            <label className="block text-sm text-gray-700 dark:text-gray-300">{f.label}</label>
            <input
              type="password" value={f.val} onChange={(e) => f.set(e.target.value)}
              autoComplete={f.autoComplete} required
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </div>
        ))}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit" disabled={submitting}
          className="w-full rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 font-medium"
        >
          {submitting ? 'Saving…' : 'Save Password'}
        </button>
      </form>
    </div>
  );
}
