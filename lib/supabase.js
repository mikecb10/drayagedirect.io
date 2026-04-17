import { createClient } from '@supabase/supabase-js';
import { resilientFetch } from './resilience/supabase-wrapper.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check .env.local');
}

// Client-side Supabase client (uses anon key, respects RLS).
// NOTE: browser-side client is NOT wrapped — Tier 0 covers server-side
// only. Browser Realtime already has its own indicator (LiveIndicator).
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side Supabase client (uses service role key, bypasses RLS).
// Only use in API routes and server-side functions.
// Wired to resilientFetch so every /rest/v1/ PostgREST call goes
// through retry + circuit breaker. Auth / storage / realtime paths
// pass through unchanged.
export function createServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: resilientFetch,
    },
  });
}
