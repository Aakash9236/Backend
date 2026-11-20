# Phase 6E — Batch 3 Implementation Report: Worker Invitations, Affiliations & Availability Services

**Date:** 2026-11-20  
**Phase:** 6E — Worker Management  
**Batch:** 3 of 5 (Authorized Scope: Worker Invitations, Affiliations & Availability Services)  
**Status:** Complete & Fully Verified  

---

## 1. Executive Summary & Authorization Scope

In accordance with Phase 6E specifications, **Batch 3** has been implemented. This sub-milestone delivers the complete business service layer for:
1. **Worker-partner invitations** (`WorkerInvitationService`) with cryptographically secure token hashing, mobile normalization, 7-day Asia/Kolkata expiry, and explicit consent acceptance.
2. **Non-exclusive multi-partner affiliations** (`WorkerAffiliationService`) with unlimited simultaneous partner affiliations, tenant isolation, voluntary worker and partner terminations, and historical record preservation.
3. **Worker availability & dispatch locking** (`WorkerAvailabilityService`) with online/offline state enforcement, fail-closed KYC compliance gates, keep-alive heartbeats, stale worker detection, and atomic concurrency-safe dispatch locking.

### Strict Scope Discipline
- **Implemented in Batch 3:**
  - `WorkerInvitationService` in `src/modules/workers/services/worker-invitation.service.ts`.
  - `WorkerAffiliationService` in `src/modules/workers/services/worker-affiliation.service.ts`.
  - `WorkerAvailabilityService` in `src/modules/workers/services/worker-availability.service.ts`.
  - Service DTOs and API types in `src/modules/workers/workers.types.ts`.
  - Atomic repository methods (`incrementResendCount` with token rotation, `atomicAcquireLock`, `atomicReleaseLock`, safe `updateHeartbeat` create defaults) in `WorkerInvitationRepository` and `WorkerAvailabilityRepository`.
  - 55 comprehensive tests across 3 new test suites:
    - `tests/phase6e-worker-invitations.test.ts` (22 tests)
    - `tests/phase6e-worker-affiliations.test.ts` (15 tests)
    - `tests/phase6e-worker-availability.test.ts` (18 tests)
- **Deferred to Later Batches (Out of Scope for Batch 3):**
  - Batch 4: Worker Administrative Verification, Approval & Multi-Role Status Integration.
  - Batch 5: HTTP Controllers, Routes, Swagger/OpenAPI docs & Final Verification.

---

## 2. Architecture & Technical Design

### 2.1 Worker Invitation Service Architecture

```
+---------------------------------------------------------------------------------------+
|                                WorkerInvitationService                                |
+---------------------------------------------------------------------------------------+
        |                                       |                             |
        v                                       v                             v
[Partner Authorization]                [Token Cryptography]          [Atomic Acceptance & Audit]
 - must be APPROVED partner             - 32-byte crypto random       - target mobile match check
 - must not be suspended                - SHA-256 token hash only     - worker profile check (Rule 16)
 - normalizes target mobile             - raw token never in DB/logs  - no auto-approval (Rule 18)
 - checks pending duplicate             - 7-day Asia/Kolkata expiry   - atomic status transition
                                                                      - creates WorkerPartnerAffiliation
                                                                      - writes AuditLog in transaction
```

#### Key Rules & Security Invariants
1. **Partner Authorization & Eligibility:** Only approved, non-suspended service partners (`partner.approvalStatus === 'APPROVED'`) can dispatch invitations.
2. **Mobile Number Normalization:** Validates and formats numbers into the E.164 Indian standard (`+91XXXXXXXXXX`), accepting raw 10-digit, 91 prefix, and +91 formatted inputs.
3. **Multi-Partner Fan-Out:** Multiple independent service partners can invite the same mobile number simultaneously.
4. **Duplicate Prevention:** A partner cannot send duplicate `PENDING` invitations to the same mobile. If a stale invitation has expired in wall-clock time, it is atomically marked `EXPIRED` before creating a new one.
5. **Token Security & One-Time Delivery:**
   - Raw tokens are generated via `crypto.randomBytes(32).toString('hex')`.
   - Stored in PostgreSQL strictly as SHA-256 hashes (`crypto.createHash('sha256').update(rawToken).digest('hex')`).
   - Raw tokens are **never** logged or stored in the database.
   - Raw tokens are returned securely exactly once at creation or resend for delivery.
