-- =====================================================================
-- MIGRATION: 009_tracking_availability.sql
-- DESCRIPTION: Real-time availability, GPS live positions, and historical breadcrumbs
-- =====================================================================

BEGIN;


CREATE TABLE IF NOT EXISTS public.partner_availability (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partner_id bigint NOT NULL UNIQUE,
    is_online boolean NOT NULL DEFAULT false,
    is_busy boolean NOT NULL DEFAULT false,
    current_booking_id bigint NULL,
    last_heartbeat_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_availability_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_availability_booking FOREIGN KEY (current_booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.partner_live_locations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partner_id bigint NOT NULL UNIQUE,
    latitude numeric(10, 7) NOT NULL,
    longitude numeric(10, 7) NOT NULL,
    heading numeric(5, 2) NULL,
    speed_kph numeric(5, 2) NULL,
    accuracy_meters numeric(6, 2) NULL,
    battery_percentage integer NULL,
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_live_location_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE,
    CONSTRAINT chk_live_latitude CHECK (latitude >= -90 AND latitude <= 90),
    CONSTRAINT chk_live_longitude CHECK (longitude >= -180 AND longitude <= 180),
    CONSTRAINT chk_battery CHECK (battery_percentage IS NULL OR (battery_percentage >= 0 AND battery_percentage <= 100))
);

CREATE TABLE IF NOT EXISTS public.partner_location_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partner_id bigint NOT NULL,
    booking_id bigint NULL,
    latitude numeric(10, 7) NOT NULL,
    longitude numeric(10, 7) NOT NULL,
    heading numeric(5, 2) NULL,
    speed_kph numeric(5, 2) NULL,
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_history_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_history_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL,
    CONSTRAINT chk_hist_latitude CHECK (latitude >= -90 AND latitude <= 90),
    CONSTRAINT chk_hist_longitude CHECK (longitude >= -180 AND longitude <= 180)
);

CREATE INDEX IF NOT EXISTS idx_partner_availability_online ON public.partner_availability (is_online, is_busy);
CREATE INDEX IF NOT EXISTS idx_partner_live_coords ON public.partner_live_locations (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_partner_location_history_booking ON public.partner_location_history (booking_id, recorded_at);



COMMIT;
