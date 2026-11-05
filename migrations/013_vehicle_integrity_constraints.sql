-- =====================================================================
-- MIGRATION: 013_vehicle_integrity_constraints.sql
-- DESCRIPTION: Database-level primary vehicle uniqueness and active ownership unassigned_at integrity
-- =====================================================================

BEGIN;

-- 1. Deterministically clean up any potential duplicate active primary vehicles if present
-- (preserves the most recently assigned active relationship as primary)
WITH ranked_primaries AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY partner_id 
               ORDER BY assigned_at DESC, id DESC
           ) as rn
    FROM public.partner_vehicles
    WHERE is_primary = true AND ownership_status = 'ACTIVE'
)
UPDATE public.partner_vehicles pv
SET is_primary = false
FROM ranked_primaries rp
WHERE pv.id = rp.id AND rp.rn > 1;

-- 2. Clean up any active records that incorrectly have unassigned_at populated
UPDATE public.partner_vehicles
SET unassigned_at = NULL
WHERE ownership_status = 'ACTIVE' AND unassigned_at IS NOT NULL;

-- 3. Add Partial Unique Index for primary vehicle per partner:
-- Ensures at the PostgreSQL engine level that no partner can have multiple active primary vehicles simultaneously.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_primary_vehicle_per_partner
ON public.partner_vehicles (partner_id)
WHERE is_primary = true AND ownership_status = 'ACTIVE';

-- 4. Add CHECK constraint on partner_vehicles:
-- Active ownership records must strictly have unassigned_at IS NULL.
ALTER TABLE public.partner_vehicles 
    DROP CONSTRAINT IF EXISTS chk_active_ownership_unassigned_at,
    ADD CONSTRAINT chk_active_ownership_unassigned_at
        CHECK (
            (ownership_status = 'ACTIVE' AND unassigned_at IS NULL)
            OR ownership_status <> 'ACTIVE'
        );

COMMIT;

