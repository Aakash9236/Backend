# Phase 6C — Vehicle Ownership & Fleet Management
## Architecture Plan & Verification Specification

**Date:** 2026-11-04  
**Project:** Multi-Service Marketplace Backend  
**Directory:** `C:\Users\baps\Desktop\Backend`  
**Stack:** Node.js, Express, TypeScript, PostgreSQL 18, Prisma ORM, Redis, Jest  
**Status:** Architecture Plan Revised & Finalized — Awaiting Implementation Authorization  

---

## 1. Executive Summary & Objective

In our asset-light, multi-service marketplace, vehicle partners own or are legally authorized to operate their vehicles. The platform provides software mediation, job discovery, booking dispatch, and customer payment processing; the platform **never** owns, leases, or provides fleet vehicles.

This document presents the finalized, production-grade architecture design for **Phase 6C: Vehicle Ownership & Fleet Management**, fully incorporating all review feedback and mandatory architecture corrections.

### Confirmed Core Principles
1. **Multi-Vehicle Fleet Management:** A partner can register and manage multiple vehicles.
2. **One Active Ownership/Operating Authority:** A vehicle can have **only one active** partner ownership or operating relationship at any given time.
3. **Legal Ownership vs. Authorization to Operate:**
   - **Direct Owner (`OWNER`):** Partner's verified legal identity matches the registered owner on the vehicle Registration Certificate (RC).
   - **Authorized Operator (`AUTHORIZED_REPRESENTATIVE` / `LEASED`):** Partner operates a third-party vehicle. RC owner details must be recorded, and an official Lease Agreement, Power of Attorney, or Owner NOC with identity proof is strictly mandatory.
4. **Permanent Ownership History:** Vehicle transfers do not overwrite previous records. Transfers close the former partner's operating relationship (`ownership_status = 'TRANSFERRED'`, `unassigned_at = CURRENT_TIMESTAMP`) and create a new active relationship, requiring authorized Admin approval and atomic audit trails.
5. **Decoupled Verification Lifecycles:**
   - Vehicle verification is strictly decoupled from partner account approval.
   - Vehicle verification is strictly decoupled from driver verification (Phase 6D).
6. **Immutable Document Replacement History:** Every document upload creates a separate, immutable record. Old documents, reviewer history, and rejection reasons are permanently preserved. Replacement documents enter `PENDING` verification and do not restore operational eligibility until approved.
7. **Date-Based Expiry & Zero Grace Period:** Expiry comparisons are calendar-date based. A document remains valid throughout its expiry calendar date (until 23:59:59.999) and expires immediately when the calendar day passes (`current_date > expiry_date`). Zero grace period applies. A 15-calendar-day warning window flags upcoming expirations.
8. **Configurable KYC Requirements:** Document requirements are not hardcoded. The `IVehicleKycPolicyProvider` determines mandatory and conditional documents based on vehicle type, service category, ownership type, and legal applicability, failing closed if policy configuration is missing or invalid.
9. **Multi-Service Vehicle Types:** Vehicle types support multiple service categories (`SHIFTING`, `VEHICLE_SERVICES`), with realistic and idempotent seed data.
10. **Strict Fleet Authorization:** Partner vehicle endpoints strictly enforce authentication, active `PARTNER` role context, partner profile existence, and active fleet ownership.
11. **Future Compatibility with Phase 6D:** Partner-owners who drive their own vehicles are supported cleanly via Phase 6B unified identity (`PARTNER` + `DRIVER` roles), reserving driver invitations and vehicle assignments for Phase 6D.

---

## 2. Architecture Review Corrections

This section documents the specific architectural decisions and corrections established during the review.

### Correction 1: Historical Ownership Integrity & Partial Uniqueness

#### 1. Final Design Decision
- A vehicle can have **exactly one active** partner relationship at any time (`ownership_status = 'ACTIVE'`, `unassigned_at IS NULL`).
- When a vehicle is sold or transferred to a new partner:
  - The previous record in `partner_vehicles` is updated to `ownership_status = 'TRANSFERRED'` and `unassigned_at = CURRENT_TIMESTAMP`. It is **never deleted or overwritten**.
  - A new record in `partner_vehicles` is inserted for the recipient partner with `ownership_status = 'ACTIVE'`, `assigned_at = CURRENT_TIMESTAMP`, and `unassigned_at = NULL`.
  - The vehicle's `verification_status` resets to `'PENDING'` so the new partner must submit valid ownership/authorization documents.
  - All transfers require Admin authorization (`POST /api/v1/admin/vehicles/:id/transfer`) with atomic audit logging.
