-- =====================================================================
-- MIGRATION: 014_driver_management_assignment.sql
-- DESCRIPTION: Phase 6D - Driver Management, Affiliations, Overlap-Protected Assignments & Availability
-- =====================================================================

BEGIN;

-- 0. Ensure btree_gist extension is available for exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Create driver_profiles table
CREATE TABLE IF NOT EXISTS public.driver_profiles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL UNIQUE,
    first_name varchar(100) NOT NULL,
    last_name varchar(100) NULL,
    date_of_birth date NULL,
    gender varchar(20) NULL,
    profile_image_url text NULL,
    bio text NULL,
    experience_years integer NOT NULL DEFAULT 0,
    licence_number varchar(50) NULL,
    licence_classes text[] NOT NULL DEFAULT '{}',
    licence_expiry_date date NULL,
    issuing_authority varchar(100) NULL,
    approval_status varchar(20) NOT NULL DEFAULT 'PENDING',
    rejection_reason text NULL,
    suspension_reason text NULL,
    suspended_at timestamptz NULL,
    reviewed_by bigint NULL,
    reviewed_at timestamptz NULL,
    submission_status varchar(20) NOT NULL DEFAULT 'DRAFT',
    submitted_at timestamptz NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_driver_user 
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT fk_driver_reviewer 
        FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_driver_approval_status 
        CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    CONSTRAINT chk_driver_submission_status 
        CHECK (submission_status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
    CONSTRAINT chk_driver_experience 
        CHECK (experience_years >= 0)
);

CREATE INDEX IF NOT EXISTS idx_driver_profiles_user 
    ON public.driver_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_approval 
    ON public.driver_profiles (approval_status);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_licence 
    ON public.driver_profiles (licence_number);

-- 2. Create driver_documents table (non-cascade-deleted historical documents)
CREATE TABLE IF NOT EXISTS public.driver_documents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    driver_id bigint NOT NULL,
    document_type varchar(50) NOT NULL,
    document_storage_key text NOT NULL,
    expiry_date date NULL,
    verification_status varchar(20) NOT NULL DEFAULT 'PENDING',
    rejection_reason text NULL,
    document_metadata jsonb NULL,
    reviewed_by bigint NULL,
    reviewed_at timestamptz NULL,
    uploaded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_driver_document_driver 
        FOREIGN KEY (driver_id) REFERENCES public.driver_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_driver_document_reviewer 
        FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_driver_doc_status 
        CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED')),
    CONSTRAINT chk_driver_doc_type 
        CHECK (document_type IN (
            'DRIVING_LICENCE',
            'IDENTITY_PROOF',
            'PROFILE_PHOTO',
            'COMMERCIAL_BADGE',
            'POLICE_VERIFICATION',
            'MEDICAL_FITNESS',
            'OTHER'
        ))
);

