# Phase 6D — Batch 1 Implementation Report
## Driver Invitations, Affiliations, Assignments & Shift Lifecycle

**Document Version:** 1.0.0  
**Timestamp:** 2026-11-17  
**Status:** COMPLETED & VERIFIED  
**Scope Covered:** Sub-Milestone 3.3 (Driver Invitations & Affiliations) & Sub-Milestone 3.4 (Vehicle Assignments & Shift Lifecycle)  

---

## 1. Executive Summary

Phase 6D **Batch 1** has been successfully implemented and verified in strict accordance with the approved architecture and product decisions. Batch 1 combines Sub-Milestone 3.3 and Sub-Milestone 3.4 into an integrated, production-grade business service layer handling fleet partner driver recruitment, multi-partner affiliations, vehicle assignment scheduling, explicit shift lifecycle execution (Option A), and multi-tiered shift cancellation rules.

All implementations strictly adhere to:
1. **Option A Shift Execution:** Shifts are **never** automatically activated by scheduled start times alone; drivers must explicitly activate shifts via `startAssignment`.
2. **7-Day Asia/Kolkata Calendar Semantics:** Invitations expire exactly after 7 calendar days calculated from midnight Asia/Kolkata time.
3. **Fail-Closed KYC & Licence Endorsement Policy:** Vehicle assignment enforces driving licence endorsement compatibility (e.g. `MCWG` for Two-Wheelers, `LMV`/`TRANS` for Light Commercial Vehicles/Tata Ace, `HMV` for Canter 14FT) and unexpired mandatory documents before scheduling.
4. **PostgreSQL GiST Exclusion & Concurrency Protection:** Advisory pre-checks coupled with PostgreSQL GiST exclusion constraints (`ex_no_overlapping_driver_assignments`, `ex_no_overlapping_vehicle_assignments`) guarantee zero overlapping shifts at the database engine level, rejecting concurrent race conditions with code `23P01` mapped to `ConflictError`.
5. **Strict Scope Discipline:** Zero database migrations or schema modifications were introduced (Migration 014 proved 100% sufficient). No HTTP controllers, routes, or administrative approval workflows were introduced, preserving clean boundaries for Batch 2 (Milestone 3.5) and Milestone 4.

---

## 2. File Inventory

### A. New Business Services (`src/modules/drivers/services/`)
1. **`driver-invitation.service.ts`** (Sub-Milestone 3.3)
   - Partner fleet driver invitation lifecycle.
   - Secure high-entropy token generation (`crypto.randomBytes(32).toString('hex')`).
   - 7-day Asia/Kolkata calendar-day expiration via `DateUtil.addDays`.
   - Idempotent recipient matching with mobile number verification.
   - Automatic `DRAFT` profile creation & `DRIVER` role assignment preserving existing `CUSTOMER` roles.
   - Partner fleet invitation revocation with audit reason.
2. **`driver-affiliation.service.ts`** (Sub-Milestone 3.3)
   - Multi-partner affiliation lifecycle management.
   - Support for concurrent active affiliations with distinct partner fleets.
   - Strict partner tenant isolation and ownership authorization.
   - Safe affiliation termination with mandatory reason and historical record preservation.
3. **`driver-assignment.service.ts`** (Sub-Milestone 3.4)
   - Shift assignment scheduling with partner ownership verification.
   - Licence endorsement compatibility checking via `DriverKycValidationService`.
   - Driver document expiry gatekeeper.
   - Advisory overlap pre-checks + atomic PostgreSQL GiST conflict handling.
   - Explicit Option A shift start with 60-minute tolerance window.
   - Active shift execution, driver duty availability tracking (`ON_DUTY` / `isBusy`).
   - Shift completion with odometer notes and availability reset.
   - 2-hour shift cancellation policy matrix.
   - Telemetry heartbeat tracking preventing ghost reactivations.

### B. Module Index Updates (`src/modules/drivers/`)
1. **`index.ts`**
   - Exported all new services, repositories, and interfaces (`DriverInvitationService`, `driverInvitationService`, `DriverAffiliationService`, `driverAffiliationService`, `DriverAssignmentService`, `driverAssignmentService`).
2. **`services/driver-kyc.service.ts`**
   - Instantiated repositories into `driverKycValidationService` singleton for full automated validation capabilities.

### C. Test Suite (`tests/`)
1. **`tests/phase6d-batch1-services.test.ts`** (30 test cases across 6 sections, 100% pass rate)
   - Section 1: Driver Invitation Lifecycle & Security (9 tests).
   - Section 2: Multi-Partner Affiliation Lifecycle & Tenant Isolation (4 tests).
   - Section 3: Assignment Scheduling & Licence Policy Enforcement (7 tests).
   - Section 4: Shift Lifecycle: Explicit Start (Option A) & Completion (6 tests).
   - Section 5: Shift Cancellation Rules Matrix (3 tests).
   - Section 6: PostgreSQL Kernel Concurrency: Simultaneous Overlap Exclusions (1 test).