- **Legal Distinction:**
  - `OWNER`: The partner is the actual legal owner named on the RC.
  - `AUTHORIZED_REPRESENTATIVE`: A third party owns the vehicle; the partner holds legal authority to operate it via a Power of Attorney / NOC.
  - `LEASED`: The partner operates under a formal commercial lease agreement with the vehicle owner.

#### 2. Database Impact
- In `public.partner_vehicles`:
  - Add column `ownership_type varchar(30) NOT NULL DEFAULT 'OWNER'`.
  - Add column `owner_name varchar(150) NULL`.
  - Add column `ownership_status varchar(20) NOT NULL DEFAULT 'ACTIVE'`.
  - Add column `unassigned_at timestamptz NULL`.
  - Add CHECK constraint: `chk_partner_vehicle_ownership_status CHECK (ownership_status IN ('ACTIVE', 'TRANSFERRED', 'TERMINATED'))`.
  - Add CHECK constraint: `chk_partner_vehicle_ownership_type CHECK (ownership_type IN ('OWNER', 'LEASED', 'AUTHORIZED_REPRESENTATIVE'))`.
  - Replace the old static unique constraint `uq_partner_vehicle (partner_id, vehicle_id)` with a **PostgreSQL Partial Unique Index**:
    ```sql
    CREATE UNIQUE INDEX idx_one_active_partner_per_vehicle 
    ON public.partner_vehicles (vehicle_id) 
    WHERE ownership_status = 'ACTIVE';
    ```
    This guarantees at the database engine level that no vehicle can ever have two active managing partners simultaneously, while allowing multiple historical records.

#### 3. Application Impact
- Vehicle lookup queries for fleet operations enforce:
  `WHERE vehicle_id = $1 AND ownership_status = 'ACTIVE' AND unassigned_at IS NULL`.
- Historical fleet queries allow partners to review previously operated vehicles.

#### 4. Security Implications
- Prevents vehicle hijacking, unauthorized re-registration, or dual-partner dispatch conflicts.
- Guarantees an immutable chain of custody for law enforcement, insurance claims, or regulatory compliance.

#### 5. Test Cases in `tests/phase6c.test.ts`
- `should reject registering a vehicle that is already actively registered by another partner (409 Conflict)`.
- `should allow transferring a vehicle, marking old partner relationship as TRANSFERRED with unassigned_at timestamp`.
- `should create new ACTIVE relationship for recipient partner upon transfer`.
- `should enforce database partial unique index if two active records are attempted concurrently`.

---

### Correction 2: Vehicle Document Replacement History

#### 1. Final Design Decision
- Every document upload creates a **new, immutable row** in `vehicle_documents`.
- Old document records are **never overwritten, mutated, or deleted**.
- Reviewer history (`reviewed_by`, `reviewed_at`) and rejection reasons (`rejection_reason`) remain permanently intact.
- When an expired or rejected document is replaced:
  - A new document row is created with `verification_status = 'PENDING'`.
  - The vehicle remains `BLOCKED` (non-operational) until an Admin explicitly verifies and approves the new upload.
- **Reliable Identification of Latest Valid Document:**
  - Evaluated by querying the most recent document for each required `document_type` on the vehicle:
    ```sql
    SELECT DISTINCT ON (document_type) *
    FROM public.vehicle_documents
    WHERE vehicle_id = $1
    ORDER BY document_type, uploaded_at DESC;
    ```
- **Concurrent Uploads & Approvals Handling:**
  - Optimistic locking and transactional state checks ensure that Admin review operations operate on a specific document `id`.

