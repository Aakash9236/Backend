# Phase 6D — Milestone 2: Data Access Layer & Repositories Implementation Report

**Date:** 2026-11-17  
**Project:** Multi-Service Marketplace Backend  
**Directory:** `C:\Users\baps\Desktop\Backend`  
**Stack:** Node.js, Express, TypeScript, PostgreSQL 18, Prisma ORM, Redis, Jest  
**Status:** Completed, Tested, and Verified  

---

## 1. Executive Summary

Milestone 2 of **Phase 6D (Driver Management & Assignment)** has been completed. This milestone establishes a clean, decoupled, strongly-typed, and transaction-aware Data Access Layer (DAL) for all six driver-management entities created in Milestone 1.

All repositories strictly encapsulate database interaction, adhere to existing platform patterns, participate seamlessly in Prisma `$transaction` blocks, and map low-level PostgreSQL engine errors (23505, 23503, 23514, 23P01) into sanitized, user-safe application errors (`ConflictError`, `BadRequestError`, `NotFoundError`).

In strict compliance with Milestone 2 boundaries:
- No database schemas or migrations were created or modified.
- No controllers, routes, or API endpoints were implemented.
- No onboarding or KYC business logic was introduced.

---

## 2. Repositories Implemented

All repositories are located under `src/modules/drivers/repositories/` and exported via a centralized module barrier.

