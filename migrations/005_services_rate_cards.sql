-- =====================================================================
-- MIGRATION: 005_services_rate_cards.sql
-- DESCRIPTION: Granular services catalog and city-wise service rate cards
-- =====================================================================

BEGIN;


CREATE TABLE IF NOT EXISTS public.services (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_category_id bigint NOT NULL,
    service_code varchar(50) NOT NULL UNIQUE,
    service_name varchar(150) NOT NULL,
    description text NULL,
    duration_minutes integer NOT NULL DEFAULT 60,
    icon_url text NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_service_category FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT,
    CONSTRAINT chk_service_duration CHECK (duration_minutes > 0)
);

CREATE TABLE IF NOT EXISTS public.service_rate_cards (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_id bigint NOT NULL,
    city_id bigint NOT NULL,
    visiting_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    base_service_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    hourly_charge numeric(10, 2) NULL,
    minimum_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_rate_card_service FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE,
    CONSTRAINT fk_rate_card_city FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT,
    CONSTRAINT uq_service_city_rate UNIQUE (service_id, city_id),
    CONSTRAINT chk_rate_card_charges CHECK (
        visiting_charge >= 0 AND 
        base_service_charge >= 0 AND 
        minimum_charge >= 0 AND
        (hourly_charge IS NULL OR hourly_charge >= 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_services_category ON public.services (service_category_id);
CREATE INDEX IF NOT EXISTS idx_rate_cards_city ON public.service_rate_cards (city_id);



COMMIT;
