# Database Gap Analysis & Schema Reconciliation

**Audit Date**: November 4, 2026  
**Auditor**: Senior PostgreSQL Database Engineer & Backend Architect  
**Scope**: Reconciliation of 40 PostgreSQL tables against finalized business requirements  
**Execution Mode**: READ-ONLY (No migrations executed)

---

## 1. Requirement-by-Requirement Database Reconciliation Matrix

| # | Requirement | Classification | Existing Table(s) | Gap Analysis & Proposed Schema Changes |
|---|---|---|---|---|
| 1 | **One user with multiple roles** | **FULLY SUPPORTED** | `users`, `roles`, `user_roles` | Handled via `uq_user_role` on `(user_id, role_id)`. Role retention verified. |
| 2 | **Vehicle owner to multiple vehicles** | **PARTIALLY SUPPORTED** | `vehicles`, `partner_vehicles` | `partner_vehicles` links partner to vehicle, but does not identify whether the partner is legal owner or operator. Proposed: Add `owner_partner_id bigint REFERENCES partner_profiles(id)` directly on `vehicles`. |
| 3 | **Vehicle ownership verification** | **PARTIALLY SUPPORTED** | `vehicles` | `verification_status` column exists on `vehicles`, but ownership proof documents cannot be attached to vehicles. Proposed: Add `vehicle_documents` table for RC, fitness, insurance, permit. |
| 4 | **Vehicle to driver assignment** | **NOT SUPPORTED** | None | No table links a driver user to a vehicle. Proposed: Create `vehicle_driver_assignments` table. |
| 5 | **Driver invitation and acceptance** | **NOT SUPPORTED** | None | No invitation model exists. Proposed: Create `driver_invitations` table (`owner_partner_id`, `driver_mobile_number`, `invitation_status`, `expires_at`). |
| 6 | **Driver assignment history** | **NOT SUPPORTED** | None | No historical record of past vehicle drivers. Proposed: `vehicle_driver_assignments` with `started_at`, `ended_at`, `is_active`, and unique index on `(vehicle_id) WHERE is_active = true`. |
| 7 | **Worker to multiple vehicle partners** | **NOT SUPPORTED** | None | No relation exists between workers and vehicle partners. Proposed: Create `worker_affiliations` table. |
| 8 | **Worker affiliation requests & acceptance** | **NOT SUPPORTED** | None | No invitation/acceptance model exists for workers. Proposed: `worker_affiliations` with `status: ['PENDING', 'ACCEPTED', 'REJECTED', 'TERMINATED']`. |
| 9 | **Independent worker eligibility** | **PARTIALLY SUPPORTED** | `roles` (WORKER), `partner_availability` | Role exists, but no dedicated `worker_profiles` table exists to record independent eligibility flag or floor lifting capacity. Proposed: Create `worker_profiles`. |
| 10 | **Service-specific skill verification** | **FULLY SUPPORTED** | `partner_skills` | Independent `verification_status` per skill with category FK. Fully supported. |
| 11 | **Vehicle document verification & expiry** | **PARTIALLY SUPPORTED** | `vehicles` | Expiry dates exist as columns on `vehicles`, but documents are not linked to files or verifiable individually. Proposed: Create `vehicle_documents`. |
| 12 | **Driver licence expiry** | **NOT SUPPORTED** | None | No driver profile or driving license document model exists. Proposed: Create `driver_profiles` (`license_number`, `license_valid_until`, `badge_number`). |
| 13 | **Configurable KYC document requirements** | **NOT SUPPORTED** | None | `partner_documents` only has raw `document_type` string. No config table exists. Proposed: Create `kyc_document_types` and `kyc_requirement_rules`. |
| 14 | **Role-specific approval states** | **PARTIALLY SUPPORTED** | `partner_profiles` | Supported for partners (`approval_status`). Not supported for Drivers or Workers. Proposed: Add approval status to `driver_profiles` and `worker_profiles`. |
| 15 | **Admin permission management** | **NOT SUPPORTED** | `roles` | Roles only have `role_name`. No granular permissions model exists. Proposed: Create `permissions` and `role_permissions` tables. |
| 16 | **Atomic audit logging** | **PARTIALLY SUPPORTED** | `audit_logs` | Table exists and supports JSON `old_values`/`new_values`. Gap: Application service does not wrap status updates and audit logs in transactions. |
| 17 | **Booking assignment & conflict prevention** | **PARTIALLY SUPPORTED** | `booking_assignments` | Table exists with `(booking_id, partner_id)` unique constraint. Gap: Lacks exclusive constraint for single active driver/vehicle on shifting bookings. |
| 18 | **Multi-city partner coverage** | **FULLY SUPPORTED** | `cities`, `areas`, `partner_service_areas` | Checked and verified. Supports CITY and AREA coverage types with check constraints. |
| 19 | **Financial transaction history** | **FULLY SUPPORTED** | `payments`, `refunds`, `partner_wallets`, `wallet_transactions` | Comprehensive double-entry style financial tables exist. |
| 20 | **Live tracking and availability** | **FULLY SUPPORTED** | `partner_availability`, `partner_live_locations`, `partner_location_history` | Tables exist with active booking FKs and coordinates. |