6. **Asia/Kolkata 7-Day Expiry:** Expiry is calculated using `DateUtil.getEndOfKolkataDay(now + 7 days)`, ending at `23:59:59.999 IST`.
7. **Pre-Existing Worker Profile Requirement (Rule 16):** An invited worker must have an existing `WorkerProfile` before accepting an invitation. Unregistered users receive a clear error directing them to complete onboarding.
8. **No Auto-Approval Invariant (Rule 18):** Invitation acceptance **never** automatically marks a worker profile as `APPROVED`. Profile status remains `PENDING` for administrative verification.
9. **Role Preservation:** Assigns the `WORKER` role to the user while preserving existing `CUSTOMER`, `PARTNER`, or other assigned roles.
10. **Resend & Token Rotation:** Resending an invitation extends expiry by 7 calendar days, generates a new raw token, stores the new SHA-256 hash, and increments `resendCount`.

---

### 2.2 Worker Affiliation Service Architecture

```
+---------------------------------------------------------------------------------------+
|                                WorkerAffiliationService                               |
+---------------------------------------------------------------------------------------+
        |                                       |                             |
        v                                       v                             v
[Non-Exclusive M:N Model]             [Tenant Isolation & Privacy]  [Termination & Audit Trails]
 - unlimited active affiliations       - worker views own affils      - voluntary worker termination
 - no arbitrary cap                    - partner views own workers    - partner termination + reason
 - partial index: 1 active per pair    - NO KYC access for partner    - historical record preservation
                                                                      - atomic AuditLog recording
```

#### Key Rules & Security Invariants
1. **Non-Exclusive Multi-Partner Model:** A worker can have unlimited simultaneous active affiliations across different partners. There is no artificial global limit.
2. **Uniqueness Authority:** Database partial unique index `idx_active_worker_partner_affiliation` (`UNIQUE (worker_id, partner_id) WHERE affiliation_status = 'ACTIVE'`) strictly prevents duplicate active affiliations between the same worker and the same partner.
3. **Independent Operation:** A worker can operate independently and receive direct customer bookings without any active partner affiliation.
4. **Tenant Isolation & Privacy Shield (Rule 6):**
   - Partners can only inspect workers affiliated with their own fleet.
   - Cross-partner lookups and terminations throw `ForbiddenError`.
   - Partners **cannot** access private worker documents, magic-byte buffers, or KYC storage keys through affiliation.
5. **Termination Lifecycle & Historical Preservation:**
   - Either the worker or the partner can terminate an affiliation.
   - Terminations transition status to `TERMINATED`, record `terminatedAt` and `terminationReason`, and preserve the record for compliance and reporting.
   - Partners must provide a recorded reason for termination.
   - Every termination atomically writes to `audit_logs`.

---

### 2.3 Worker Availability & Dispatch Lock Service Architecture

```
+---------------------------------------------------------------------------------------+
|                               WorkerAvailabilityService                               |
+---------------------------------------------------------------------------------------+
        |                                       |                             |
        v                                       v                             v
[Duty Status Eligibility]              [Keep-Alive Heartbeat]        [Atomic Dispatch Locking]
 - APPROVED status required             - updates lastHeartbeatAt     - atomic conditional update
 - unexpired KYC mandatory              - validates coordinates       - 120s auto-expiry TTL
 - suspended workers blocked            - offline workers STAY OFF    - token ownership validation
 - no partner affiliation needed        - stale if > 5 minutes        - prevents double allocations
```

#### Key Rules & State Machine
1. **Eligibility to Go Online:**
   - Worker profile must have `approvalStatus === 'APPROVED'`.
   - Worker profile must not be suspended (`suspendedAt` is null) and must be `isActive === true`.
   - **Fail-Closed KYC Gate:** `WorkerKycValidationService` verifies mandatory documents and required trade skills. If documents are expired or missing, going online is blocked (`ConflictError`).
   - Worker availability does **not** depend on having a partner affiliation (independent worker availability).
2. **Keep-Alive Heartbeat & Anti-Reactivation Guard (Rule 6):**
   - Online workers periodically ping `updateHeartbeat` with validated coordinates (-90 to 90 latitude, -180 to 180 longitude).
   - If an offline or suspended worker sends a heartbeat, the service **does not reactivate** them. The worker remains offline.
   - Suspended workers are rejected with `ForbiddenError`.
3. **Stale Worker Detection:**
   - Constant: `WORKER_HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000` (5 minutes).
   - Heartbeats older than 5 minutes are classified as stale (`isStale: true`).
   - Stale workers are excluded from operational dispatch eligibility (`isEligible: false`).