#### 2. Database Impact
- New table `public.vehicle_documents` with:
  - `id` bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  - `vehicle_id` bigint NOT NULL (FK -> `vehicles.id` ON DELETE CASCADE)
  - `document_type` varchar(50) NOT NULL
  - `document_storage_key` text NOT NULL
  - `expiry_date` date NULL
  - `verification_status` varchar(20) NOT NULL DEFAULT 'PENDING'
  - `rejection_reason` text NULL
  - `reviewed_by` bigint NULL (FK -> `users.id` ON DELETE SET NULL)
  - `reviewed_at` timestamptz NULL
  - `uploaded_at` timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  - Indexes on `(vehicle_id, document_type, uploaded_at DESC)` and `(verification_status)`.

#### 3. Application Impact
- `VehicleRepository` provides `findLatestDocumentsByVehicle(vehicleId)` which aggregates the current state of all document types for a vehicle.
- Replacing an expired document cleanly records replacement audit trails.

#### 4. Security Implications
- Eliminates document tampering, retrospective overwriting, or destruction of rejected document records.
- Guarantees that replacement documents undergo mandatory administrative review before restoring vehicle operational eligibility.

#### 5. Test Cases in `tests/phase6c.test.ts`
- `should create a new vehicle document row when uploading a replacement without overwriting the previous row`.
- `should preserve previous document status, reviewer ID, and rejection reason`.
- `should keep replacement document in PENDING status and keep vehicle blocked until approved`.
- `should reliably retrieve the latest document record per document type`.

---

### Correction 3: Date-Based Expiry Rules & Zero Grace Period

#### 1. Final Design Decision
- Vehicle document expiry is **calendar-date-based**, strictly avoiding sub-day UTC timestamp comparisons that could expire a document prematurely.
- Stored as PostgreSQL `DATE` (`YYYY-MM-DD`).
- **Calendar-Day Validity Rule:**
  - A document with `expiry_date = '2026-11-15'` remains **valid throughout the entire calendar day of November 15, 2026** (until 23:59:59.999 local/IST).
  - It becomes **expired only once the calendar date has completely passed** (`current_calendar_date > expiry_date`, i.e., beginning 00:00:00 on November 16, 2026).
  - **Zero Grace Period:** As soon as `current_calendar_date > expiry_date`, the document is immediately expired, and the vehicle is immediately blocked.
- **15-Calendar-Day Warning Window:**
  - `calendarDaysRemaining = Math.floor((expiryDateMidnight - todayMidnight) / (24 * 60 * 60 * 1000))`
  - If `0 <= calendarDaysRemaining <= 15`: Flagged as `isExpiringSoon: true`, `warning: "DOCUMENT_EXPIRING_SOON"`, `daysRemaining: calendarDaysRemaining`.
  - If `calendarDaysRemaining < 0`: Flagged as `isExpired: true`, `daysRemaining: 0`.

#### 2. Database Impact
- Column `vehicle_documents.expiry_date` is defined as PostgreSQL `DATE` (calendar day without time/timezone component).

#### 3. Application Impact
- Date comparison helper utility `DateUtil.evaluateCalendarExpiry(expiryDate: Date | string)` provides unified calendar-date evaluation across services.

#### 4. Security Implications
- Prevents premature vehicle blocking due to UTC timezone offsets (e.g. UTC 00:00 occurs at 05:30 AM IST).
- Enforces strict compliance: vehicles never operate with expired documents.

#### 5. Test Cases in `tests/phase6c.test.ts`
- `should treat a document expiring on today's calendar date as VALID until the day ends`.
- `should treat a document expiring yesterday as EXPIRED (0 days grace period) and block vehicle`.
- `should flag a document expiring in exactly 15 calendar days with DOCUMENT_EXPIRING_SOON warning`.
- `should not flag a document expiring in 16 calendar days with warning`.

---

### Correction 4: Configurable KYC Policy via Strategy Pattern

#### 1. Final Design Decision
- Document requirements are **never hardcoded**. RC, Insurance, Fitness, and PUC are not universally mandatory across all vehicle classes.
- Architecture uses the Strategy Pattern via `IVehicleKycPolicyProvider`:
  - Evaluates applicable documents based on:
    1. `vehicleTypeCode` (e.g. 2-Wheelers do not require commercial Fitness certificates).
    2. `serviceCategoryCode` (e.g. parcel delivery vs heavy freight shifting).
    3. `ownershipType` (if `AUTHORIZED_REPRESENTATIVE` or `LEASED`, `OWNER_AUTHORIZATION` or `LEASE_AGREEMENT` is strictly mandatory).
    4. `requiresPermit` (State/National commercial goods permit applicability).
  - **Fail-Closed Security Gate:** If the policy provider is missing, encounters an error, or returns an invalid policy object, `validateForApproval` immediately returns `isValid: false` and blocks approval.
