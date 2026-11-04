# Comprehensive Security & Architecture Risk Register

**Audit Date**: November 4, 2026  
**Auditor**: Senior Backend Security Engineer & Architect  
**Scope**: Full Platform Risk Analysis across Identity, Vehicles, Drivers, Workers, Bookings, Storage, and Financials

---

## 1. Risk Priority Summary

| Priority Level | Risk Count | Action Required |
|---|---|---|
| **CRITICAL** | 3 | Must be resolved before any real-world commercial bookings or transactions. |
| **HIGH** | 5 | Must be resolved during role-specific expansion phases (6A–6F). |
| **MEDIUM** | 4 | Should be addressed prior to beta testing and load verification. |
| **LOW** | 2 | Scheduled for operational polish and monitoring phases. |

---

## 2. Detailed Risk Register

### RISK-01: Premature Partner Approval Without Verified KYC Documents
- **Priority**: **CRITICAL**
- **Category**: Regulatory Compliance & Business Logic
- **Location**: `src/modules/admin/admin.service.ts` (`approvePartner`)
- **Vulnerability**: `approvePartner` performs no validation on uploaded documents. An administrator can mark a partner as `APPROVED` even if zero documents are uploaded, or if uploaded documents are `PENDING` or `REJECTED`.
- **Impact**: Unvetted operators could be approved to enter customer premises or transport high-value goods, creating severe legal, safety, and brand liability.
- **Mitigation**: Introduce a strict pre-approval guard requiring all role-mandatory KYC document types to exist with `verification_status = 'VERIFIED'`.

---

### RISK-02: Partner Suspension Does Not Revoke Active Access or Enforce Operational Blocking
- **Priority**: **CRITICAL**
- **Category**: Authorization & Access Control
- **Location**: `src/modules/admin/admin.service.ts` (`suspendPartner`), `src/common/middlewares/auth.middleware.ts`
- **Vulnerability**: When an admin calls `PATCH /api/v1/admin/partners/:id/suspend`, `partner_profiles.approvalStatus` is updated to `'SUSPENDED'`. However:
  1. Active JWTs and `user_sessions` are not revoked.
  2. Partner routes (`/skills`, `/service-areas`, `/profile`) only check `requireAuth` and never check `partner.approvalStatus === 'APPROVED'`.
  3. Token refresh continues to succeed.
- **Impact**: A suspended partner continues to interact with the platform and modify profile data. In Phase 7, a suspended partner would be eligible for booking dispatch if status is not explicitly verified.
- **Mitigation**: Implement `requireApprovedPartner` middleware checking `approvalStatus === 'APPROVED'` on all operational partner routes. Restrict dispatch engine to query only `APPROVED` partners.

---

### RISK-03: Non-Atomic Administrative Status Updates and Audit Logging
- **Priority**: **CRITICAL**
- **Category**: Data Integrity & Compliance
- **Location**: `src/modules/admin/admin.service.ts` (all mutation methods)
- **Vulnerability**: Administrative mutations (`updatePartnerStatus`, `updateDocumentStatus`, `updateSkillStatus`) and audit logging (`createAuditLog`) are called as separate, un-transactioned queries.
- **Impact**: If a server crash, connection reset, or database timeout occurs between the two queries, the entity status is permanently modified with zero audit record, breaking compliance trails and non-repudiation.
- **Mitigation**: Wrap all admin state mutations and their associated audit log inserts in atomic `prisma.$transaction(async (tx) => { ... })` blocks.

---

### RISK-04: Vehicle Ownership Fraud & Unauthorized Fleet Registration
- **Priority**: **HIGH**
- **Category**: Fraud Prevention & Data Model
- **Location**: Schema `vehicles`, `partner_vehicles`
- **Vulnerability**: The current schema links vehicles to partners via `partner_vehicles`, but lacks an explicit `owner_partner_id` FK and lacks vehicle ownership proof verification (e.g. RC transfer deed, commercial permit). A malicious user could register an existing vehicle registration number and claim it.
- **Impact**: Vehicle disputes between actual vehicle owners and fleet managers, illegal vehicle bookings.
- **Mitigation**: Add `owner_partner_id` on `vehicles`, mandate commercial RC document verification before activating any vehicle in dispatch.

---

### RISK-05: Concurrent Driver Assignment & Double Driver Collision
- **Priority**: **HIGH**
- **Category**: Concurrency & State Invariants
- **Location**: Missing `vehicle_driver_assignments` table
- **Vulnerability**: In the absence of an explicit unique constraint on active vehicle drivers, two owners could assign the same driver simultaneously, or one vehicle could have two drivers assigned at the same time.
- **Impact**: Operational dispatch chaos, GPS tracking collisions, insurance nullification.
- **Mitigation**: Create `vehicle_driver_assignments` with a partial unique index:
  `CREATE UNIQUE INDEX uq_active_vehicle_driver ON vehicle_driver_assignments(vehicle_id) WHERE assignment_status = 'ACTIVE';`

---

### RISK-06: Worker Double Booking Across Affiliated Vehicle Partners
- **Priority**: **HIGH**
- **Category**: Scheduling & Concurrency
- **Location**: `booking_assignments`
- **Vulnerability**: A worker can affiliate with multiple vehicle partners. If two partners receive shifting jobs at the same time slot, both might assign the same worker without a centralized schedule conflict check.
- **Impact**: Worker fails to appear for shifting jobs, delayed moves, customer complaints.
- **Mitigation**: Maintain centralized availability in `partner_availability` for every individual worker and lock time slots atomically during dispatch assignment.

