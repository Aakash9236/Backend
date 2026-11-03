-- =====================================================================
-- MIGRATION: 003_vehicle_fleet.sql
-- DESCRIPTION: Vehicle categories, registered vehicles, and partner fleet mappings
-- =====================================================================

BEGIN;


CREATE TABLE IF NOT EXISTS public.vehicle_types (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type_code varchar(50) NOT NULL UNIQUE,
    type_name varchar(100) NOT NULL,
    service_category_id bigint NOT NULL,
    capacity_kg numeric(10, 2) NOT NULL,
    volume_cuft numeric(10, 2) NULL,
    base_fare numeric(10, 2) NOT NULL DEFAULT 0.00,
    per_km_rate numeric(10, 2) NOT NULL DEFAULT 0.00,
    per_minute_rate numeric(10, 2) NOT NULL DEFAULT 0.00,
    icon_url text NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_vehicle_type_category FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT,
    CONSTRAINT chk_vehicle_capacity CHECK (capacity_kg > 0),
    CONSTRAINT chk_vehicle_rates CHECK (base_fare >= 0 AND per_km_rate >= 0 AND per_minute_rate >= 0)
);

CREATE TABLE IF NOT EXISTS public.vehicles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_type_id bigint NOT NULL,
    registration_number varchar(50) NOT NULL UNIQUE,
    make varchar(100) NULL,
    model varchar(100) NULL,
    manufacturing_year integer NULL,
    rc_number varchar(100) NULL,
    fitness_valid_until date NULL,
    insurance_valid_until date NULL,
    pollution_valid_until date NULL,
    verification_status varchar(20) NOT NULL DEFAULT 'PENDING',
    rejection_reason text NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_vehicle_type FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_types(id) ON DELETE RESTRICT,
    CONSTRAINT chk_vehicle_verification CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'))
);

CREATE TABLE IF NOT EXISTS public.partner_vehicles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partner_id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    is_primary boolean NOT NULL DEFAULT true,
    assigned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_partner_vehicle_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_partner_vehicle_vehicle FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE,
    CONSTRAINT uq_partner_vehicle UNIQUE (partner_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_type ON public.vehicles (vehicle_type_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON public.vehicles (verification_status);
CREATE INDEX IF NOT EXISTS idx_partner_vehicles_partner ON public.partner_vehicles (partner_id);



COMMIT;