- Clean interface designed for seamless future database-backed policy integration in Phase 6F.

#### 2. Database Impact
- Zero database changes required in Phase 6C for policy rules (admin-managed database tables reserved for Phase 6F).

#### 3. Application Impact
- `VehicleKycValidationService` created in `src/modules/vehicles/services/vehicle-kyc.service.ts` with injectable `DefaultVehicleKycPolicyProvider`.

#### 4. Security Implications
- Ensures strict regulatory compliance while avoiding inappropriate document mandates (e.g., demanding heavy-truck commercial fitness certificates for small two-wheeler couriers).

#### 5. Test Cases in `tests/phase6c.test.ts`
- `should require only RC, Insurance and PUC for two-wheeler vehicles (Fitness optional/exempt)`.
- `should mandate OWNER_AUTHORIZATION document when ownership_type is AUTHORIZED_REPRESENTATIVE`.
- `should mandate Commercial Fitness and Permit for heavy commercial trucks`.
- `should fail-closed when policy provider is unavailable or returns invalid policy`.

---

### Correction 5: Multi-Service Vehicle Type Architecture

#### 1. Final Design Decision
- Vehicle types support multiple service categories across the marketplace, not exclusively `SHIFTING`.
- Existing pre-seeded categories in `service_categories` are utilized:
  - `SHIFTING` (`id: 2`)
  - `VEHICLE_SERVICES` (`id: 3`)
- Seed data is minimal, realistic, and strictly idempotent (`ON CONFLICT (type_code) DO NOTHING`):
  1. `TWO_WHEELER` (category `VEHICLE_SERVICES` / `id: 3`): Capacity 30 kg, Volume 2 cuft (courier/small parcels).
  2. `THREE_WHEELER` (category `SHIFTING` / `id: 2`): Capacity 500 kg, Volume 70 cuft (small shifting/auto cargo).
  3. `TATA_ACE` (category `SHIFTING` / `id: 2`): Capacity 850 kg, Volume 120 cuft (mini truck / Chota Hathi).
  4. `PICKUP_8FT` (category `SHIFTING` / `id: 2`): Capacity 1250 kg, Volume 180 cuft (8ft pickup / Bolero Maxi Truck).
  5. `CANTER_14FT` (category `SHIFTING` / `id: 2`): Capacity 3500 kg, Volume 450 cuft (14ft intermediate commercial truck).

#### 2. Database Impact
- Idempotent seed inserts into `public.vehicle_types` using existing foreign keys to `service_categories(id)`.

#### 3. Application Impact
- Vehicle type listing API supports optional filtering by `serviceCategoryId`.

#### 4. Security Implications
- Prevents assigning undersized or legally unauthorized vehicles to freight/shifting orders.

#### 5. Test Cases in `tests/phase6c.test.ts`
- `should list vehicle types across multiple service categories`.
- `should idempotently execute vehicle type seeding without duplicating type_code records`.

---

### Correction 6: Partner Fleet Authorization & Tenant Isolation

#### 1. Final Design Decision
- All partner vehicle endpoints enforce a 5-tier security authorization pipeline:
  1. Authenticated User (`requireAuth`).
  2. Active Role Context (`requireActiveRole('PARTNER')`).
  3. Existing Partner Profile (`requirePartnerProfile`).
  4. Vehicle-to-Partner Relationship (`partner_vehicles.partner_id == req.user.partnerId`).
  5. Active Fleet Relationship (`partner_vehicles.ownership_status == 'ACTIVE'`).
- Role possession alone never confers access: Partner B attempting to inspect, modify, or upload documents for Partner A's vehicle is denied with **403 Forbidden** (or 404 to avoid ID enumeration).

#### 2. Database Impact
- Queries join `partner_vehicles` on `partner_id = user.partnerProfile.id AND ownership_status = 'ACTIVE'`.

#### 3. Application Impact
- Shared middleware `requirePartnerVehicleOwnership` in `src/modules/vehicles/vehicles.middleware.ts`.