---

## 3. Detailed Component Architecture

### 3.1 Driver Invitation Service (`DriverInvitationService`)
- **Fleet Partner Validation:** Verifies the inviter possesses an `APPROVED` partner profile that is not suspended.
- **Deduplication:** Prevents multiple active `PENDING` invitations to the same mobile number within the same partner fleet.
- **Multi-Fleet Invites:** Permits different partner fleets to concurrently invite the same driver mobile number without cross-partner interference.
- **Asia/Kolkata Expiry Semantics:** Computes expiration as `DateUtil.getEndOfDay(DateUtil.addDays(now, 7))` in `Asia/Kolkata` timezone.
- **Secure Token Retrieval:** Public invitation lookup by token sanitizes internal IDs and returns business metadata (`partnerBusinessName`, `invitedMobile`, `expiresAt`) without leaking internal secrets.
- **Atomic Acceptance Flow:**
  - Validates that the accepting authenticated user's mobile number strictly matches `invitedMobile` (rejecting unauthorized callers with `ForbiddenError`).
  - Verifies invitation status is `PENDING` and unexpired.
  - In a single transactional boundary (`prisma.$transaction`):
    - Upserts/retrieves the `DriverProfile` in `DRAFT` status (never auto-approving unverified drivers).
    - Assigns `DRIVER` role to the user while preserving `CUSTOMER` and other existing roles.
    - Creates an active `DriverPartnerAffiliation`.
    - Atomically transitions invitation status to `ACCEPTED`.
- **Revocation:** Partner fleet owner can revoke pending invitations with an audit reason.

### 3.2 Driver Affiliation Service (`DriverAffiliationService`)
- **Multi-Owner Architecture:** In compliance with Indian commercial logistics marketplace norms, drivers can maintain concurrent active affiliations with multiple independent fleet operators (e.g., driving for Partner A on weekday mornings and Partner B on weekends).
- **Tenant Isolation:** Fleet partners can only view, query, or terminate affiliations belonging to their own fleet. Cross-partner access throws `ForbiddenError`.
- **Termination Lifecycle:** Calling `terminateAffiliation` terminates the active record (`affiliationStatus = 'TERMINATED'`) with a timestamp and audit reason while preserving historical rows for reporting and audit compliance.

### 3.3 Driver Assignment & Shift Lifecycle Service (`DriverAssignmentService`)
- **Shift Scheduling Requirements:**
  - **Vehicle Ownership Check:** Partner must hold an `ACTIVE` relationship with the vehicle in `partner_vehicles`.
  - **Driver Affiliation Check:** Driver must hold an `ACTIVE` affiliation with the partner fleet.
  - **Driver Approval Check:** Driver profile must be in `APPROVED` status and not suspended.
  - **Licence Endorsement Compatibility:** Invokes `driverKycValidationService.isLicenceEligibleForVehicleClass`:
    - `TWO_WHEELER` requires `MCWG` (or commercial transport).
    - `TATA_ACE` / `PICKUP_8FT` requires `LMV` or `TRANS`.
    - `CANTER_14FT` requires `HMV` or `TRANS`.
  - **Document Expiry Gate:** Confirms mandatory documents (Driving Licence, Profile Photo, Identity Proof) have not expired as per Asia/Kolkata calendar semantics.
  - **Time Window Rules:** `startTime` must be strictly before `endTime`, and cannot be in the past (> 5 minutes ago).
  - **Advisory Overlap Pre-Check & Database Protection:** Performs index-assisted count queries for fast rejection; backs it up with PostgreSQL GiST exclusion constraint (`[startTime, endTime) WITH &&`) to completely prevent race conditions.
- **Option A Shift Execution (`startAssignment`):**
  - Shift activation is explicit and initiated by the assigned driver.
  - **Tolerance Window:** Rejects start attempts more than 60 minutes before scheduled start time (`startTime - 60m`). Rejects starts after scheduled `endTime`.
  - **Single Active Shift Invariant:** Checks `DriverAvailability`. If the driver is already `ON_DUTY` (`isBusy = true`), starting a second shift is rejected with `ConflictError`.
  - **Atomic Activation:** Transitions assignment to `ACTIVE`, records `actualStartTime`, and upserts driver availability to `isOnline = true`, `isBusy = true`, `currentAssignmentId = assignment.id`.
- **Shift Completion (`completeAssignment`):**
  - Drivers complete their own active shifts, supplying optional completion notes (e.g. final odometer reading).
  - Transitions assignment to `COMPLETED`, records `actualEndTime`, and resets availability (`isBusy = false`, `currentAssignmentId = null`).
- **Telemetry Heartbeat (`updateHeartbeat`):**
  - Updates availability timestamp and location coordinates.
  - Fail-safe: Heartbeats never reactivate or overwrite completed or cancelled assignments.

