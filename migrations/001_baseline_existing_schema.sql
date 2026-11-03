-- =====================================================================
-- MIGRATION: 001_baseline_existing_schema.sql
-- DESCRIPTION: Baseline documentation of the 13 tables already existing
--              in service_platform_db (Audit completed Nov 03, 2026).
-- NOTE: THIS SCRIPT IS FOR DOCUMENTATION AND REPRODUCIBILITY ONLY.
--       DO NOT RUN ON THE LIVE DATABASE AS THESE TABLES ALREADY EXIST.
-- =====================================================================

-- 1. users
-- 2. roles
-- 3. user_roles
-- 4. otp_verifications
-- 5. user_sessions
-- 6. customer_profiles
-- 7. partner_profiles
-- 8. partner_documents
-- 9. service_categories
-- 10. partner_skills
-- 11. cities
-- 12. areas
-- 13. partner_service_areas

-- Verified pre-seeded data:
-- roles: CUSTOMER, PARTNER, DRIVER, WORKER, ADMIN, SUPER_ADMIN
-- service_categories: HOME_SERVICES, SHIFTING, VEHICLE_SERVICES + 11 subcategories

