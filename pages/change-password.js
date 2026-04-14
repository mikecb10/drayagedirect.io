import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../contexts/AuthContext';
import Logo from '../components/Logo';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Alert from '../components/ui/Alert';

export default function ChangePassword() {
  const router = useRouter();
  const { loading: authLoading } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const passwordErrors = [];
  if (newPassword && newPassword.length < 8) passwordErrors.push('At least 8 characters');
  if (newPassword && !/[A-Z]/.test(newPassword)) passwordErrors.push('One uppercase letter');
  if (newPassword && !/[0-9]/.test(newPassword)) passwordErrors.push('One number');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (passwordErrors.length > 0) {
      setError('Please meet all password requirements.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        setLoading(false);
        return;
      }

      router.push('/dashboard');
    } catch (err) {
      setError('Unable to connect. Please try again.');
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size="large" />
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-1">
            Change your password
          </h2>
          <p className="text-sm text-gray-500 text-center mb-6">
            Your account requires a password update
          </p>

          <Alert type="error" message={error} className="mb-4" />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                label="New password"
                type="password"
                name="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                autoComplete="new-password"
                required
              />
              {newPassword && (
                <div className="mt-2 space-y-1">
                  {[
                    { test: newPassword.length >= 8, label: 'At least 8 characters' },
                    { test: /[A-Z]/.test(newPassword), label: 'One uppercase letter' },
                    { test: /[0-9]/.test(newPassword), label: 'One number' },
                  ].map(({ test, label }) => (
                    <div key={label} className="flex items-center gap-1.5 text-xs">
                      <span className={test ? 'text-green-500' : 'text-gray-400'}>
                        {test ? '✓' : '○'}
                      </span>
                      <span className={test ? 'text-green-700' : 'text-gray-500'}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Input
              label="Confirm new password"
              type="password"
              name="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              error={
                confirmPassword && newPassword !== confirmPassword
                  ? 'Passwords do not match'
                  : ''
              }
              required
            />

            <Button type="submit" fullWidth loading={loading} className="mt-2">
              Update password
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
