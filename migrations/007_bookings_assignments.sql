-- =====================================================================
-- MIGRATION: 007_bookings_assignments.sql
-- DESCRIPTION: Core bookings engine, shifting details, assignments & status transitions
-- =====================================================================

BEGIN;


CREATE TABLE IF NOT EXISTS public.bookings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_number varchar(30) NOT NULL UNIQUE,
    customer_id bigint NOT NULL,
    service_category_id bigint NOT NULL,
    city_id bigint NOT NULL,
    booking_type varchar(30) NOT NULL,
    booking_status varchar(30) NOT NULL DEFAULT 'REQUESTED',
    scheduled_at timestamptz NOT NULL,
    pickup_address_id bigint NOT NULL,
    drop_address_id bigint NULL,
    vehicle_type_id bigint NULL,
    coupon_id bigint NULL,
    special_instructions text NULL,
    estimated_duration_minutes integer NULL,
    cancellation_reason text NULL,
    cancelled_by bigint NULL,
    cancelled_at timestamptz NULL,
    completed_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_booking_customer FOREIGN KEY (customer_id) REFERENCES public.customer_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_booking_category FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT,
    CONSTRAINT fk_booking_city FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT,
    CONSTRAINT fk_booking_pickup_address FOREIGN KEY (pickup_address_id) REFERENCES public.user_addresses(id) ON DELETE RESTRICT,
    CONSTRAINT fk_booking_drop_address FOREIGN KEY (drop_address_id) REFERENCES public.user_addresses(id) ON DELETE RESTRICT,
    CONSTRAINT fk_booking_vehicle_type FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_types(id) ON DELETE RESTRICT,
    CONSTRAINT fk_booking_coupon FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL,
    CONSTRAINT fk_booking_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_booking_type CHECK (booking_type IN ('HOME_SERVICE', 'HOME_SHIFTING', 'OFFICE_SHIFTING', 'VEHICLE_RENTAL')),
    CONSTRAINT chk_booking_status CHECK (booking_status IN (
        'REQUESTED',
        'SEARCHING_PARTNER',
        'ASSIGNED',
        'ACCEPTED',
        'PARTNER_ON_THE_WAY',
        'ARRIVED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED'
    ))
);

CREATE TABLE IF NOT EXISTS public.booking_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL,
    service_id bigint NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    unit_price numeric(10, 2) NOT NULL,
    total_price numeric(10, 2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_booking_item_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
    CONSTRAINT fk_booking_item_service FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE RESTRICT,
    CONSTRAINT chk_booking_item_qty CHECK (quantity > 0),
    CONSTRAINT chk_booking_item_price CHECK (unit_price >= 0 AND total_price >= 0)
);

CREATE TABLE IF NOT EXISTS public.booking_inventory_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL,
    inventory_item_id bigint NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    needs_packing boolean NOT NULL DEFAULT true,
    needs_dismantling boolean NOT NULL DEFAULT false,
    item_volume_cuft numeric(8, 2) NOT NULL DEFAULT 0.00,
    packing_charge numeric(10, 2) NOT NULL DEFAULT 0.00,

    CONSTRAINT fk_bii_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
    CONSTRAINT fk_bii_inventory_item FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
    CONSTRAINT chk_bii_quantity CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS public.booking_labor_details (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL UNIQUE,
    pickup_floor integer NOT NULL DEFAULT 0,
    pickup_has_elevator boolean NOT NULL DEFAULT false,
    drop_floor integer NOT NULL DEFAULT 0,
    drop_has_elevator boolean NOT NULL DEFAULT false,
    helpers_count_requested integer NOT NULL DEFAULT 0,
    labor_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    floor_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    packing_charge numeric(10, 2) NOT NULL DEFAULT 0.00,

    CONSTRAINT fk_labor_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
    CONSTRAINT chk_helpers_count CHECK (helpers_count_requested >= 0),
    CONSTRAINT chk_floors CHECK (pickup_floor >= 0 AND drop_floor >= 0)
);

CREATE TABLE IF NOT EXISTS public.fare_breakdowns (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL UNIQUE,
    base_fare numeric(10, 2) NOT NULL DEFAULT 0.00,
    distance_fare numeric(10, 2) NOT NULL DEFAULT 0.00,
    items_fare numeric(10, 2) NOT NULL DEFAULT 0.00,
    inventory_volume_fare numeric(10, 2) NOT NULL DEFAULT 0.00,
    labor_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    floor_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    packing_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    waiting_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    surge_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    discount_amount numeric(10, 2) NOT NULL DEFAULT 0.00,
    taxes_and_fees numeric(10, 2) NOT NULL DEFAULT 0.00,
    total_fare numeric(10, 2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_fare_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
    CONSTRAINT chk_total_fare CHECK (total_fare >= 0)
);

CREATE TABLE IF NOT EXISTS public.booking_assignments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL,
    partner_id bigint NOT NULL,
    role_assigned varchar(30) NOT NULL DEFAULT 'PRIMARY_PARTNER',
    assignment_status varchar(30) NOT NULL DEFAULT 'OFFERED',
    assigned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at timestamptz NULL,
    rejection_reason text NULL,

    CONSTRAINT fk_assignment_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
    CONSTRAINT fk_assignment_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT uq_booking_partner_assignment UNIQUE (booking_id, partner_id),
    CONSTRAINT chk_role_assigned CHECK (role_assigned IN ('PRIMARY_PARTNER', 'DRIVER', 'WORKER_HELPER')),
    CONSTRAINT chk_assignment_status CHECK (assignment_status IN ('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'UNASSIGNED'))
);

CREATE TABLE IF NOT EXISTS public.booking_status_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL,
    from_status varchar(30) NULL,
    to_status varchar(30) NOT NULL,
    changed_by bigint NULL,
    comment text NULL,
    changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_status_history_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
    CONSTRAINT fk_status_history_user FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON public.bookings (customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings (booking_status);
CREATE INDEX IF NOT EXISTS idx_bookings_scheduled ON public.bookings (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_booking_items_booking ON public.booking_items (booking_id);
CREATE INDEX IF NOT EXISTS idx_assignment_partner_status ON public.booking_assignments (partner_id, assignment_status);
CREATE INDEX IF NOT EXISTS idx_status_history_booking ON public.booking_status_history (booking_id);



COMMIT;