---

## 2. Summary of Schema Support

- **Fully Supported**: 5 / 20 (25%)
- **Partially Supported**: 7 / 20 (35%)
- **Not Supported**: 8 / 20 (40%)

---

## 3. Exact Proposed Schema Changes (Draft Proposal — No Migrations Run)

### 3.1. New Table: `driver_profiles`
```sql
CREATE TABLE driver_profiles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    license_number VARCHAR(100) NOT NULL UNIQUE,
    license_valid_until DATE NOT NULL,
    license_type VARCHAR(50) NOT NULL, -- LMV, HMV, TRANSPORT
    experience_years INT NOT NULL DEFAULT 0,
    approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    rejection_reason TEXT,
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2. New Table: `driver_invitations`
```sql
CREATE TABLE driver_invitations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_partner_id BIGINT NOT NULL REFERENCES partner_profiles(id) ON DELETE CASCADE,
    vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
    driver_mobile_number VARCHAR(20) NOT NULL,
    driver_name VARCHAR(100) NOT NULL,
    invitation_token VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
    accepted_driver_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_driver_invitations_mobile ON driver_invitations(driver_mobile_number, status);
```

### 3.3. New Table: `vehicle_driver_assignments`
```sql
CREATE TABLE vehicle_driver_assignments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    driver_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_by_partner_id BIGINT NOT NULL REFERENCES partner_profiles(id) ON DELETE RESTRICT,
    assignment_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (assignment_status IN ('ACTIVE', 'TERMINATED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Enforces: ONE vehicle can have only ONE active driver at a time
CREATE UNIQUE INDEX uq_active_vehicle_driver ON vehicle_driver_assignments(vehicle_id) WHERE assignment_status = 'ACTIVE';
```

### 3.4. New Table: `vehicle_documents`
```sql
CREATE TABLE vehicle_documents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL, -- RC, FITNESS, INSURANCE, POLLUTION, PERMIT
    document_storage_key TEXT NOT NULL,
    valid_until DATE,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED')),
    rejection_reason TEXT,
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_id);
```

### 3.5. New Table: `worker_profiles`
```sql
CREATE TABLE worker_profiles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    is_independent_eligible BOOLEAN NOT NULL DEFAULT true,
    max_lifting_weight_kg NUMERIC(6, 2) DEFAULT 50.00,
    approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    rejection_reason TEXT,
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 3.6. New Table: `worker_affiliations`
```sql
CREATE TABLE worker_affiliations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    worker_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_id BIGINT NOT NULL REFERENCES partner_profiles(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'TERMINATED')),
    initiated_by VARCHAR(20) NOT NULL CHECK (initiated_by IN ('PARTNER', 'WORKER')),
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_worker_partner_active_affiliation ON worker_affiliations(worker_user_id, partner_id) WHERE status = 'ACCEPTED';
```

### 3.7. New Table: `kyc_document_types` & `kyc_requirement_rules`
```sql
CREATE TABLE kyc_document_types (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type_code VARCHAR(50) NOT NULL UNIQUE,
    type_name VARCHAR(100) NOT NULL,
    requires_expiry_date BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE kyc_requirement_rules (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL REFERENCES roles(role_name) ON DELETE RESTRICT,
    profile_type VARCHAR(50), -- INDIVIDUAL, BUSINESS, or NULL
    document_type_id BIGINT NOT NULL REFERENCES kyc_document_types(id) ON DELETE RESTRICT,
    is_mandatory BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 3.8. New Tables: `permissions` & `role_permissions`
```sql
CREATE TABLE permissions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    permission_code VARCHAR(100) NOT NULL UNIQUE, -- e.g. 'PARTNER_APPROVE', 'PAYMENT_REFUND'
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE role_permissions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id)
);
```

