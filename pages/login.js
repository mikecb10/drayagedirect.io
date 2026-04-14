import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '../lib/supabase-browser';
import Logo from '../components/Logo';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Alert from '../components/ui/Alert';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Step 1: Server-side login (checks lockout, sets JWT metadata)
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(
          data.attemptsLeft !== undefined
            ? `${data.error} ${data.attemptsLeft} attempt${data.attemptsLeft !== 1 ? 's' : ''} remaining.`
            : data.error
        );
        setLoading(false);
        return;
      }

      // Step 2: Client-side sign in to get fresh JWT with tenant_id in metadata
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      // Redirect to dashboard (or change-password if required)
      if (data.profile.password_change_required) {
        window.location.href = '/change-password';
      } else {
        window.location.href = '/dashboard';
      }
    } catch (err) {
      setError('Unable to connect. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Logo size="large" />
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 text-center mb-1">
            Welcome back
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 text-center mb-6">
            Sign in to your account
          </p>

          <Alert type="error" message={error} className="mb-4" />

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email address"
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />

            <div>
              <Input
                label="Password"
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
              <div className="flex justify-end mt-1">
                <Link
                  href="/forgot-password"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <Button
              type="submit"
              fullWidth
              loading={loading}
              className="mt-2"
            >
              Sign in
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500 dark:text-slate-400 mt-6">
          Need an account?{' '}
          <a
            href="mailto:support@drayagedirect.io"
            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
          >
            Contact us
          </a>
        </p>
      </div>
    </div>
  );
}