4. **Atomic Dispatch Locking Abstraction (Rules 8, 9, 10, 11):**
   - Prevents race conditions and double allocations during dispatch.
   - Atomic lock acquisition via conditional update:
     `UPDATE worker_availability SET is_busy = true WHERE worker_id = :id AND is_online = true AND is_busy = false`.
   - If update count is 0, lock acquisition fails immediately (`acquired: false`).
   - Lock TTL: Default 120 seconds (`DEFAULT_DISPATCH_LOCK_TTL_SECONDS = 120`). Prevents indefinite deadlocks if dispatch fails.
   - Token Ownership: Lock release requires the matching `lockId`. Mismatched or unauthorized release attempts throw `ForbiddenError`.

---

## 3. Test Suites & Verification Results

### 3.1 New Test Suites Authored for Batch 3 (55 Tests)

1. **`tests/phase6e-worker-invitations.test.ts` (22 Tests):**
   - **Partner Invitation Creation & Security (7 tests):**
     - Approved partner invites worker successfully.
     - Unapproved partner rejected (`ForbiddenError`).
     - Non-partner user rejected (`ForbiddenError`).
     - Duplicate pending invitation from same partner to same mobile rejected (`ConflictError`).
     - Multiple different partners can invite same mobile simultaneously.
     - Mobile number normalization & format validation.
     - 7 full calendar days Asia/Kolkata expiry calculation.
   - **Invitation Retrieval & Listing (4 tests):**
     - Partner lists own sent invitations.
     - Worker lists received invitations.
     - Public details lookup by raw token without authentication (no token hash leakage).
     - Tenant isolation on numeric ID lookup (`ForbiddenError` for other partners).
   - **Explicit Worker Acceptance (7 tests):**
     - Mobile mismatch rejection (`ForbiddenError`).
     - Rejection if worker has no worker profile (Rule 16, `BadRequestError`).
     - Successful acceptance, affiliation creation, and multi-role preservation (`CUSTOMER` + `WORKER`).
     - Rejection of auto-approval (profile `approvalStatus` remains `PENDING`, Rule 18).
     - Replayed acceptance rejection (`ConflictError`).
     - Expired invitation rejection (`BadRequestError`).
     - Revoked invitation rejection (`ConflictError`).
   - **Rejection, Revocation & Resend Lifecycle (4 tests):**
     - Explicit rejection by worker with recorded reason.
     - Revocation by partner with recorded reason.
     - Cross-partner revocation blocked (`ForbiddenError`).
     - Resend invitation: rotates raw token, updates token hash, extends 7-day Asia/Kolkata expiry, increments `resendCount`.
     - Batch expiry of past pending invitations.

2. **`tests/phase6e-worker-affiliations.test.ts` (15 Tests):**
   - **Non-Exclusive Multi-Partner Affiliations (4 tests):**
     - Active affiliation established with Partner 1.
     - Simultaneous active affiliation established with Partner 2.
     - Third simultaneous active affiliation established with Partner 3 (no arbitrary cap).
     - Duplicate active affiliation between same worker and same partner rejected (`ConflictError`).
   - **Listing & Tenant Isolation (3 tests):**
     - Partner lists only own affiliated workers.
     - Worker inspects own affiliation details.
     - Partner blocked from inspecting other partner's affiliated workers (IDOR block).
   - **Voluntary Termination by Worker (3 tests):**
     - Worker voluntarily terminates affiliation with reason.
     - Termination preserves historical record in DB.
     - Re-termination of already terminated affiliation rejected (`ConflictError`).
     - Unauthorized worker termination blocked.
   - **Termination by Partner (2 tests):**
     - Partner terminates affiliation with recorded reason and audit log.
     - Cross-partner termination blocked (`ForbiddenError`).
   - **Affiliation History Inspection (3 tests):**
     - Affiliated worker can view complete history.
     - Affiliated partner can view complete history.
     - Third-party user blocked from inspecting history (`ForbiddenError`).

