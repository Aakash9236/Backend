-- =====================================================================
-- ROLLBACK SCRIPT FOR ALL MIGRATIONS 002 TO 011
-- CAUTION: RUN ONLY IF REVERTING TO BASELINE SCHEMA (PRESERVES 13 BASE TABLES)
-- =====================================================================

BEGIN;

-- Rollback 011
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;

-- Rollback 010
DROP TABLE IF EXISTS public.reviews_ratings CASCADE;

-- Rollback 009
DROP TABLE IF EXISTS public.partner_location_history CASCADE;
DROP TABLE IF EXISTS public.partner_live_locations CASCADE;
DROP TABLE IF EXISTS public.partner_availability CASCADE;

-- Rollback 008
DROP TABLE IF EXISTS public.wallet_transactions CASCADE;
DROP TABLE IF EXISTS public.partner_wallets CASCADE;
DROP TABLE IF EXISTS public.refunds CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;

-- Rollback 007
DROP TABLE IF EXISTS public.booking_status_history CASCADE;
DROP TABLE IF EXISTS public.booking_assignments CASCADE;
DROP TABLE IF EXISTS public.fare_breakdowns CASCADE;
DROP TABLE IF EXISTS public.booking_labor_details CASCADE;
DROP TABLE IF EXISTS public.booking_inventory_items CASCADE;
DROP TABLE IF EXISTS public.booking_items CASCADE;
DROP TABLE IF EXISTS public.bookings CASCADE;

-- Rollback 006
DROP TABLE IF EXISTS public.coupons CASCADE;
DROP TABLE IF EXISTS public.pricing_rules CASCADE;

-- Rollback 005
DROP TABLE IF EXISTS public.service_rate_cards CASCADE;
DROP TABLE IF EXISTS public.services CASCADE;

-- Rollback 004
DROP TABLE IF EXISTS public.inventory_items CASCADE;
DROP TABLE IF EXISTS public.inventory_categories CASCADE;

-- Rollback 003
DROP TABLE IF EXISTS public.partner_vehicles CASCADE;
DROP TABLE IF EXISTS public.vehicles CASCADE;
DROP TABLE IF EXISTS public.vehicle_types CASCADE;

-- Rollback 002
DROP TABLE IF EXISTS public.user_addresses CASCADE;

COMMIT;