---

### RISK-07: Concurrent Booking Assignment Race Condition (Over-Allocation)
- **Priority**: **HIGH**
- **Category**: Concurrency & Inventory Lock
- **Location**: `booking_assignments`
- **Vulnerability**: If multiple partners are offered the same high-demand booking simultaneously, concurrent acceptance requests without row-level locking (`SELECT ... FOR UPDATE`) or atomic status checks could lead to multiple partners believing they won the assignment.
- **Impact**: Multiple providers arrive at customer doorstep for a single booking.
- **Mitigation**: Enforce atomic check-and-set updates in PostgreSQL:
  `UPDATE bookings SET booking_status = 'ASSIGNED' WHERE id = :id AND booking_status = 'SEARCHING_PARTNER';`

---

### RISK-08: Expired Document Operational Exposure (License & Insurance)
- **Priority**: **HIGH**
- **Category**: Regulatory Compliance & Fleet Safety
- **Location**: `vehicles`, `partner_documents`
- **Vulnerability**: Documents that were valid at onboarding time will eventually expire (driver license, vehicle fitness, vehicle insurance). The current system has no automated background job to transition verified documents to `EXPIRED` status.
- **Impact**: Vehicles with lapsed insurance or drivers with expired licenses dispatching customer orders.
- **Mitigation**: Implement a daily cron job via BullMQ checking `valid_until < CURRENT_DATE` to automatically mark documents `EXPIRED` and suspend vehicle/driver dispatch eligibility.

---

### RISK-09: Missing Admin Document Streaming Endpoint (Blind Verification)
- **Priority**: **MEDIUM**
- **Category**: Operational Usability & Verification Fraud
- **Location**: `src/modules/admin/admin.routes.ts`
- **Vulnerability**: There is currently no endpoint allowing administrators to view or stream uploaded KYC document images/PDFs. Documents can only be verified blindly by ID.
- **Impact**: Reviewing admins cannot visually inspect the document, creating an incentive to rubber-stamp unverified uploads.
- **Mitigation**: Implement `GET /api/v1/admin/partners/documents/:id/file` guarded by `requireAuth` and `requireAdmin` with strict MIME-type streaming.

---

### RISK-10: Financial Ledger Discrepancy & Double Refund Risk
- **Priority**: **MEDIUM**
- **Category**: Financial Ledger & Invariants
- **Location**: `payments`, `refunds`, `partner_wallets`
- **Vulnerability**: If a refund request is triggered concurrently, lack of distributed locking or idempotency keys could allow double-processing of refunds against a single captured payment.
- **Impact**: Direct capital loss for the platform.
- **Mitigation**: Implement `idempotency_key` unique constraints on `refunds` and enforce that total refunded amount cannot exceed original `payment.amount`.

---

### RISK-11: Permissive Lifecycle State Transitions (Suspending Unapproved Partner)
- **Priority**: **MEDIUM**
- **Category**: State Machine Integrity
- **Location**: `src/modules/admin/admin.service.ts` (`suspendPartner`)
- **Vulnerability**: `suspendPartner` only checks `if (partner.approvalStatus === 'SUSPENDED')`. It permits suspending a `PENDING` or `REJECTED` partner.
- **Impact**: Corrupts partner lifecycle telemetry and audit metrics.
- **Mitigation**: Require `if (partner.approvalStatus !== 'APPROVED') throw new BadRequestError('Only approved partners can be suspended.');`

---

### RISK-12: Super Admin vs Admin Privilege Separation Gap
- **Priority**: **MEDIUM**
- **Category**: Privilege Escalation
- **Location**: `src/common/middlewares/auth.middleware.ts` (`requireAdmin`)
- **Vulnerability**: `requireAdmin` accepts both `ADMIN` and `SUPER_ADMIN`. Currently, standard administrators can perform platform-wide suspensions and overrides with no granular permission boundaries.
- **Impact**: Compromised administrator credentials could disrupt the entire platform.
- **Mitigation**: Implement granular permissions table and restrict platform-level configurations to `requireSuperAdmin`.

---

### RISK-13: Potential Memory & Connection Pool Bottleneck under 100k+ Users
- **Priority**: **LOW**
- **Category**: Scalability & Performance
- **Location**: `src/config/db.config.ts`, PostgreSQL pool
- **Vulnerability**: As user sessions and telemetry history grow past 100,000 users, unindexed queries on large historical tables (`partner_location_history`, `notifications`) could saturate the PostgreSQL connection pool.
- **Impact**: Elevated API latency during peak morning/evening shifting hours.
- **Mitigation**: Implement Redis caching for read-heavy static routes (cities, categories, vehicle types) and partition `partner_location_history` by date range.

---

### RISK-14: Sensitive Data Logging Leakage
- **Priority**: **LOW**
- **Category**: Information Disclosure
- **Location**: `src/config/logger.config.ts`
- **Vulnerability**: While plain OTPs and tokens are currently excluded from logs, error stack traces in non-production environments may dump request bodies.
- **Impact**: Accidental logging of customer addresses or mobile numbers in server log aggregators.
- **Mitigation**: Ensure strict log sanitization / masking middleware for PII fields (`mobileNumber`, `addressLine1`, `rcNumber`).

