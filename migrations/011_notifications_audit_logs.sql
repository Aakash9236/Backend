-- =====================================================================
-- MIGRATION: 011_notifications_audit_logs.sql
-- DESCRIPTION: User alerts/notifications and administrative audit trail
-- =====================================================================

BEGIN;


CREATE TABLE IF NOT EXISTS public.notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL,
    booking_id bigint NULL,
    title varchar(200) NOT NULL,
    message text NOT NULL,
    notification_type varchar(50) NOT NULL,
    channel varchar(20) NOT NULL DEFAULT 'IN_APP',
    payload jsonb NULL,
    is_read boolean NOT NULL DEFAULT false,
    read_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL,
    CONSTRAINT chk_notification_channel CHECK (channel IN ('IN_APP', 'PUSH', 'SMS', 'EMAIL'))
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id bigint NULL,
    action varchar(100) NOT NULL,
    entity_name varchar(100) NOT NULL,
    entity_id bigint NOT NULL,
    old_values jsonb NULL,
    new_values jsonb NULL,
    ip_address inet NULL,
    user_agent text NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs (entity_name, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs (actor_user_id);



COMMIT;
