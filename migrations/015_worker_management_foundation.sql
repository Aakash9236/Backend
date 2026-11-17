-- =====================================================================
-- MIGRATION: 015_worker_management_foundation.sql
-- DESCRIPTION: Phase 6E - Worker Management Foundation, Skills, Documents, Invitations, Affiliations & Availability
-- =====================================================================

BEGIN;

-- 1. Create worker_profiles table
CREATE TABLE IF NOT EXISTS public.worker_profiles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL UNIQUE,
    first_name varchar(100) NOT NULL,
    last_name varchar(100) NULL,
    date_of_birth date NULL,
    gender varchar(20) NULL,
    profile_image_url text NULL,
    bio text NULL,
    worker_type varchar(50) NOT NULL DEFAULT 'HELPER',
    experience_years integer NOT NULL DEFAULT 0,
    primary_city_id bigint NULL,
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

    CONSTRAINT fk_worker_user 
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT fk_worker_city 
        FOREIGN KEY (primary_city_id) REFERENCES public.cities(id) ON DELETE SET NULL,
    CONSTRAINT fk_worker_reviewer 
        FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_worker_approval_status 
        CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    CONSTRAINT chk_worker_submission_status 
        CHECK (submission_status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
    CONSTRAINT chk_worker_experience 
        CHECK (experience_years >= 0)
);

CREATE INDEX IF NOT EXISTS idx_worker_profiles_user 
    ON public.worker_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_approval 
    ON public.worker_profiles (approval_status);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_type 
    ON public.worker_profiles (worker_type);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_city 
    ON public.worker_profiles (primary_city_id);

-- 2. Create worker_documents table (non-cascade-deleted historical documents)
CREATE TABLE IF NOT EXISTS public.worker_documents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    worker_id bigint NOT NULL,
    document_type varchar(50) NOT NULL,
    document_storage_key text NOT NULL,
    original_name varchar(255) NULL,
    mime_type varchar(100) NULL,
    file_size_bytes bigint NULL,
    expiry_date date NULL,
    verification_status varchar(20) NOT NULL DEFAULT 'PENDING',
    rejection_reason text NULL,
    document_metadata jsonb NULL,
    reviewed_by bigint NULL,
    reviewed_at timestamptz NULL,
    uploaded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_document_worker 
        FOREIGN KEY (worker_id) REFERENCES public.worker_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_worker_document_reviewer 
        FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_worker_doc_status 
        CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED')),
    CONSTRAINT chk_worker_doc_type 
        CHECK (document_type IN (
            'IDENTITY_PROOF',
            'PROFILE_PHOTO',
            'POLICE_VERIFICATION',
            'ADDRESS_PROOF',
            'SKILL_CERTIFICATE',
            'MEDICAL_FITNESS',
            'OTHER'
        )),
    CONSTRAINT chk_worker_doc_size 
        CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_worker_documents_worker_type 
    ON public.worker_documents (worker_id, document_type, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_documents_status 
    ON public.worker_documents (verification_status);

-- 3. Create worker_skills table (qualifications mapped to service categories)
CREATE TABLE IF NOT EXISTS public.worker_skills (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    worker_id bigint NOT NULL,
    service_category_id bigint NOT NULL,
    experience_years integer NOT NULL DEFAULT 0,
    verification_status varchar(20) NOT NULL DEFAULT 'PENDING',
    rejection_reason text NULL,
    reviewed_by bigint NULL,
    reviewed_at timestamptz NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_skill_worker 
        FOREIGN KEY (worker_id) REFERENCES public.worker_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_worker_skill_category 
        FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT,
    CONSTRAINT fk_worker_skill_reviewer 
        FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_worker_skill_status 
        CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    CONSTRAINT chk_worker_skill_exp 
        CHECK (experience_years >= 0),
    CONSTRAINT uq_worker_skill 
        UNIQUE (worker_id, service_category_id)
);

CREATE INDEX IF NOT EXISTS idx_worker_skills_worker 
    ON public.worker_skills (worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_skills_category 
    ON public.worker_skills (service_category_id);

-- 4. Create worker_invitations table (cryptographic token hash only)
CREATE TABLE IF NOT EXISTS public.worker_invitations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partner_id bigint NOT NULL,
    inviting_user_id bigint NULL,
    invited_mobile varchar(20) NOT NULL,
    worker_name varchar(150) NULL,
    worker_user_id bigint NULL,
    invitation_status varchar(20) NOT NULL DEFAULT 'PENDING',
    invitation_token_hash varchar(128) NOT NULL UNIQUE,
    proposed_role varchar(50) NULL,
    notes text NULL,
    resend_count integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    responded_at timestamptz NULL,
    rejection_reason text NULL,
    revoked_at timestamptz NULL,
    revoked_by bigint NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_invitation_partner 
        FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_worker_invitation_inviting_user 
        FOREIGN KEY (inviting_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT fk_worker_invitation_worker_user 
        FOREIGN KEY (worker_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT fk_worker_invitation_revoked_by 
        FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_worker_invitation_status 
        CHECK (invitation_status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_invitation_per_partner_worker 
    ON public.worker_invitations (partner_id, invited_mobile) 
    WHERE invitation_status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_worker_invitations_partner 
    ON public.worker_invitations (partner_id, invitation_status);
CREATE INDEX IF NOT EXISTS idx_worker_invitations_mobile 
    ON public.worker_invitations (invited_mobile, invitation_status);
CREATE INDEX IF NOT EXISTS idx_worker_invitations_token_hash 
    ON public.worker_invitations (invitation_token_hash);

-- 5. Create worker_partner_affiliations table (non-exclusive M:N relationships)
CREATE TABLE IF NOT EXISTS public.worker_partner_affiliations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    worker_id bigint NOT NULL,
    partner_id bigint NOT NULL,
    invitation_id bigint NULL,
    affiliation_status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    consent_given_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    affiliated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    terminated_at timestamptz NULL,
    termination_reason text NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_affiliation_worker 
        FOREIGN KEY (worker_id) REFERENCES public.worker_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_worker_affiliation_partner 
        FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_worker_affiliation_invitation 
        FOREIGN KEY (invitation_id) REFERENCES public.worker_invitations(id) ON DELETE SET NULL,
    CONSTRAINT chk_worker_affiliation_status 
        CHECK (affiliation_status IN ('ACTIVE', 'INACTIVE', 'TERMINATED')),
    CONSTRAINT chk_active_worker_affiliation_terminated_at 
        CHECK (((affiliation_status = 'ACTIVE' AND terminated_at IS NULL) OR affiliation_status <> 'ACTIVE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_worker_partner_affiliation 
    ON public.worker_partner_affiliations (worker_id, partner_id) 
    WHERE affiliation_status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_worker_affiliations_partner 
    ON public.worker_partner_affiliations (partner_id, affiliation_status);
CREATE INDEX IF NOT EXISTS idx_worker_affiliations_worker 
    ON public.worker_partner_affiliations (worker_id, affiliation_status);

-- 6. Create worker_availability table
CREATE TABLE IF NOT EXISTS public.worker_availability (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    worker_id bigint NOT NULL UNIQUE,
    is_online boolean NOT NULL DEFAULT false,
    is_busy boolean NOT NULL DEFAULT false,
    last_heartbeat_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    current_latitude decimal(10, 7) NULL,
    current_longitude decimal(10, 7) NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_availability_worker 
        FOREIGN KEY (worker_id) REFERENCES public.worker_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_worker_availability_status 
    ON public.worker_availability (is_online, is_busy);

COMMIT;
