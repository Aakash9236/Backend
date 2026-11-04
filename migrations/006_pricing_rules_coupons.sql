-- =====================================================================
-- MIGRATION: 006_pricing_rules_coupons.sql
-- DESCRIPTION: Pricing matrix for shifting/vehicles and promotional coupons
-- =====================================================================

BEGIN;


CREATE TABLE IF NOT EXISTS public.pricing_rules (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    city_id bigint NOT NULL,
    service_category_id bigint NOT NULL,
    vehicle_type_id bigint NULL,
    base_fare numeric(10, 2) NOT NULL DEFAULT 0.00,
    base_distance_km numeric(8, 2) NOT NULL DEFAULT 0.00,
    per_km_rate numeric(10, 2) NOT NULL DEFAULT 0.00,
    per_minute_waiting_rate numeric(10, 2) NOT NULL DEFAULT 0.00,
    helper_charge_per_person numeric(10, 2) NOT NULL DEFAULT 0.00,
    floor_charge_without_elevator numeric(10, 2) NOT NULL DEFAULT 0.00,
    volume_rate_per_cuft numeric(10, 2) NOT NULL DEFAULT 0.00,
    surge_multiplier numeric(4, 2) NOT NULL DEFAULT 1.00,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_pricing_city FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT,
    CONSTRAINT fk_pricing_category FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT,
    CONSTRAINT fk_pricing_vehicle_type FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_types(id) ON DELETE RESTRICT,
    CONSTRAINT chk_pricing_values CHECK (
        base_fare >= 0 AND
        base_distance_km >= 0 AND
        per_km_rate >= 0 AND
        helper_charge_per_person >= 0 AND
        floor_charge_without_elevator >= 0 AND
        volume_rate_per_cuft >= 0 AND
        surge_multiplier >= 1.00
    )
);

CREATE TABLE IF NOT EXISTS public.coupons (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    coupon_code varchar(50) NOT NULL UNIQUE,
    description text NULL,
    discount_type varchar(20) NOT NULL,
    discount_value numeric(10, 2) NOT NULL,
    max_discount_amount numeric(10, 2) NULL,
    min_booking_amount numeric(10, 2) NOT NULL DEFAULT 0.00,
    usage_limit_total integer NULL,
    usage_limit_per_user integer NOT NULL DEFAULT 1,
    current_usage_count integer NOT NULL DEFAULT 0,
    valid_from timestamptz NOT NULL,
    valid_until timestamptz NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_coupon_discount_type CHECK (discount_type IN ('PERCENTAGE', 'FLAT')),
    CONSTRAINT chk_coupon_values CHECK (discount_value > 0 AND min_booking_amount >= 0),
    CONSTRAINT chk_coupon_validity CHECK (valid_until > valid_from)
);

CREATE INDEX IF NOT EXISTS idx_pricing_lookup ON public.pricing_rules (city_id, service_category_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons (coupon_code) WHERE is_active = true;



COMMIT;