3. **`tests/phase6e-worker-availability.test.ts` (18 Tests):**
   - **Going Online / Offline Eligibility (9 tests):**
     - Approved, KYC-compliant worker goes online with coordinates.
     - Rejection of out-of-range latitude (> 90 or < -90) with `BadRequestError`.
     - Rejection of out-of-range longitude (> 180 or < -180) with `BadRequestError`.
     - Unapproved worker cannot go online (`ConflictError`).
     - Suspended worker cannot go online (`ForbiddenError`).
     - Expired KYC document blocks worker from going online (`ConflictError`).
     - Independent worker without partner affiliation goes online successfully.
     - Worker goes offline successfully.
     - Rejection of going offline while worker is busy (`ConflictError`).
   - **Heartbeat & Keep-Alive Behavior (4 tests):**
     - Online worker updates heartbeat and coordinates.
     - Offline worker stays offline upon heartbeat (no silent reactivation, Rule 6).
     - Suspended worker heartbeat rejected (`ForbiddenError`).
     - Stale heartbeat detection (> 5 minutes).
   - **Operational Availability & Dispatch Locking (5 tests):**
     - Reports operational and eligible for dispatch when online, free, fresh, and compliant.
     - Reports ineligible when heartbeat is stale (> 5 minutes).
     - Atomically acquires dispatch lock and marks `isBusy: true`.
     - Prevents conflicting concurrent lock acquisition (only 1 process acquires, 2nd rejected).
     - Rejection of dispatch lock release with mismatched token (`ForbiddenError`).

---

### 3.2 Verification Results Summary

| Suite Category | Suites | Tests | Passed | Failed | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Phase 6E Batch 3 (Invitations, Affiliations, Availability)** | **3** | **55** | **55** | **0** | **PASS** |
| Phase 6E Batch 2 (KYC & Onboarding) | 2 | 61 | 61 | 0 | **PASS** |
| Phase 6E Batch 1 (Database & Repositories) | 1 | 46 | 46 | 0 | **PASS** |
| **Total Phase 6E Tests** | **6** | **162** | **162** | **0** | **PASS** |
| **Phase 6D Driver Management Regression Suites** | **7** | **220** | **220** | **0** | **PASS** |
| **Full Project Regression Test Suite (Baseline + Phase 6E)** | **21** | **532** | **532** | **0** | **PASS** |

### 3.3 Baseline Comparison

| Milestone / Suite | Previous Baseline | Batch 3 Baseline | Change |
| :--- | :---: | :---: | :---: |
| Phase 6E Total Tests | 107 | **162** | +55 tests |
| Phase 6D Total Tests | 220 | **220** | 0 (No regressions) |
| Full Backend Test Suite | 477 | **532** | +55 tests |
| Test Suites Count | 18 | **21** | +3 suites |
| Failed Tests | 0 | **0** | 0 |

- **Zero tests were removed, renamed, or modified from previous milestones.**
- **Zero schema migrations were needed** (Migration 015 completely satisfied all Batch 3 database requirements).

### 3.4 Build & Schema Validation
- `npm run build` (`tsc`): Executed with exit code `0` (Zero TypeScript compile errors).
- `npx prisma validate`: Prisma schema at `prisma/schema.prisma` is valid and in sync.

---

## 4. Deliverables & Modified Files

```
Backend/
├── src/
│   └── modules/
│       └── workers/
│           ├── index.ts                                         # Exported services & types
│           ├── workers.types.ts                                 # Added invitation, affiliation, availability & dispatch lock DTOs
│           ├── repositories/
│           │   ├── worker-invitation.repository.ts              # Extended incrementResendCount with token rotation
│           │   └── worker-availability.repository.ts            # Added atomicAcquireLock, atomicReleaseLock, safe heartbeat defaults
│           └── services/
│               ├── worker-invitation.service.ts                 # [NEW] Worker invitation service
│               ├── worker-affiliation.service.ts                # [NEW] Multi-partner affiliation service
│               └── worker-availability.service.ts               # [NEW] Worker availability & dispatch lock service
├── tests/
│   ├── phase6e-worker-invitations.test.ts                       # [NEW] 22 tests for Worker Invitations
│   ├── phase6e-worker-affiliations.test.ts                      # [NEW] 15 tests for Worker Affiliations
│   └── phase6e-worker-availability.test.ts                      # [NEW] 18 tests for Worker Availability & Locks
└── docs/
    └── phase6e-batch3-invitations-affiliations-availability-report.md # [NEW] Batch 3 deliverable report
```

---

## 5. Known Limitations & Handoff to Batch 4

1. **HTTP Controllers & Routes:** HTTP controllers, request validators, and routes for invitations, affiliations, and availability are not part of Batch 3 and will be authored in Batch 5.
2. **Administrative Approval:** Administrative worker verification, document rejection, suspension, and role status synchronization will be implemented in **Batch 4: Worker Administrative Verification, Approval & Multi-Role Status Integration**.
3. **Dispatch & Booking Engine:** The availability service provides the atomic locking abstraction (`setDispatchLock` / `releaseDispatchLock`); actual booking assignment pipelines belong to Phase 7 dispatch workflows.

Phase 6E Batch 3 is complete, verified, and ready for authorization to proceed to **Phase 6E, Batch 4**.
