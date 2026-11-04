# Phase 6C: Vehicle Ownership & Fleet Management — Implementation Report

**Date:** 2026-11-04  
**Project:** Multi-Service Marketplace Backend  
**Directory:** `C:\Users\baps\Desktop\Backend`  
**Stack:** Node.js, Express, TypeScript, PostgreSQL 18, Prisma ORM, Redis, Jest  
**Status:** Completed & Fully Verified (141 / 141 Tests Passing)  

---

## 1. Executive Summary & Architecture Principles

In our asset-light, multi-service marketplace, vehicle partners own or are legally authorized to operate their vehicles. The platform provides software mediation, booking dispatch, and customer payment processing; the platform **never** owns, leases, or provides fleet vehicles.

Phase 6C delivers a production-grade, enterprise-ready **Vehicle Ownership & Fleet Management** module that enforces:
1. **Multi-Vehicle Fleet Management:** Partners can register and manage multiple commercial vehicles with a dedicated primary vehicle designation.
2. **Strict Legal Ownership Distinctions:**
   - `OWNER`: The partner is the direct registered owner on the vehicle RC.
   - `AUTHORIZED_REPRESENTATIVE`: A third party owns the vehicle; the partner operates it with mandatory documented legal authorization (`ownerName` and `OWNER_AUTHORIZATION` / Power of Attorney).
   - `LEASED`: The partner operates under a formal commercial lease (`ownerName` and `LEASE_AGREEMENT`).
3. **Historical Ownership Integrity & Engine-Level Safety:**
   - Enforced by PostgreSQL Partial Unique Index: `idx_one_active_partner_per_vehicle ON partner_vehicles (vehicle_id) WHERE ownership_status = 'ACTIVE'`.
   - A vehicle can have only one active managing partner at any moment, while permanently preserving historical ownership relationships (`TRANSFERRED`, `TERMINATED`, `unassigned_at`).
4. **Immutable Document Replacement History:**
   - Vehicle document updates never overwrite existing rows; they insert a new audit-tracked record with status `PENDING`.
5. **Calendar-Day Midnight Expiry Evaluation:**
   - Stored as PostgreSQL `DATE`. Documents remain valid through 23:59:59.999 of their expiry date.
   - Zero-grace-period operational blocking on expiration.
   - Proactive 15-day warning window (`isExpiringSoon`).
6. **Configurable Fail-Closed KYC Validation Service:**
   - Strategy pattern (`IVehicleKycPolicyProvider`). Missing or invalid policies fail closed.
7. **Administrative Governance & Super Admin Ownership Transfer:**
   - Admin document verify/reject with mandatory reasons, vehicle approve/suspend/reactivate with self-approval guards.
   - Ownership transfers restricted strictly to `SUPER_ADMIN` with atomic audit logging.

---

## 2. Database & Schema Enhancements

### 2.1 Verified Pre-Implementation Database Backup
- Backup file created and verified: `backups/service_platform_db_backup_20261104184145_phase6b.sql` (109,984 bytes).

