import { useState } from 'react';
import { useRouter } from 'next/router';

export default function DriverLogin() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/driver/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || data.error || 'Login failed');
        return;
      }
      localStorage.setItem('dd_driver_token', data.token);
      localStorage.setItem('dd_driver_id', data.driver.id);
      localStorage.setItem('dd_driver_name', data.driver.name || '');
      if (data.driver.must_change_password) {
        router.push('/driver/change-password');
      } else {
        router.push('/driver');
      }
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
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Driver Sign In</h1>
        <div>
          <label className="block text-sm text-gray-700 dark:text-gray-300">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            autoComplete="username" required
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700 dark:text-gray-300">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            autoComplete="current-password" required
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit" disabled={submitting}
          className="w-full rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 font-medium"
        >
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