#### 4. Security Implications
- Complete multi-tenant data isolation across fleets.

#### 5. Test Cases in `tests/phase6c.test.ts`
- `should forbid Partner B from viewing Partner A's vehicle (403/404)`.
- `should forbid Partner B from uploading documents to Partner A's vehicle`.
- `should forbid a user in CUSTOMER active context from accessing partner vehicle endpoints (403)`.

---

### Correction 7: Database & Migration Safety

#### 1. Final Design Decision
- **1 Additive, Non-Destructive Migration:** `migrations/012_vehicle_ownership_documents.sql`.
- Zero existing columns dropped or renamed.
- Zero existing business data modified or reset.
- Complete foreign keys, indexes, and CHECK constraints.
- Prisma schema updated to reflect the SQL migration precisely.

#### 2. Database Impact
- Fully backward-compatible; all existing 41 tables and all 112 passing tests remain completely unaffected.

---

## 3. Final Proposed Database Schema

### A. SQL Migration: `migrations/012_vehicle_ownership_documents.sql`

```sql
-- =====================================================================
-- MIGRATION: 012_vehicle_ownership_documents.sql
-- DESCRIPTION: Dedicated vehicle documents, ownership metadata, and fleet partial index
-- =====================================================================

BEGIN;

-- 1. Create dedicated vehicle_documents table
CREATE TABLE IF NOT EXISTS public.vehicle_documents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id bigint NOT NULL,
    document_type varchar(50) NOT NULL,
    document_storage_key text NOT NULL,
    expiry_date date NULL,
    verification_status varchar(20) NOT NULL DEFAULT 'PENDING',
    rejection_reason text NULL,
    reviewed_by bigint NULL,
    reviewed_at timestamptz NULL,
    uploaded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_vehicle_document_vehicle 
        FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE,
    CONSTRAINT fk_vehicle_document_reviewer 
        FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_vehicle_doc_status 
        CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    CONSTRAINT chk_vehicle_doc_type 
        CHECK (document_type IN (
            'RC', 
            'INSURANCE', 
            'FITNESS', 
            'POLLUTION_PUC', 
            'COMMERCIAL_PERMIT', 
            'OWNER_AUTHORIZATION', 
            'LEASE_AGREEMENT', 
            'OTHER'
        ))
);

CREATE INDEX IF NOT EXISTS idx_vehicle_documents_lookup 
    ON public.vehicle_documents (vehicle_id, document_type, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_status 
    ON public.vehicle_documents (verification_status);

-- 2. Extend partner_vehicles with ownership metadata
ALTER TABLE public.partner_vehicles 
    ADD COLUMN IF NOT EXISTS ownership_type varchar(30) NOT NULL DEFAULT 'OWNER',
    ADD COLUMN IF NOT EXISTS owner_name varchar(150) NULL,
    ADD COLUMN IF NOT EXISTS ownership_status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS unassigned_at timestamptz NULL;

ALTER TABLE public.partner_vehicles 
    DROP CONSTRAINT IF EXISTS chk_partner_vehicle_ownership_status,
    ADD CONSTRAINT chk_partner_vehicle_ownership_status 
        CHECK (ownership_status IN ('ACTIVE', 'TRANSFERRED', 'TERMINATED'));

ALTER TABLE public.partner_vehicles 
    DROP CONSTRAINT IF EXISTS chk_partner_vehicle_ownership_type,
    ADD CONSTRAINT chk_partner_vehicle_ownership_type 
        CHECK (ownership_type IN ('OWNER', 'LEASED', 'AUTHORIZED_REPRESENTATIVE'));

-- 3. Drop old static unique constraint to allow historical ownership tracking,
-- and replace with partial unique index ensuring only ONE active partner per vehicle.
ALTER TABLE public.partner_vehicles 
    DROP CONSTRAINT IF EXISTS uq_partner_vehicle;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_partner_per_vehicle 
    ON public.partner_vehicles (vehicle_id) 
    WHERE ownership_status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_partner_vehicles_history 
    ON public.partner_vehicles (partner_id, ownership_status);

-- 4. Idempotently seed standard commercial vehicle types
INSERT INTO public.vehicle_types (
    type_code, type_name, service_category_id, capacity_kg, volume_cuft, base_fare, per_km_rate, per_minute_rate, is_active
) VALUES 
(
    'TWO_WHEELER', 
    'Two Wheeler (Courier / Small Parcel)', 
    3, -- VEHICLE_SERVICES
    30.00, 
    2.00, 
    40.00, 
    10.00, 
    1.00, 
    true
),
(
    'THREE_WHEELER', 
    'Three Wheeler (Cargo Auto / Ape)', 
    2, -- SHIFTING
    500.00, 
    70.00, 
    150.00, 
    18.00, 
    2.00, 
    true
),
(
    'TATA_ACE', 
    'Tata Ace (Chota Hathi)', 
    2, -- SHIFTING
    850.00, 
    120.00, 
    250.00, 
    25.00, 
    2.50, 
    true
),
(
    'PICKUP_8FT', 
    '8ft Pickup (Bolero Maxi Truck)', 
    2, -- SHIFTING
    1250.00, 
    180.00, 
    350.00, 
    32.00, 
    3.00, 
    true
),
(
    'CANTER_14FT', 
    '14ft Canter (Intermediate Truck)', 
    2, -- SHIFTING
    3500.00, 
    450.00, 
    700.00, 
    55.00, 
    4.00, 
    true
)
ON CONFLICT (type_code) DO NOTHING;

COMMIT;
```

