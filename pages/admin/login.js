import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Alert from '../../components/ui/Alert';

export default function AdminLogin() {
  const router = useRouter();
  const { admin, loading: authLoading, login } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && admin) {
      router.replace('/admin');
    }
  }, [authLoading, admin]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email.trim(), password);
      window.location.href = '/admin';
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (authLoading) return null;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="text-4xl font-bold text-blue-400">D</span>
          <div className="leading-tight">
            <span className="text-2xl font-semibold text-white">Drayage</span>
            <span className="text-2xl font-semibold text-white">Direct</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-1">
            Admin Portal
          </h2>
          <p className="text-sm text-gray-500 text-center mb-6">
            Sign in with your DD employee credentials
          </p>

          <Alert type="error" message={error} className="mb-4" />

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email address"
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@drayagedirect.io"
              autoComplete="email"
              required
            />

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

            <Button type="submit" fullWidth loading={loading} className="mt-2">
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
