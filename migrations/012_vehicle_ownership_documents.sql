-- =====================================================================
-- MIGRATION: 012_vehicle_ownership_documents.sql
-- DESCRIPTION: Dedicated vehicle documents, ownership metadata, and fleet partial index
-- =====================================================================

BEGIN;

-- 1. Create dedicated vehicle_documents table
CREATE TABLE IF NOT EXISTS public.vehicle_documents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id bigint NOT NULL,
    document_type varchar(50) NOT NULL,
    document_storage_key text NOT NULL,
    expiry_date date NULL,
    verification_status varchar(20) NOT NULL DEFAULT 'PENDING',
    rejection_reason text NULL,
    reviewed_by bigint NULL,
    reviewed_at timestamptz NULL,
    uploaded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_vehicle_document_vehicle 
        FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE,
    CONSTRAINT fk_vehicle_document_reviewer 
        FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_vehicle_doc_status 
        CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    CONSTRAINT chk_vehicle_doc_type 
        CHECK (document_type IN (
            'RC', 
            'INSURANCE', 
            'FITNESS', 
            'POLLUTION_PUC', 
            'COMMERCIAL_PERMIT', 
            'OWNER_AUTHORIZATION', 
            'LEASE_AGREEMENT', 
            'OTHER'
        ))
);

CREATE INDEX IF NOT EXISTS idx_vehicle_documents_lookup 
    ON public.vehicle_documents (vehicle_id, document_type, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_status 
    ON public.vehicle_documents (verification_status);

-- 2. Extend partner_vehicles with ownership metadata
ALTER TABLE public.partner_vehicles 
    ADD COLUMN IF NOT EXISTS ownership_type varchar(30) NOT NULL DEFAULT 'OWNER',
    ADD COLUMN IF NOT EXISTS owner_name varchar(150) NULL,
    ADD COLUMN IF NOT EXISTS ownership_status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS unassigned_at timestamptz NULL;

ALTER TABLE public.partner_vehicles 
    DROP CONSTRAINT IF EXISTS chk_partner_vehicle_ownership_status,
    ADD CONSTRAINT chk_partner_vehicle_ownership_status 
        CHECK (ownership_status IN ('ACTIVE', 'TRANSFERRED', 'TERMINATED'));

ALTER TABLE public.partner_vehicles 
    DROP CONSTRAINT IF EXISTS chk_partner_vehicle_ownership_type,
    ADD CONSTRAINT chk_partner_vehicle_ownership_type 
        CHECK (ownership_type IN ('OWNER', 'LEASED', 'AUTHORIZED_REPRESENTATIVE'));

-- 3. Drop old static unique constraint to allow historical ownership tracking,
-- and replace with partial unique index ensuring only ONE active partner per vehicle.
ALTER TABLE public.partner_vehicles 
    DROP CONSTRAINT IF EXISTS uq_partner_vehicle;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_partner_per_vehicle 
    ON public.partner_vehicles (vehicle_id) 
    WHERE ownership_status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_partner_vehicles_history 
    ON public.partner_vehicles (partner_id, ownership_status);

-- 4. Idempotently seed standard commercial vehicle types
INSERT INTO public.vehicle_types (
    type_code, type_name, service_category_id, capacity_kg, volume_cuft, base_fare, per_km_rate, per_minute_rate, is_active
) VALUES 
(
    'TWO_WHEELER', 
    'Two Wheeler (Courier / Small Parcel)', 
    3, -- VEHICLE_SERVICES
    30.00, 
    2.00, 
    40.00, 
    10.00, 
    1.00, 
    true
),
(
    'THREE_WHEELER', 
    'Three Wheeler (Cargo Auto / Ape)', 
    2, -- SHIFTING
    500.00, 
    70.00, 
    150.00, 
    18.00, 
    2.00, 
    true
),
(
    'TATA_ACE', 
    'Tata Ace (Chota Hathi)', 
    2, -- SHIFTING
    850.00, 
    120.00, 
    250.00, 
    25.00, 
    2.50, 
    true
),
(
    'PICKUP_8FT', 
    '8ft Pickup (Bolero Maxi Truck)', 
    2, -- SHIFTING
    1250.00, 
    180.00, 
    350.00, 
    32.00, 
    3.00, 
    true
),
(
    'CANTER_14FT', 
    '14ft Canter (Intermediate Truck)', 
    2, -- SHIFTING
    3500.00, 
    450.00, 
    700.00, 
    55.00, 
    4.00, 
    true
)
ON CONFLICT (type_code) DO NOTHING;

COMMIT;

