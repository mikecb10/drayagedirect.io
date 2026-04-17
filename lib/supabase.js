import { createClient } from '@supabase/supabase-js';
import { wrapSupabaseClient } from './resilience/supabase-wrapper.js';

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
// Wrapped with the resilience layer — every .from() / .rpc() call goes
// through retry + circuit breaker.
export function createServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return wrapSupabaseClient(client);
}