### B. Prisma Schema Model Definitions

```prisma
model Vehicle {
  id                    BigInt             @id @default(autoincrement())
  vehicleTypeId         BigInt             @map("vehicle_type_id")
  registrationNumber    String             @unique @map("registration_number") @db.VarChar(50)
  make                  String?            @db.VarChar(100)
  model                 String?            @db.VarChar(100)
  manufacturingYear     Int?               @map("manufacturing_year")
  rcNumber              String?            @map("rc_number") @db.VarChar(100)
  fitnessValidUntil     DateTime?          @map("fitness_valid_until") @db.Date
  insuranceValidUntil   DateTime?          @map("insurance_valid_until") @db.Date
  pollutionValidUntil   DateTime?          @map("pollution_valid_until") @db.Date
  verificationStatus    String             @default("PENDING") @map("verification_status") @db.VarChar(20)
  rejectionReason       String?            @map("rejection_reason") @db.Text
  isActive              Boolean            @default(true) @map("is_active")
  createdAt             DateTime           @default(now()) @map("created_at") @db.Timestamptz
  updatedAt             DateTime           @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  vehicleType           VehicleType        @relation(fields: [vehicleTypeId], references: [id], onDelete: Restrict)
  partnerVehicles       PartnerVehicle[]
  documents             VehicleDocument[]

  @@index([vehicleTypeId])
  @@index([verificationStatus])
  @@map("vehicles")
}

model PartnerVehicle {
  id              BigInt         @id @default(autoincrement())
  partnerId       BigInt         @map("partner_id")
  vehicleId       BigInt         @map("vehicle_id")
  isPrimary       Boolean        @default(true) @map("is_primary")
  ownershipType   String         @default("OWNER") @map("ownership_type") @db.VarChar(30)
  ownerName       String?        @map("owner_name") @db.VarChar(150)
  ownershipStatus String         @default("ACTIVE") @map("ownership_status") @db.VarChar(20)
  assignedAt      DateTime       @default(now()) @map("assigned_at") @db.Timestamptz
  unassignedAt    DateTime?      @map("unassigned_at") @db.Timestamptz

  partner         PartnerProfile @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  vehicle         Vehicle        @relation(fields: [vehicleId], references: [id], onDelete: Cascade)

  @@index([partnerId, ownershipStatus])
  @@index([vehicleId])
  @@map("partner_vehicles")
}

model VehicleDocument {
  id                 BigInt    @id @default(autoincrement())
  vehicleId          BigInt    @map("vehicle_id")
  documentType       String    @map("document_type") @db.VarChar(50)
  documentStorageKey String    @map("document_storage_key") @db.Text
  expiryDate         DateTime? @map("expiry_date") @db.Date
  verificationStatus String    @default("PENDING") @map("verification_status") @db.VarChar(20)
  rejectionReason    String?   @map("rejection_reason") @db.Text
  reviewedBy         BigInt?   @map("reviewed_by")
  reviewedAt         DateTime? @map("reviewed_at") @db.Timestamptz
  uploadedAt         DateTime  @default(now()) @map("uploaded_at") @db.Timestamptz

  vehicle            Vehicle   @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  reviewer           User?     @relation("VehicleDocReviewer", fields: [reviewedBy], references: [id], onDelete: SetNull)

  @@index([vehicleId, documentType, uploadedAt(sort: Desc)])
  @@index([verificationStatus])
  @@map("vehicle_documents")
}
```

