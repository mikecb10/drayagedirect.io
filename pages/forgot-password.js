import { useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '../lib/supabase-browser';
import Logo from '../components/Logo';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Alert from '../components/ui/Alert';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = getSupabaseBrowserClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/change-password` }
    );

    if (resetError) {
      setError(resetError.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size="large" />
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-1">
            Reset your password
          </h2>
          <p className="text-sm text-gray-500 text-center mb-6">
            Enter your email and we&apos;ll send you a reset link
          </p>

          {sent ? (
            <Alert
              type="success"
              message="If an account exists with that email, you will receive a password reset link shortly. Check your inbox."
            />
          ) : (
            <>
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

                <Button type="submit" fullWidth loading={loading}>
                  Send reset link
                </Button>
              </form>
            </>
          )}

          <div className="text-center mt-6">
            <Link
              href="/login"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
