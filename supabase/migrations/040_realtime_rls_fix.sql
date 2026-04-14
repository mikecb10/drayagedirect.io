-- ============================================================
-- Migration 040: Fix current_tenant_id() for Supabase Realtime
-- ============================================================
-- The existing current_tenant_id() function reads from:
--   1. request.jwt.claims -> tenant_id   (JWT claim — not set)
--   2. app.current_tenant                 (session var — server-only)
--
-- Neither of these work in the Supabase Realtime context, which
-- evaluates RLS policies for each subscribed client per event.
-- As a result, Realtime silently filters out ALL events because
-- the policy `tenant_id = current_tenant_id()` evaluates to NULL.
--
-- Fix: add a third fallback that looks up tenant_id from the
-- users table using auth.uid(). This works for:
--   - Supabase Realtime (uses auth.uid() from the client's JWT)
--   - Client-side SELECTs from the browser client (same)
--   - Server-side code (still prefers the app.current_tenant var)
--
-- SECURITY DEFINER is used so the function can read users.tenant_id
-- even if the querying role doesn't have direct SELECT on users.
-- STABLE improves caching of the result within a single query.
-- ============================================================

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    -- 1. JWT custom claim (if we ever add tenant_id to the JWT)
    (current_setting('request.jwt.claims', true)::json->>'tenant_id')::UUID,
    -- 2. Server-side session variable (set by requireTenantUser)
    NULLIF(current_setting('app.current_tenant', true), '')::UUID,
    -- 3. NEW: look up from users table via auth.uid()
    --    This is what enables Supabase Realtime + client-side SELECTs
    (SELECT tenant_id FROM public.users WHERE auth_uid = auth.uid()::TEXT LIMIT 1)
  );
END;
$$;