### 2.2 Additive Migration: `012_vehicle_ownership_documents.sql`
- **Location:** `migrations/012_vehicle_ownership_documents.sql`
- **Migration Tracking:** Registered in `public.schema_migrations`.
- **Database Engine Changes:**
  1. **New Table: `public.vehicle_documents`**
     - Columns: `id` (bigserial PK), `vehicle_id` (bigint FK), `document_type` (varchar(50)), `document_storage_key` (text), `expiry_date` (date NULL), `verification_status` (varchar(20) DEFAULT 'PENDING'), `rejection_reason` (text NULL), `reviewed_by` (bigint FK NULL), `reviewed_at` (timestamptz NULL), `uploaded_at` (timestamptz DEFAULT now()).
     - CHECK constraints:
       - `chk_vehicle_document_type` (`RC`, `INSURANCE`, `FITNESS`, `POLLUTION_PUC`, `COMMERCIAL_PERMIT`, `OWNER_AUTHORIZATION`, `LEASE_AGREEMENT`, `OTHER`).
       - `chk_vehicle_document_status` (`PENDING`, `VERIFIED`, `REJECTED`).
     - Foreign keys with `ON DELETE CASCADE` to `vehicles` and `ON DELETE SET NULL` to `users`.
  2. **Enriched `public.partner_vehicles`:**
     - Added column `ownership_type varchar(30) NOT NULL DEFAULT 'OWNER'`.
     - Added column `owner_name varchar(150) NULL`.
     - Added column `ownership_status varchar(20) NOT NULL DEFAULT 'ACTIVE'`.
     - Added column `unassigned_at timestamptz NULL`.
     - CHECK constraints:
       - `chk_partner_vehicle_ownership_status` (`ACTIVE`, `TRANSFERRED`, `TERMINATED`).
       - `chk_partner_vehicle_ownership_type` (`OWNER`, `LEASED`, `AUTHORIZED_REPRESENTATIVE`).
  3. **Partial Unique Index (Replacing Static Unique Constraint):**
     - Dropped legacy constraint `uq_partner_vehicle (partner_id, vehicle_id)`.
     - Added `idx_one_active_partner_per_vehicle ON public.partner_vehicles (vehicle_id) WHERE ownership_status = 'ACTIVE'`.
  4. **Idempotent Commercial Vehicle Types Seed:**
     - `TWO_WHEELER`: 30 kg, Courier / Small Parcel.
     - `THREE_WHEELER`: 500 kg, Cargo Auto / Ape.
     - `TATA_ACE`: 850 kg, Chhota Hathi Mini Truck.
     - `PICKUP_8FT`: 1,250 kg, 8ft Pickup / Dost.
     - `CANTER_14FT`: 3,500 kg, 14ft Commercial Truck.

### 2.3 Prisma ORM Model Synchronization
- Added `model VehicleDocument` with relations to `Vehicle` and `User` (reviewer).
- Updated `model PartnerVehicle` with `ownershipType`, `ownerName`, `ownershipStatus`, and `unassignedAt`.
- Updated `model Vehicle` and `model User` reverse relations.
- Executed `npx prisma generate`.
- Verified live schema parity using `scripts/verify_prisma_against_live_db.js`:
  - **42 database tables = 42 Prisma models**.
  - **71 foreign keys in 100% exact harmony**.

---

## 3. Core Vehicle Module & API Endpoints

### 3.1 Partner Fleet Endpoints (`/api/v1/partners/vehicles`)
| Method | Route | Description | Guards |
| :--- | :--- | :--- | :--- |
| `GET` | `/types` | List available commercial vehicle types | `requireAuth`, `requirePartner` |
| `POST` | `/` | Register new vehicle into partner fleet | `requireAuth`, `requirePartner`, Zod validation |
| `GET` | `/` | List all active vehicles in authenticated partner's fleet | `requireAuth`, `requirePartner` |
| `GET` | `/:id` | Get vehicle details with KYC status & operational eligibility | `requireAuth`, `requirePartner`, Tenant Isolation |
| `PATCH` | `/:id` | Update vehicle make, model, year, RC number | `requireAuth`, `requirePartner`, Tenant Isolation |
| `PATCH` | `/:id/primary` | Designate primary vehicle in fleet | `requireAuth`, `requirePartner`, Tenant Isolation |
| `PATCH` | `/:id/status` | Partner toggles active status (maintenance downtime) | `requireAuth`, `requirePartner`, Tenant Isolation |
| `POST` | `/:id/documents` | Upload KYC document (multipart/form-data) | `requireAuth`, `requirePartner`, Tenant Isolation |
| `GET` | `/:id/documents` | List uploaded documents for vehicle | `requireAuth`, `requirePartner`, Tenant Isolation |
| `GET` | `/:id/documents/:docId/file` | Securely stream vehicle document binary | `requireAuth`, `requirePartner`, Tenant Isolation |