---

## 4. API Endpoints Specification

### A. Partner Fleet APIs (`/api/v1/partners/vehicles`)
Guards: `requireAuth, requireActiveRole('PARTNER'), requirePartnerProfile`

1. **`GET /types`**: Lists active commercial vehicle types with specifications and rates.
2. **`POST /`**: Registers a vehicle in the authenticated partner's fleet.
   - Body: `{ vehicleTypeId, registrationNumber, make, model, manufacturingYear, rcNumber, ownershipType, ownerName }`
   - Normalizes registration number (uppercase, stripped whitespace/hyphens).
   - Validates that the vehicle is not actively registered by another partner.
3. **`GET /`**: Lists all active and historical vehicles in partner's fleet with operational readiness status.
4. **`GET /:id`**: Retrieves full vehicle dossier, ownership metadata, and document expiry warnings.
5. **`PATCH /:id`**: Updates vehicle non-compliance metadata (make, model, color).
6. **`PATCH /:id/primary`**: Sets designated primary vehicle for partner.
7. **`PATCH /:id/status`**: Partner toggles vehicle `isActive` (e.g. maintenance downtime).
8. **`POST /:id/documents`**: Uploads vehicle document (`RC`, `INSURANCE`, `FITNESS`, `POLLUTION_PUC`, `OWNER_AUTHORIZATION`, `LEASE_AGREEMENT`) with optional `expiryDate`.
   - Multipart file upload (max 5MB, JPG/PNG/WEBP/PDF).
   - Creates an immutable record in `vehicle_documents`.
9. **`GET /:id/documents`**: Lists all uploaded documents with verification status, days remaining, and expiry warnings.
10. **`GET /:id/documents/:docId/file`**: Securely streams uploaded document file with MIME sniffing and ownership validation.

### B. Admin Governance APIs (`/api/v1/admin/vehicles`)
Guards: `requireAuth, requireRole('ADMIN', 'SUPER_ADMIN')`

1. **`GET /pending`**: Lists all vehicles awaiting initial verification across partners.
2. **`GET /:id`**: Retrieves complete admin vehicle inspection dossier.
3. **`POST /documents/:docId/verify`**: Verifies an individual vehicle document with atomic audit log.
4. **`POST /documents/:docId/reject`**: Rejects an individual vehicle document with mandatory rejection reason.
5. **`GET /documents/:docId/file`**: Streams vehicle document binary with admin audit inspection.
6. **`PATCH /:id/approve`**: Approves vehicle. Fails closed if mandatory KYC documents are missing, unverified, or expired.
7. **`PATCH /:id/reject`**: Rejects vehicle with mandatory rejection reason.
8. **`PATCH /:id/suspend`**: Suspends verified vehicle with mandatory suspension reason.
9. **`PATCH /:id/reactivate`**: Reactivates suspended vehicle after compliance clearance.
10. **`POST /:id/transfer`** (`requireSuperAdmin` only): Authorizes vehicle ownership transfer from old partner to new partner, updating history and atomic audit logs.

---

## 5. Security & Operational Rules Summary

