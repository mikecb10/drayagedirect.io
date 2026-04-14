-- ============================================================
-- Migration 027: Extended Organization Fields
-- ============================================================
-- Adds all fields needed for per-type organization forms:
-- Customer (full), Warehouse (partial), Yard (lean),
-- Terminal (unique header), Final Destination (minimal)
-- ============================================================

-- EMAIL section
ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS receiver_email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_domain TEXT;

-- PAYMENT section
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit_cents INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_hold BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';

-- CONTACT section
ALTER TABLE customers ADD COLUMN IF NOT EXISTS office_hour_start TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS office_hour_end TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS secondary_contact_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS secondary_phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_agent TEXT;

-- ORGANIZATION SUBTYPE (multi-select tags describing what the org does)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS organization_subtypes TEXT[] DEFAULT '{}';

-- QUICKBOOKS
ALTER TABLE customers ADD COLUMN IF NOT EXISTS quickbooks_company_field TEXT;

-- PREFERENCES
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pay_type TEXT; -- direct_pay | factoring
ALTER TABLE customers ADD COLUMN IF NOT EXISTS organization_tags TEXT[] DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_hazmat_certified BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS can_edit_load BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tir_optional BOOLEAN DEFAULT false;

-- INVOICING
ALTER TABLE customers ADD COLUMN IF NOT EXISTS invoice_combination TEXT; -- manually|by_load|by_day|by_week|by_reference|all_completed

-- PAYMENT TERMS
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms_from TEXT DEFAULT 'invoice_date'; -- invoice_date|last_day_of_month
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER DEFAULT 30;

-- TERMINAL-SPECIFIC
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tracking_status BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS terminal_market TEXT;