### 3.2 Public Alias Endpoint
| Method | Route | Description | Guards |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/vehicles/types` | Public catalog of active vehicle types | None (Public) |

---

## 4. Admin Vehicle Governance & Document Inspection

### 4.1 Admin Vehicle Endpoints (`/api/v1/admin/vehicles`)
| Method | Route | Description | Guards |
| :--- | :--- | :--- | :--- |
| `GET` | `/pending` | List pending vehicle verification queue | `requireAuth`, `requireAdmin` |
| `GET` | `/:id` | Complete vehicle inspection dossier with KYC evaluation | `requireAuth`, `requireAdmin` |
| `POST`/`PATCH` | `/:id/approve` | Approve vehicle (fail-closed KYC validation gate) | `requireAuth`, `requireAdmin`, Self-approval guard |
| `POST`/`PATCH` | `/:id/reject` | Reject vehicle with mandatory reason | `requireAuth`, `requireAdmin`, Self-approval guard |
| `POST`/`PATCH` | `/:id/suspend` | Suspend verified vehicle with mandatory reason | `requireAuth`, `requireAdmin`, Self-approval guard |
| `POST`/`PATCH` | `/:id/reactivate` | Reactivate suspended vehicle | `requireAuth`, `requireAdmin`, Self-approval guard |
| `POST` | `/documents/:docId/verify` | Verify individual vehicle document | `requireAuth`, `requireAdmin`, Self-approval guard |
| `POST` | `/documents/:docId/reject` | Reject individual document with mandatory reason | `requireAuth`, `requireAdmin`, Self-approval guard |
| `GET` | `/documents/:docId/file` | Secure document stream for admin inspection | `requireAuth`, `requireAdmin` |
| `POST` | `/:id/transfer` | Authorize vehicle ownership transfer | `requireAuth`, `requireSuperAdmin` |

### 4.2 Security Guards & Safeguards
- **Self-Approval Guard:** Administrators cannot approve, reject, suspend, or verify documents for vehicles registered to their own partner account (`403 Forbidden`).
- **Secure File Streaming:** Document streaming sets `Content-Type`, `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment; filename="...pdf"` to prevent MIME sniffing and script execution.
- **Fail-Closed KYC Validation:** Approval fails if any mandatory document is missing, unverified, or expired.
- **Atomic Transactions:** All status changes and transfers execute inside `prisma.$transaction` with simultaneous `audit_logs` record creation.

---

## 5. Super Admin Vehicle Transfer & Historical Preservation

Vehicle ownership transfer (`POST /api/v1/admin/vehicles/:id/transfer`) executes the following atomic operations:
1. Validates that caller holds `SUPER_ADMIN` role (non-super-admins receive `403 Forbidden`).
2. Locates the existing active relationship for the vehicle.
3. Updates the existing `partner_vehicles` record:
   - Sets `ownership_status = 'TRANSFERRED'`.
   - Populates `unassigned_at = now()`.
   - Records transfer reason.
4. Inserts a new `partner_vehicles` record for the target partner:
   - Sets `ownership_status = 'ACTIVE'`.
   - Sets `ownership_type` and `owner_name`.
   - Sets `assigned_at = now()`.
5. Resets vehicle `verification_status` back to `PENDING` to mandate fresh admin inspection under the new partner.
6. Records an audit log entry (`action = 'VEHICLE_TRANSFERRED'`).
7. Due to the partial unique index, the former partner relationship remains permanently in the database for history and dispute resolution, while the new partner assumes exclusive active control.

---

## 6. Comprehensive Verification & Test Results

### 6.1 Phase 6C Dedicated Test Suite (`tests/phase6c.test.ts`)
The 29 test cases in `tests/phase6c.test.ts` pass 100%:
```
PASS tests/phase6c.test.ts
  Phase 6C: Vehicle Ownership & Fleet Management Verification
    1. Vehicle Types Catalog
      √ GET /api/v1/partners/vehicles/types - should return active vehicle types (47 ms)
      √ GET /api/v1/vehicles/types - public alias should also return vehicle types (11 ms)
    2. Vehicle Registration & Ownership
      √ POST /api/v1/partners/vehicles - should register a new vehicle as OWNER and set isPrimary: true (53 ms)
      √ POST /api/v1/partners/vehicles - duplicate active registration must be rejected with 409 Conflict (31 ms)
      √ POST /api/v1/partners/vehicles - should mandate ownerName when ownershipType is AUTHORIZED_REPRESENTATIVE (11 ms)
      √ POST /api/v1/partners/vehicles - should register vehicle with AUTHORIZED_REPRESENTATIVE when ownerName is provided (33 ms)
    3. Fleet Listing, Primary Vehicle & Active Status
      √ GET /api/v1/partners/vehicles - should list all vehicles in partner fleet (15 ms)
      √ PATCH /api/v1/partners/vehicles/:id/primary - should switch primary vehicle (34 ms)
      √ PATCH /api/v1/partners/vehicles/:id/status - should toggle vehicle active status (52 ms)
      √ Tenant Isolation: Partner B cannot access or modify Partner A vehicle (24 ms)
    4. Document Upload, Replacement Immutability & Expiry Validation
      √ POST /api/v1/partners/vehicles/:id/documents - should upload RC document (41 ms)
      √ Document Replacement Immutability: Uploading new RC creates a NEW record, old is preserved (22 ms)
      √ Calendar-day Expiry Validation: Expired document immediately flags isExpired: true and operationalStatus: false (37 ms)
      √ Calendar-day Expiry Validation: 15-day warning window flags isExpiringSoon: true (22 ms)
      √ Calendar-day Expiry Validation: Document expiring today is valid through 23:59:59 (isExpired: false) (25 ms)
      √ Secure Document Streaming: Partner can stream their uploaded document with safe security headers (17 ms)
      √ Secure Document Streaming: Partner B cannot stream Partner A vehicle document (12 ms)
    5. Admin Vehicle Governance & Document Verification
      √ GET /api/v1/admin/vehicles/pending - should list vehicle in pending review queue (13 ms)
      √ GET /api/v1/admin/vehicles/:id - should return complete vehicle dossier with KYC evaluation (12 ms)
      √ POST /api/v1/admin/vehicles/documents/:docId/reject - reject document with mandatory reason (25 ms)
      √ POST /api/v1/admin/vehicles/:id/approve - fail-closed gate blocks approval when documents are rejected/unverified (14 ms)
      √ Upload new RC document and verify all documents (78 ms)
      √ POST /api/v1/admin/vehicles/:id/approve - succeeds once all mandatory documents are verified (20 ms)
      √ POST /api/v1/admin/vehicles/:id/suspend - suspends verified vehicle with mandatory reason (19 ms)
      √ POST /api/v1/admin/vehicles/:id/reactivate - reactivates suspended vehicle (20 ms)
      √ Secure Document Streaming: Admin can stream vehicle document file (13 ms)
      √ Self-approval prevention: Admin cannot approve or suspend vehicles registered to their own partner account (40 ms)
    6. Vehicle Ownership Transfer (Super Admin Only)
      √ POST /api/v1/admin/vehicles/:id/transfer - non-super-admin is forbidden (403) (14 ms)
      √ POST /api/v1/admin/vehicles/:id/transfer - Super Admin transfers ownership: closes previous, creates new active, resets to PENDING (64 ms)

Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
Time:        4.466 s
```

### 6.2 Full Regression Test Suite Results (`npm test`)
All 8 test suites pass with zero regressions:
```
Test Suites: 8 passed, 8 total
Tests:       141 passed, 141 total
Snapshots:   0 total
Time:        9.314 s

Suite Breakdown:
- tests/phase6c.test.ts (29 tests) - Vehicle Ownership & Fleet Management
- tests/phase6b.test.ts (30 tests) - Unified Identity & Role Switching
- tests/phase6.test.ts  (36 tests) - Baseline Core Functionality
- tests/phase6a.test.ts (21 tests) - Security Hardening & Approval Gate
- tests/auth.test.ts    (18 tests) - Authentication & OTP Lifecycle
- tests/health.test.ts  (2 tests)  - Health & DB Connectivity
- tests/error-handling.test.ts (2 tests) - Centralized Error Handling
- tests/env.test.ts     (3 tests)  - Environment Variable Validation
```

### 6.3 TypeScript Build Verification
`npm run build` (`npx tsc`) compiles cleanly with **0 errors**.

---

## 7. Scope Boundary Confirmation

Phase 6C scope is strictly self-contained and complete. In accordance with platform governance:
- **Driver Management (Phase 6D)** has **NOT** been started (no driver invitations, driver onboarding, or driver-to-vehicle assignments).
- **Worker Management (Phase 6E)** has **NOT** been started.
- **Booking & Dispatch (Phase 7)** has **NOT** been started.

Phase 6C is fully completed and ready for production deployment or client review.