CREATE INDEX IF NOT EXISTS idx_driver_documents_driver_type 
    ON public.driver_documents (driver_id, document_type, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_documents_status 
    ON public.driver_documents (verification_status);

-- 3. Create driver_invitations table
CREATE TABLE IF NOT EXISTS public.driver_invitations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partner_id bigint NOT NULL,
    invited_mobile varchar(20) NOT NULL,
    driver_name varchar(150) NULL,
    driver_user_id bigint NULL,
    invitation_status varchar(20) NOT NULL DEFAULT 'PENDING',
    invitation_token varchar(100) NOT NULL UNIQUE,
    notes text NULL,
    resend_count integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    responded_at timestamptz NULL,
    rejection_reason text NULL,
    revoked_at timestamptz NULL,
    revoked_by bigint NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_driver_invitation_partner 
        FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_driver_invitation_driver_user 
        FOREIGN KEY (driver_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT fk_driver_invitation_revoked_by 
        FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_driver_invitation_status 
        CHECK (invitation_status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_invitation_per_partner_driver 
    ON public.driver_invitations (partner_id, invited_mobile) 
    WHERE invitation_status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_driver_invitations_partner 
    ON public.driver_invitations (partner_id, invitation_status);
CREATE INDEX IF NOT EXISTS idx_driver_invitations_mobile 
    ON public.driver_invitations (invited_mobile, invitation_status);
CREATE INDEX IF NOT EXISTS idx_driver_invitations_token 
    ON public.driver_invitations (invitation_token);

-- 4. Create driver_partner_affiliations table (M:N driver to owner affiliations)
CREATE TABLE IF NOT EXISTS public.driver_partner_affiliations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    driver_id bigint NOT NULL,
    partner_id bigint NOT NULL,
    invitation_id bigint NULL,
    affiliation_status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    affiliated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    terminated_at timestamptz NULL,
    termination_reason text NULL,

    CONSTRAINT fk_driver_affiliation_driver 
        FOREIGN KEY (driver_id) REFERENCES public.driver_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_driver_affiliation_partner 
        FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_driver_affiliation_invitation 
        FOREIGN KEY (invitation_id) REFERENCES public.driver_invitations(id) ON DELETE SET NULL,
    CONSTRAINT chk_driver_affiliation_status 
        CHECK (affiliation_status IN ('ACTIVE', 'INACTIVE', 'TERMINATED')),
    CONSTRAINT chk_active_affiliation_terminated_at 
        CHECK (((affiliation_status = 'ACTIVE' AND terminated_at IS NULL) OR affiliation_status <> 'ACTIVE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_driver_partner_affiliation 
    ON public.driver_partner_affiliations (driver_id, partner_id) 
    WHERE affiliation_status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_driver_affiliations_partner 
    ON public.driver_partner_affiliations (partner_id, affiliation_status);
CREATE INDEX IF NOT EXISTS idx_driver_affiliations_driver 
    ON public.driver_partner_affiliations (driver_id, affiliation_status);

-- 5. Create driver_vehicle_assignments table with PostgreSQL Exclusion Constraints
CREATE TABLE IF NOT EXISTS public.driver_vehicle_assignments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    driver_id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    partner_id bigint NOT NULL,
    assignment_status varchar(20) NOT NULL DEFAULT 'SCHEDULED',
    start_time timestamptz NOT NULL,
    end_time timestamptz NULL,
    actual_start_time timestamptz NULL,
    actual_end_time timestamptz NULL,
    notes text NULL,
    cancellation_reason text NULL,
    cancelled_by bigint NULL,
    cancelled_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_dva_driver 
        FOREIGN KEY (driver_id) REFERENCES public.driver_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_dva_vehicle 
        FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_dva_partner 
        FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_dva_cancelled_by 
        FOREIGN KEY (cancelled_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_dva_status 
        CHECK (assignment_status IN ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT chk_dva_time_range 
        CHECK (end_time IS NULL OR end_time > start_time),
    CONSTRAINT chk_dva_actual_time 
        CHECK (actual_end_time IS NULL OR actual_start_time IS NULL OR actual_end_time > actual_start_time),

    -- Exclusion constraint: Driver cannot have overlapping SCHEDULED or ACTIVE assignments
    CONSTRAINT ex_no_overlapping_driver_assignments
        EXCLUDE USING gist (
            driver_id WITH =,
            tstzrange(start_time, COALESCE(end_time, 'infinity'::timestamptz), '[)') WITH &&
        )
        WHERE (assignment_status IN ('SCHEDULED', 'ACTIVE')),

    -- Exclusion constraint: Vehicle cannot have overlapping SCHEDULED or ACTIVE driver assignments
    CONSTRAINT ex_no_overlapping_vehicle_assignments
        EXCLUDE USING gist (
            vehicle_id WITH =,
            tstzrange(start_time, COALESCE(end_time, 'infinity'::timestamptz), '[)') WITH &&
        )
        WHERE (assignment_status IN ('SCHEDULED', 'ACTIVE'))
);

CREATE INDEX IF NOT EXISTS idx_assignments_driver 
    ON public.driver_vehicle_assignments (driver_id, assignment_status);
CREATE INDEX IF NOT EXISTS idx_assignments_vehicle 
    ON public.driver_vehicle_assignments (vehicle_id, assignment_status);
CREATE INDEX IF NOT EXISTS idx_assignments_partner 
    ON public.driver_vehicle_assignments (partner_id, assignment_status);
CREATE INDEX IF NOT EXISTS idx_assignments_schedule 
    ON public.driver_vehicle_assignments (start_time, end_time);

-- 6. Create driver_availability table
CREATE TABLE IF NOT EXISTS public.driver_availability (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    driver_id bigint NOT NULL UNIQUE,
    is_online boolean NOT NULL DEFAULT false,
    is_busy boolean NOT NULL DEFAULT false,
    current_assignment_id bigint NULL,
    last_heartbeat_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_driver_availability_driver 
        FOREIGN KEY (driver_id) REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_driver_availability_assignment 
        FOREIGN KEY (current_assignment_id) REFERENCES public.driver_vehicle_assignments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_driver_availability_status 
    ON public.driver_availability (is_online, is_busy);

COMMIT;

