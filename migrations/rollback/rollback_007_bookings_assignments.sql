BEGIN;
DROP TABLE IF EXISTS public.booking_status_history CASCADE;
DROP TABLE IF EXISTS public.booking_assignments CASCADE;
DROP TABLE IF EXISTS public.fare_breakdowns CASCADE;
DROP TABLE IF EXISTS public.booking_labor_details CASCADE;
DROP TABLE IF EXISTS public.booking_inventory_items CASCADE;
DROP TABLE IF EXISTS public.booking_items CASCADE;
DROP TABLE IF EXISTS public.bookings CASCADE;
COMMIT;