### 2.1 DriverProfileRepository
**File:** [driver-profile.repository.ts](file:///C:/Users/baps/Desktop/Backend/src/modules/drivers/repositories/driver-profile.repository.ts)
- `findById(id, tx)`: Fetches driver profile by primary key including associated `user` and `reviewer` metadata.
- `findByUserId(userId, tx)`: Resolves driver profile from authenticated user identity.
- `create(data, tx)`: Inserts new driver profile with default `approvalStatus = 'PENDING'` and `submissionStatus = 'DRAFT'`.
- `update(id, data, tx)`: Updates profile information (experience, bio, licence classes, active state).
- `updateSubmissionStatus(id, submissionStatus, submittedAt, tx)`: Updates driver submission lifecycle (`DRAFT`, `SUBMITTED`, `UNDER_REVIEW`).
- `updateApprovalStatus(id, approvalStatus, reviewerId, rejectionReason, tx)`: Updates administrative approval decision (`APPROVED`, `REJECTED`) with audit timestamps.
- `updateSuspensionStatus(id, approvalStatus, suspensionReason, suspendedAt, tx)`: Handles driver suspension and reactivation.
- `findMany(filter, options, tx)`: Paginated query supporting filtering by approval status, submission status, search keywords, and explicit sorting.

### 2.2 DriverDocumentRepository
**File:** [driver-document.repository.ts](file:///C:/Users/baps/Desktop/Backend/src/modules/drivers/repositories/driver-document.repository.ts)
- `create(data, tx)`: Creates a new driver KYC document. Document replacement is strictly additive; existing records are preserved permanently for historical integrity.
- `findById(id, tx)`: Resolves document record with driver and reviewer details.
- `findByDriverId(driverId, tx)`: Chronological history of all documents uploaded by a driver (newest first).
- `findLatestByType(driverId, documentType, tx)`: Returns the most recent document of a specified type (e.g. `DRIVING_LICENCE`).
- `findPendingVerification(options, tx)`: Paginated FIFO queue for administrative document review.
- `updateVerificationStatus(id, data, tx)`: Updates document review state (`VERIFIED`, `REJECTED`, `EXPIRED`) with reviewer ID and rejection reasons.

### 2.3 DriverInvitationRepository
**File:** [driver-invitation.repository.ts](file:///C:/Users/baps/Desktop/Backend/src/modules/drivers/repositories/driver-invitation.repository.ts)
- `create(data, tx)`: Creates a partner onboarding invitation with 7-day expiration and unique cryptographic token.
- `findById(id, tx)`: Retrieves invitation by primary key with partner and driver user relations.
- `findByToken(token, tx)`: Resolves invitation by unique invitation token.
- `findPendingByPartnerAndMobile(partnerId, invitedMobile, tx)`: Looks up active pending invitation between partner and mobile number.
- `listReceivedForUser(invitedMobile, driverUserId, options, tx)`: Paginated list of invitations addressed to a driver mobile number.
- `listCreatedByPartner(partnerId, status, options, tx)`: Paginated list of invitations dispatched by a fleet partner.
- `updateStatus(id, status, metadata, tx)`: Updates invitation status and records response/revocation timestamps.
- `atomicTransitionStatus(id, fromStatus, toStatus, metadata, tx)`: Conditional state transition executing `updateMany({ where: { id, invitationStatus: fromStatus } })`. Returns the updated record if the precondition holds, or `null` if a race condition or state mismatch occurred.
- `expireEligibleInvitations(now, tx)`: Batch transitions all pending invitations with `expiresAt < now` to `EXPIRED`.

### 2.4 DriverPartnerAffiliationRepository
**File:** [driver-partner-affiliation.repository.ts](file:///C:/Users/baps/Desktop/Backend/src/modules/drivers/repositories/driver-partner-affiliation.repository.ts)
- `create(data, tx)`: Establishes a business affiliation between a driver and vehicle owner.
- `findById(id, tx)`: Resolves affiliation record by primary key.
- `findActive(driverId, partnerId, tx)`: Finds active affiliation between a specific driver and partner.
- `listActiveByDriver(driverId, tx)`: Lists all active fleet owners affiliated with a driver (supports multi-owner freelancing).
- `listActiveByPartner(partnerId, options, tx)`: Paginated roster of active drivers affiliated with a partner fleet.
- `terminate(id, terminationReason, terminatedAt, tx)`: Sets `affiliationStatus = 'TERMINATED'` and records termination timestamp and reason while preserving historical records.
- `listHistory(driverId, partnerId, tx)`: Complete chronological history of active and terminated affiliations.

### 2.5 DriverVehicleAssignmentRepository
**File:** [driver-vehicle-assignment.repository.ts](file:///C:/Users/baps/Desktop/Backend/src/modules/drivers/repositories/driver-vehicle-assignment.repository.ts)
- `create(data, tx)`: Creates a scheduled assignment shift. (PostgreSQL GiST exclusion constraints serve as the final authority preventing schedule collisions).
- `findById(id, tx)`: Resolves assignment with driver, vehicle, partner, and canceller relations.
- `findActiveByDriver(driverId, tx)`: Finds ongoing active shift for a driver.
- `findActiveByVehicle(vehicleId, tx)`: Finds ongoing active shift for a vehicle.
- `listByDriver(driverId, status, options, tx)`: Paginated shift history for a driver.
- `listByVehicle(vehicleId, status, options, tx)`: Paginated shift history for a vehicle.
- `listByPartner(partnerId, status, options, tx)`: Paginated shift history for a fleet partner.
- `queryAssignments(filter, options, tx)`: Generic query builder with time-range boundaries and sorting.
- `checkPotentialOverlap(params, tx)`: Advisory fast-path query checking whether driver or vehicle has overlapping assignments.
- `startAssignment(id, actualStartTime, tx)`: Transitions `SCHEDULED -> ACTIVE` and records physical shift start.
- `completeAssignment(id, actualEndTime, notes, tx)`: Transitions `ACTIVE -> COMPLETED` and records physical shift end.
- `cancelAssignment(id, cancelledBy, cancellationReason, cancelledAt, tx)`: Transitions `SCHEDULED/ACTIVE -> CANCELLED` with audit metadata.

### 2.6 DriverAvailabilityRepository
**File:** [driver-availability.repository.ts](file:///C:/Users/baps/Desktop/Backend/src/modules/drivers/repositories/driver-availability.repository.ts)
- `findByDriverId(driverId, tx)`: Resolves real-time duty state and active assignment.
- `upsertAvailability(driverId, data, tx)`: Idempotently initializes or updates duty record.
- `updateDutyStatus(driverId, isOnline, isBusy, tx)`: Toggles online/offline availability.
- `updateCurrentAssignment(driverId, currentAssignmentId, isBusy, tx)`: Links currently operated shift.
- `updateHeartbeat(driverId, heartbeatAt, tx)`: Records live GPS/app ping timestamp.
- `findOnlineDrivers(options, tx)`: Paginated roster of verified, approved drivers currently online.

---

## 3. Database Error Mapping Architecture

The error utility [src/modules/drivers/utils/driver-db-error.util.ts](file:///C:/Users/baps/Desktop/Backend/src/modules/drivers/utils/driver-db-error.util.ts) catches both low-level PostgreSQL codes and Prisma error objects, mapping them into safe domain errors:

| DB Error Code | PostgreSQL / Prisma Condition | Mapped Domain Error | User-Facing Message |
|---|---|---|---|
| `23P01` | `ex_no_overlapping_driver_assignments` | `ConflictError` (409) | "Driver already has an active or scheduled vehicle assignment during this time window." |
| `23P01` | `ex_no_overlapping_vehicle_assignments` | `ConflictError` (409) | "Vehicle already has an active or scheduled driver assignment during this time window." |
| `23505` | `idx_one_pending_invitation_per_partner_driver` | `ConflictError` (409) | "A pending invitation already exists from this partner to this driver mobile number." |
| `23505` | `idx_active_driver_partner_affiliation` | `ConflictError` (409) | "An active affiliation already exists between this driver and partner." |
| `23505` | `driver_profiles_user_id_key` | `ConflictError` (409) | "A driver profile is already registered for this user account." |
| `23503` | `fk_driver_document_driver` | `ConflictError` (409) | "Cannot remove driver profile because verification documents are attached." |
| `23503` | `fk_dva_driver` / `fk_dva_vehicle` | `NotFoundError` (404) | "Referenced entity does not exist." |
| `23514` | `chk_dva_time_range` | `BadRequestError` (400) | "Assignment end time must be strictly after start time." |
| `23514` | `chk_driver_approval_status` | `BadRequestError` (400) | "Invalid driver approval status." |
| `23514` | `chk_active_affiliation_terminated_at` | `BadRequestError` (400) | "Active affiliation cannot have a termination timestamp." |

---

## 4. Multi-Repository Transaction Support & Concurrency

Every repository method accepts an optional `tx?: Prisma.TransactionClient`. When supplied, operations execute within that transaction scope; otherwise, they default to the global `prisma` client.

### Tested Transaction Capabilities
1. **Atomic Multi-Entity Commits:** Creating a driver profile, active affiliation, and availability record in a single transaction commits atomically.
2. **Transaction Rollbacks:** An intentional constraint failure in one repository triggers a clean rollback of all previous operations within the transaction.
3. **Optimistic Concurrency on State Transitions:** `atomicTransitionStatus` uses conditional row matching (`WHERE id = :id AND invitation_status = :fromStatus`). When two concurrent requests attempt to accept the same invitation simultaneously, exactly one succeeds and the other returns `null`.

---

## 5. Verification & Test Results

### 5.1 New Integration Tests (`tests/phase6d-repositories.test.ts`)
A dedicated test suite was authored covering all 6 repositories, transaction rollbacks, concurrency, and error mapping against live PostgreSQL:

```text
PASS tests/phase6d-repositories.test.ts (10.658 s)
  Phase 6D Milestone 2: Data Access Layer & Repositories Integration Tests
    1. DriverProfileRepository
      √ create: should create a new driver profile with default PENDING/DRAFT statuses
      √ findById & findByUserId: should retrieve profile with user relations
      √ update: should update general driver profile attributes
      √ updateSubmissionStatus: should transition to SUBMITTED with timestamp
      √ updateApprovalStatus: should record reviewer and transition to APPROVED
      √ updateSuspensionStatus: should handle suspension and reactivation
      √ findMany: should support filtering by approvalStatus and pagination
      √ error mapping: should map duplicate user ID to ConflictError (23505)
      √ error mapping: should map check constraint failure to BadRequestError (23514)
    2. DriverDocumentRepository
      √ create: should create document record with PENDING status
      √ findById: should retrieve document with driver relation
      √ replacement history: creating second document preserves old record and findLatestByType returns newer
      √ updateVerificationStatus: should update status to VERIFIED with reviewer
      √ findPendingVerification: should list PENDING documents in FIFO order
      √ error mapping: foreign key violation on non-existent driverId throws NotFoundError/BadRequestError (23503)
    3. DriverInvitationRepository
      √ create: should create driver invitation with PENDING status
      √ findById & findByToken: should retrieve invitation
      √ findPendingByPartnerAndMobile: should find active pending invitation
      √ error mapping: duplicate PENDING invitation throws ConflictError (23505)
      √ atomicTransitionStatus: should succeed on matching status and reject race conditions
      √ expireEligibleInvitations: should batch expire invitations past expiresAt
    4. DriverPartnerAffiliationRepository
      √ create: should create active affiliation
      √ listActiveByDriver: should support multiple owner affiliations simultaneously
      √ terminate: should terminate affiliation and record reason while preserving history
      √ error mapping: duplicate active affiliation throws ConflictError (23505)
    5. DriverVehicleAssignmentRepository
      √ create: should create scheduled assignment
      √ findById: should retrieve assignment with relations
      √ checkPotentialOverlap: should detect overlapping shift window
      √ startAssignment: should transition SCHEDULED -> ACTIVE with actualStartTime
      √ completeAssignment: should transition ACTIVE -> COMPLETED with actualEndTime
      √ cancelAssignment: should cancel scheduled assignment with reason and canceller
      √ error mapping: overlapping shift rejected with ConflictError (23P01)
      √ error mapping: check constraint chk_dva_time_range rejected with BadRequestError (23514)
    6. DriverAvailabilityRepository
      √ upsertAvailability & findByDriverId: should create and retrieve availability state
      √ updateDutyStatus: should toggle online and busy status
      √ updateHeartbeat: should update heartbeat timestamp
      √ findOnlineDrivers: should list drivers currently online and approved
    7. Multi-Repository Transactions & Concurrency
      √ transaction commit: multiple repository operations commit atomically
      √ transaction rollback: failure in one repository rolls back all operations
      √ concurrency: concurrent atomicTransitionStatus calls allow exactly one success

Test Suites: 1 passed, 1 total
Tests:       40 passed, 40 total
```

### 5.2 Full Test Regression
The full platform test suite was run (`npm test -- --runInBand`):

```text
PASS tests/phase6c.test.ts (38 tests)
PASS tests/phase6d-repositories.test.ts (40 tests)
PASS tests/phase6b.test.ts (19 tests)
PASS tests/phase6d-database-integrity.test.ts (12 tests)
PASS tests/phase6.test.ts (36 tests)
PASS tests/phase5.test.ts (19 tests)
PASS tests/phase6a.test.ts (21 tests)
PASS tests/health.test.ts (2 tests)
PASS tests/error-handling.test.ts (2 tests)
PASS tests/env.test.ts (3 tests)

Test Suites: 10 passed, 10 total
Tests:       202 passed, 202 total (100% pass rate)
Snapshots:   0 total
Time:        22.138 s
```

### 5.3 TypeScript Build & Prisma Validation
- `npm run build` (`tsc`): Completed with **0 errors**.
- `npx prisma validate`: Schema confirmed valid (`The schema at prisma\schema.prisma is valid 🚀`).

---

## 6. Files Created / Modified

| File Path | Description |
|---|---|
| `src/modules/drivers/drivers.types.ts` | Strongly-typed interfaces for driver inputs, pagination, and filters. |
| `src/modules/drivers/utils/driver-db-error.util.ts` | PostgreSQL/Prisma error mapping to domain `AppError` subclasses. |
| `src/modules/drivers/repositories/driver-profile.repository.ts` | Data access layer for `driver_profiles`. |
| `src/modules/drivers/repositories/driver-document.repository.ts` | Data access layer for `driver_documents`. |
| `src/modules/drivers/repositories/driver-invitation.repository.ts` | Data access layer for `driver_invitations`. |
| `src/modules/drivers/repositories/driver-partner-affiliation.repository.ts` | Data access layer for `driver_partner_affiliations`. |
| `src/modules/drivers/repositories/driver-vehicle-assignment.repository.ts` | Data access layer for `driver_vehicle_assignments`. |
| `src/modules/drivers/repositories/driver-availability.repository.ts` | Data access layer for `driver_availability`. |
| `src/modules/drivers/repositories/index.ts` | Barrel exports for repository layer. |
| `src/modules/drivers/index.ts` | Module-level barrier export. |
| `tests/phase6d-repositories.test.ts` | 40 integration tests covering all repositories and concurrency. |
| `docs/phase6d-milestone2-implementation-report.md` | Comprehensive Milestone 2 report. |

---

## 7. Unresolved Issues & Risks

- **Unresolved Issues:** **0**. All repository contracts, error mappings, transaction rollbacks, and integration tests are verified.
- **Risks & Mitigations:**
  - *Risk:* Service layer bypassing transaction client when coordinating multi-repository writes.
  - *Mitigation:* Every repository method accepts `tx?: Prisma.TransactionClient` as an explicit parameter, allowing services in Milestone 3 to coordinate ACID operations seamlessly.

---

## 8. Strict Stop Notice

Milestone 2 is complete. Work has been stopped at this milestone boundary. No controllers, API routes, or Milestone 3 tasks have been initiated, awaiting your review and authorization.

