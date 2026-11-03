-- =====================================================================
-- MIGRATION: 002_user_addresses.sql
-- DESCRIPTION: Creates the user_addresses table for saved addresses
-- =====================================================================

BEGIN;


CREATE TABLE IF NOT EXISTS public.user_addresses (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL,
    city_id bigint NOT NULL,
    area_id bigint NULL,
    address_type varchar(20) NOT NULL DEFAULT 'HOME',
    address_line1 text NOT NULL,
    address_line2 text NULL,
    landmark varchar(255) NULL,
    postal_code varchar(20) NOT NULL,
    latitude numeric(10, 7) NOT NULL,
    longitude numeric(10, 7) NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_user_address_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_address_city FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT,
    CONSTRAINT fk_user_address_area FOREIGN KEY (area_id) REFERENCES public.areas(id) ON DELETE RESTRICT,
    CONSTRAINT chk_address_type CHECK (address_type IN ('HOME', 'WORK', 'OTHER')),
    CONSTRAINT chk_address_latitude CHECK (latitude >= -90 AND latitude <= 90),
    CONSTRAINT chk_address_longitude CHECK (longitude >= -180 AND longitude <= 180)
);

CREATE INDEX IF NOT EXISTS idx_user_addresses_user ON public.user_addresses (user_id);
CREATE INDEX IF NOT EXISTS idx_user_addresses_city ON public.user_addresses (city_id);
CREATE INDEX IF NOT EXISTS idx_user_addresses_area ON public.user_addresses (area_id) WHERE area_id IS NOT NULL;



COMMIT;