| Rule | Enforcement Mechanism |
|---|---|
| **One Active Partner per Vehicle** | PostgreSQL Partial Unique Index `WHERE ownership_status = 'ACTIVE'`. |
| **Ownership Transfer Integrity** | Atomic transaction: closes former record (`TRANSFERRED`), creates new active record, resets status to `PENDING`. |
| **Document Immutability** | New uploads insert new rows. Existing rows are never overwritten. |
| **Date-Based Expiry** | Calendar-day evaluation (`current_calendar_date > expiry_date`). Valid throughout expiry date. |
| **Zero Grace Period** | Immediate operational blocking once expiry date concludes. |
| **15-Day Expiry Warning** | Calendar-day calculation (`0 <= daysRemaining <= 15`). Flagged in all API responses. |
| **Configurable KYC Policy** | Strategy Pattern (`IVehicleKycPolicyProvider`). Fails closed if policy is missing. |
| **Multi-Tenant Fleet Isolation** | Ownership verification checks `partner_vehicles.partner_id == req.user.partnerId`. |
| **Document File Privacy** | Stored in private directory; streamed with safe headers (`nosniff`, `inline`). |
| **Atomic Transactions** | All status mutations and audit logs committed inside `prisma.$transaction`. |

---

## 6. Verification & Test Strategy (`tests/phase6c.test.ts`)

The dedicated Phase 6C test suite will validate:
1. `should list seeded vehicle types across multiple categories (SHIFTING, VEHICLE_SERVICES)`.
2. `should register a vehicle under partner ownership and create ACTIVE partner_vehicles record`.
3. `should reject duplicate registration of an actively registered vehicle (409 Conflict)`.
4. `should register a vehicle with AUTHORIZED_REPRESENTATIVE ownership type and owner name`.
5. `should upload mandatory vehicle documents (RC, Insurance, Fitness, PUC) with calendar expiry dates`.
6. `should create new document row on replacement upload without modifying previous record`.
7. `should treat a document expiring on today's calendar date as valid until the day ends`.
8. `should immediately expire a document past its calendar date and block vehicle (0 days grace period)`.
9. `should flag documents expiring within 15 calendar days with DOCUMENT_EXPIRING_SOON warning`.
10. `should allow admin to verify individual vehicle document and record audit log`.
11. `should allow admin to reject individual vehicle document with mandatory reason`.
12. `should reject vehicle approval if mandatory documents are missing or unverified (fail-closed)`.
13. `should approve vehicle when all required documents are verified and within validity`.
14. `should reject vehicle approval if any mandatory document is expired (UTC calendar check)`.
15. `should allow admin to suspend an approved vehicle with mandatory reason`.
16. `should block suspended vehicle from operational use`.
17. `should allow admin to reactivate a suspended vehicle`.
18. `should forbid Partner B from accessing or uploading documents to Partner A's vehicle (403/404)`.
19. `should securely stream document binary with safe headers and reject unauthorized requests`.
20. `should transfer vehicle ownership, preserving historical record and creating new active record`.
21. `should atomically rollback vehicle status if audit log insertion fails`.
22. `should maintain passing state for all existing 112 tests across Phase 5, 6, 6A, and 6B`.

---

## 7. Implementation Sequence (Post-Authorization)

```
Step 1: Database Migration
  - Create and run migrations/012_vehicle_ownership_documents.sql.
  - Update prisma/schema.prisma and run npx prisma generate.

Step 2: Core Vehicle Modules
  - Author src/modules/vehicles/vehicles.types.ts
  - Author src/modules/vehicles/vehicles.validator.ts
  - Author src/modules/vehicles/vehicles.repository.ts
  - Author src/modules/vehicles/services/vehicle-kyc.service.ts
  - Author src/common/utils/date.util.ts (calendar-day expiry calculations)

Step 3: Partner Vehicle APIs
  - Author src/modules/vehicles/vehicles.service.ts
  - Author src/modules/vehicles/vehicles.controller.ts
  - Author src/modules/vehicles/vehicles.middleware.ts
  - Author src/modules/vehicles/vehicles.routes.ts and register in src/routes/index.ts

Step 4: Admin Vehicle Governance APIs
  - Extend src/modules/admin/admin.repository.ts
  - Extend src/modules/admin/admin.service.ts
  - Extend src/modules/admin/admin.controller.ts & src/modules/admin/admin.routes.ts

Step 5: Testing & Verification
  - Author tests/phase6c.test.ts (22+ comprehensive tests)
  - Run npm test (134+ tests passing across 8 suites)
  - Run npm run build (0 TypeScript compiler errors)
  - Create docs/phase6c-implementation-report.md
```

---

**STRICT STOP CONDITION:**
This architecture plan is finalized and documented. No code, migration files, or database changes have been created. Awaiting your review and explicit authorization to begin Phase 6C implementation.
