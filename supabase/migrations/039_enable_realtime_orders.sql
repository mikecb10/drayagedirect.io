-- ============================================================
-- Migration 039: Enable Realtime on orders table
-- ============================================================
-- Enables Supabase Realtime broadcasts for the orders table so
-- multiple dispatchers can see live updates on the board without
-- polling. RLS policies on the orders table ensure each tenant
-- only receives their own tenant's events.
--
-- Supabase Realtime uses the `supabase_realtime` publication to
-- decide which tables broadcast changes. We just need to add the
-- orders table to that publication.
-- ============================================================

-- Ensure REPLICA IDENTITY is FULL so UPDATE/DELETE events include
-- the old row values (needed for reliable client-side diffs).
ALTER TABLE orders REPLICA IDENTITY FULL;

-- Add the orders table to the realtime publication.
-- Uses a DO block because ADD TABLE fails if the table is already in
-- the publication — safe re-run for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;
END $$;