### 3.4 Shift Cancellation Rules Matrix
| Scenario | Initiator | Timing Window | Outcome |
| :--- | :--- | :--- | :--- |
| Scheduled Shift | Driver | >= 2 hours before `startTime` | **Permitted.** Driver self-cancels; assignment marked `CANCELLED`. |
| Scheduled Shift | Driver | < 2 hours before `startTime` | **Blocked.** Late cancellation requires partner fleet owner approval (`ValidationError`). |
| Scheduled Shift | Partner | Anytime before `actualStartTime` | **Permitted.** Partner owner cancels with reason. |
| Active Shift | Driver | After `actualStartTime` | **Blocked.** Driver cannot unilaterally abandon an active shift (`ValidationError`). |
| Active Shift | Partner | After `actualStartTime` | **Permitted with Cause.** Fleet owner terminates active shift (e.g. mechanical breakdown relief); records `actualEndTime` and `cancelledBy`. |

---

## 4. PostgreSQL GiST Concurrency & Database Integrity

PostgreSQL exclusion constraints created in Migration 014 were subjected to live multi-threaded concurrent requests:
1. **`ex_no_overlapping_driver_assignments`**:
   ```sql
   EXCLUDE USING gist (
       driver_id WITH =,
       tstzrange(start_time, COALESCE(end_time, 'infinity'::timestamptz), '[)') WITH &&
   ) WHERE (assignment_status IN ('SCHEDULED', 'ACTIVE'));
   ```
2. **`ex_no_overlapping_vehicle_assignments`**:
   ```sql
   EXCLUDE USING gist (
       vehicle_id WITH =,
       tstzrange(start_time, COALESCE(end_time, 'infinity'::timestamptz), '[)') WITH &&
   ) WHERE (assignment_status IN ('SCHEDULED', 'ACTIVE'));
   ```

### Live Concurrency Verification
When two simultaneous `scheduleAssignment` requests target overlapping time windows for the same driver or vehicle, PostgreSQL's kernel permits exactly one transaction and raises error code `23P01` (`exclusion_violation`) for the other. The repository and service error mapper intercepts `23P01` and cleanly translates it to an application-level `ConflictError(409)` with human-readable diagnostic messages.

---

## 5. Verification & Test Execution Results

### A. Phase 6D Batch 1 Test Suite
```bash
npx jest tests/phase6d-batch1-services.test.ts --runInBand
```
- **Test Suites:** 1 passed, 1 total
- **Tests:** 30 passed, 30 total
- **Snapshots:** 0 total
- **Execution Time:** ~3.4s

### B. All Phase 6D Test Suites
```bash
npx jest phase6d --runInBand
```
- `tests/phase6d-batch1-services.test.ts`: 30 passed
- `tests/phase6d-driver-kyc.test.ts`: 38 passed
- `tests/phase6d-driver-onboarding.test.ts`: 31 passed
- `tests/phase6d-driver-repositories.test.ts`: 40 passed
- `tests/phase6d-database-integrity.test.ts`: 12 passed
- **Total Phase 6D Tests:** **151 passed, 151 total (100% pass rate)**

### C. Full Project Regression Suite
```bash
npm test -- --runInBand
```
- `tests/phase6c.test.ts`: 30 passed
- `tests/phase6d-batch1-services.test.ts`: 30 passed
- `tests/phase6d-driver-kyc.test.ts`: 38 passed
- `tests/phase6d-driver-onboarding.test.ts`: 31 passed
- `tests/phase6d-database-integrity.test.ts`: 12 passed
- `tests/phase6d-driver-repositories.test.ts`: 40 passed
- `tests/phase6b.test.ts`: 35 passed
- `tests/phase6a.test.ts`: 21 passed
- `tests/phase6.test.ts`: 31 passed
- `tests/phase5.test.ts`: 18 passed
- `tests/health.test.ts`: 2 passed
- `tests/error-handling.test.ts`: 2 passed
- `tests/env.test.ts`: 3 passed
- **Total Suites:** **13 passed, 13 total**
- **Total Tests:** **301 passed, 301 total (100% pass rate, 0 regressions)**

### D. TypeScript Production Build & Prisma Validation
- `npm run build` (`tsc`): **Exit Code 0, Zero type errors.**
- `npx prisma validate`: **Schema is valid.**

---

## 6. Scope Compliance Confirmation

- **Sub-Milestones Implemented:** 3.3 and 3.4 completed in a single coordinated batch.
- **Database Schema & Migrations:** Zero modifications (existing Migration 014 was unmodified and preserved).
- **HTTP Layer:** No HTTP controllers, routes, or express bindings created (reserved for Milestone 4).
- **Admin Verification Layer:** No admin approval workflows created (reserved for Milestone 3.5 / Batch 2).
- **Status:** Complete, tested, and awaiting user review.

