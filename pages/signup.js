import { useEffect } from 'react';
import { useRouter } from 'next/router';

/**
 * Signup is admin-provisioned — users are created via Settings → Team.
 * Redirect to login with a message.
 */
export default function Signup() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Account Registration</h1>
        <p className="text-sm text-gray-600 mb-4">
          DrayageDirect accounts are provisioned by your company administrator.
        </p>
        <p className="text-sm text-gray-500">
          Contact your admin to get an account, or{' '}
          <a href="/login" className="text-blue-600 hover:text-blue-700 font-medium">sign in</a>
          {' '}if you already have one.
        </p>
      </div>
    </div>
  );
}
