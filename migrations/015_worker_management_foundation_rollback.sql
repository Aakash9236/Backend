-- =====================================================================
-- ROLLBACK: 015_worker_management_foundation_rollback.sql
-- DESCRIPTION: Reverts Phase 6E - Worker Management Foundation tables
-- =====================================================================

BEGIN;

DROP TABLE IF EXISTS public.worker_availability CASCADE;
DROP TABLE IF EXISTS public.worker_partner_affiliations CASCADE;
DROP TABLE IF EXISTS public.worker_invitations CASCADE;
DROP TABLE IF EXISTS public.worker_skills CASCADE;
DROP TABLE IF EXISTS public.worker_documents CASCADE;
DROP TABLE IF EXISTS public.worker_profiles CASCADE;

DELETE FROM public.schema_migrations WHERE migration_name = '015_worker_management_foundation.sql';

COMMIT;
