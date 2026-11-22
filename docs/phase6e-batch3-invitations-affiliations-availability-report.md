# Phase 6E — Batch 3: Worker Invitations, Affiliations & Availability Services Report

## Executive Summary

Phase 6E Batch 3 implements the enterprise business services powering worker lifecycle integration:
1. **Worker-Partner Invitations Service** (`WorkerInvitationService`): Cryptographically secure invitation flows with normalized mobile targeting, strict tenant isolation, 7-day Asia/Kolkata expiry semantics, token hashing, and explicit worker consent.
2. **Worker-Partner Affiliation Service** (`WorkerAffiliationService`): Non-exclusive, multi-partner affiliations allowing service workers to be associated with multiple partner fleets concurrently without artificial restrictions, while enforcing strict IDOR protection, voluntary termination, partner-initiated termination requiring mandatory audit reasons, and full historical preservation.
3. **Worker Availability & Heartbeat Service** (`WorkerAvailabilityService`): Real-time availability lifecycle state machine with coordinates validation, fail-closed eligibility enforcement (preventing unapproved, suspended, or KYC-expired workers from going online), independent worker availability support (requiring zero partner affiliations to work independently), heartbeat processing without silent reactivation, and distributed atomic dispatch locking with Redis NX PX and robust in-process fallback.

All business services have been authored, unit tested, integrated, and validated against PostgreSQL and Jest. **All 20 test suites in the repository passed (519 tests total, 0 failed).**

---

## 1. Architectural Architecture & File Manifest

### New Services Implemented
| Service Path | Class / Responsibilities |
|---|---|
| `src/modules/workers/services/worker-invitation.service.ts` | `WorkerInvitationService`: Invitation creation, mobile normalization, cryptographic token generation (SHA-256 in DB), 7-day Asia/Kolkata expiry, listing, details inspection, atomic acceptance, rejection, partner revocation, resend with token rotation, and batch expiration sweep. |
| `src/modules/workers/services/worker-affiliation.service.ts` | `WorkerAffiliationService`: Non-exclusive multi-partner affiliation management, worker affiliation roster, partner affiliated workers listing, document-concealing detail inspection, voluntary worker termination, partner termination with mandatory justification, and historical tracking. |
| `src/modules/workers/services/worker-availability.service.ts` | `WorkerAvailabilityService`: Online/offline state machine, geographic coordinate bounds validation (-90..90, -180..180), KYC compliance gate integration, independent worker availability, non-reactivating heartbeat updates, dispatch readiness calculation (`ONLINE_AVAILABLE`, `BUSY`, `STALE_OFFLINE`, `OFFLINE`), and atomic dispatch lock concurrency. |

### Extended Repositories
| Repository Path | Added Capabilities |
|---|---|
| `src/modules/workers/repositories/worker-invitation.repository.ts` | Added `findByToken(rawToken: string, tx?)` which computes SHA-256 hash internally before querying PostgreSQL via `invitationTokenHash`. |
| `src/modules/workers/repositories/worker-partner-affiliation.repository.ts` | Added `listByPartner(partnerId: bigint, status?: string, options?: PaginationOptions, tx?)` with relation loading for worker profile and user metadata. |

### Module Exports
- `src/modules/workers/index.ts` re-exports all three services and their singleton instances (`workerInvitationService`, `workerAffiliationService`, `workerAvailabilityService`).

### Test Suites
| Test File | Test Count | Scope |
|---|---|---|
| `tests/phase6e-batch3-invitations-affiliations.test.ts` | 31 passed | Partner eligibility checks, mobile normalization, cryptographic token isolation, multi-partner concurrency, pending duplication prevention, tenant isolation, atomic acceptance, prerequisite profile enforcement, rejection, partner revocation, resending, batch expiry sweep, multi-partner affiliations, voluntary/partner termination, and historical re-affiliation. |
| `tests/phase6e-batch3-availability.test.ts` | 20 passed | Default offline retrieval, unapproved guard, suspended guard, KYC expired document guard, coordinate validation, independent worker availability, approved worker toggle, heartbeat without silent reactivation, operational readiness status matrix (5-minute stale timeout), and atomic dispatch locks with TTL & owner release verification. |

---

## 2. In-Depth Service Breakdown & Business Rules

### 2.1 WorkerInvitationService

#### Invitation Rules & Enforcement
1. **Authorized Partner Only**: Only an authorized user possessing a `PartnerProfile` with `approvalStatus === 'APPROVED'` and related `User.accountStatus === 'ACTIVE'` can issue invitations (`ForbiddenError` thrown otherwise).
2. **Mobile Normalization**: Target mobile numbers are normalized to E.164 standard (`+91XXXXXXXXXX`). Invalid 10-digit formats or malformed non-Indian phone strings fail closed with `BadRequestError`.
3. **Multi-Partner Independence**: Multiple distinct partner fleets can independently send invitations to the identical worker mobile number simultaneously.
4. **Duplicate Prevention**: If a partner already has a `PENDING` invitation for the target mobile that has not expired, creating a second invitation is rejected with `ConflictError`. If the existing pending invitation is past its expiration date, it is marked `EXPIRED` in place and a fresh invitation is allowed.
5. **Cryptographic Token Security**:
   - Invitation tokens are generated via `crypto.randomBytes(32).toString('hex')` (unguessable 64-character token).
   - Only the SHA-256 digest (`crypto.createHash('sha256').update(rawToken).digest('hex')`) is stored in PostgreSQL column `invitation_token_hash`.
   - Raw tokens are never logged and never stored in the database.
   - Raw tokens are returned to the caller only once during `createInvitation` and `resendInvitation` for SMS/communication delivery.
6. **Asia/Kolkata Calendar Expiry**: Expiry is set to exactly 7 full calendar days at the end of day in `Asia/Kolkata` (23:59:59.999 IST) using `DateUtil.getEndOfKolkataDay(futureDate)`.
7. **Explicit Worker Consent & Mobile Verification**:
   - Accepting an invitation requires the authenticated worker's mobile number to exactly match `invitation.invitedMobile`.
   - Mismatched users are strictly rejected with `ForbiddenError`.
8. **Worker Profile Prerequisite**:
   - A worker user must complete registration and possess an existing `WorkerProfile` before accepting an invitation (`NotFoundError` thrown otherwise).
9. **Atomic Acceptance & Affiliation Creation**:
   - Executed inside a PostgreSQL transaction (`prisma.$transaction`).
   - Updates invitation status to `ACCEPTED` and populates `respondedAt`.
   - Creates a new active row in `worker_partner_affiliations` with `affiliation_status: 'ACTIVE'`, `consent_given_at: now`, and `affiliated_at: now`.
   - Writes an immutable entry into `audit_logs` (`WORKER_INVITATION_ACCEPTED`).
10. **Replay & Invalidation Protection**:
    - Replaying acceptance on an already `ACCEPTED` invitation throws `ConflictError`.
    - Attempting to accept `EXPIRED`, `REVOKED`, or `REJECTED` invitations throws `ConflictError` or `BadRequestError`.
11. **Revocation & Resend**:
    - Partner can revoke their own pending invitation (`REVOKED` status). Attempting to revoke another partner's invitation is blocked with `ForbiddenError`.
    - Resending regenerates a cryptographically secure token, increments `resendCount`, extends expiry by 7 calendar days, and returns the new raw token.
12. **Batch Expiration Sweep**:
    - `expireInvitations(now)` batch updates all overdue pending invitations (`invitationStatus: 'PENDING'`, `expiresAt < now`) to `EXPIRED`.

---

### 2.2 WorkerAffiliationService

#### Affiliation Architecture & Rules
1. **Non-Exclusive Multi-Partner Affiliations**:
   - The platform supports non-exclusive multi-partner affiliations. A worker can maintain active affiliations with unlimited partner fleets concurrently without arbitrary caps.
2. **Tenant-Isolated Listing & Detail Access**:
   - `listMyAffiliations(workerUserId)` returns all active or historical affiliations scoped exclusively to the authenticated worker profile.
   - `getMyAffiliation(workerUserId, affiliationId)` verifies worker ownership and blocks cross-worker access (`ForbiddenError`).
   - `listPartnerWorkers(partnerUserId)` returns all active or historical worker affiliations belonging to the authenticated partner.
   - `getPartnerWorkerDetails(partnerUserId, affiliationId)` provides partner access to worker details while **strictly concealing private document storage keys, file paths, or sensitive internal credentials**.
3. **Voluntary Termination by Worker**:
   - Worker can terminate their affiliation at any time via `terminateMyAffiliation`.
   - Transitions `affiliation_status` to `'TERMINATED'`, records `ended_at`, sets `termination_reason`, and creates an audit log entry.
   - Preserves all other active affiliations with other partners.
4. **Partner Termination with Mandatory Reason**:
   - Partner terminating an affiliation via `terminatePartnerAffiliation` **must provide a non-empty termination reason** (`BadRequestError` if empty).
   - Partner cannot terminate an affiliation belonging to another partner fleet (`ForbiddenError`).
5. **No Double Termination**:
   - Terminating an already terminated affiliation fails with `ConflictError`.
6. **Full Historical Preservation & Re-Affiliation**:
   - Terminated affiliations remain in PostgreSQL for auditing, compliance, and dispute resolution.
   - Partners can issue fresh invitations to previously affiliated workers; upon acceptance, a new active affiliation record is created cleanly.

---

### 2.3 WorkerAvailabilityService

#### Availability Lifecycle & Operational Checks
1. **Online/Offline State Machine**:
   - Toggles worker duty status in `worker_availability`.
   - Coordinates (`latitude`, `longitude`) are validated: latitude must be between -90 and 90, longitude between -180 and 180 (`BadRequestError` if out of bounds).
2. **Fail-Closed Eligibility Gate**:
   - To transition to `isOnline: true`, the worker profile must:
     1. Have `approvalStatus === 'APPROVED'`.
     2. Have `isActive === true` and `suspendedAt === null`.
     3. Pass comprehensive KYC validation via `WorkerKycValidationService` (all mandatory documents for the worker type/jurisdiction must be verified and unexpired with zero grace days; all mandatory skills verified).
   - If any condition fails, `goOnline` throws `ForbiddenError` detailing the safe, non-sensitive failure reasons.
3. **Independent Worker Availability**:
   - Supported natively: an approved worker can toggle online and receive dispatches **without requiring any partner affiliation**.
4. **Non-Reactivating Heartbeat Processing**:
   - Heartbeat updates refresh `lastHeartbeatAt` and live coordinates.
   - **Crucial Invariant**: If a worker is offline (`isOnline: false`), receiving a heartbeat updates location and timestamp but **strictly preserves `isOnline: false`**. It never silently reactivates an offline worker.
   - Suspended workers are blocked from sending heartbeats (`ForbiddenError`).
5. **Operational Availability Evaluation (`getOperationalAvailability`)**:
   - Evaluates real-time dispatch eligibility and returns structured telemetry:
     - `ONLINE_AVAILABLE`: `isOnline: true`, not busy, not suspended, KYC valid, and heartbeat received within 5 minutes.
     - `BUSY`: `isOnline: true`, but currently assigned to an active task (`isBusy: true`).
     - `STALE_OFFLINE`: `isOnline: true`, but `lastHeartbeatAt` exceeds the 5-minute timeout threshold (`HEARTBEAT_STALE_TIMEOUT_MS = 300,000 ms`).
     - `OFFLINE`: `isOnline: false`.
6. **Distributed Atomic Dispatch Locking (`setDispatchLock` & `releaseDispatchLock`)**:
   - Implements distributed atomic lock acquisition using Redis `SET key owner NX PX ttlMs` when Redis is available.
   - Falls back gracefully to thread-safe in-process map storage in degraded mode or under integration test runners without Redis.
   - Configurable TTL: default 60,000 ms (60s), capped at 300,000 ms (5m).
   - **Concurrency Safety**: Second concurrent lock attempt while active is rejected (`acquired: false`).
   - **Owner Verification**: Releasing the lock requires matching `lockOwner` token. Releasing with an incorrect token fails (`released: false`).
   - `forceRelease: true` option supported for system cleanup of stale dispatch locks.

---

## 3. Test Suites & Verification Results

### 3.1 Batch 3 Test Suites (`tests/phase6e-batch3-*.test.ts`)
```
PASS tests/phase6e-batch3-invitations-affiliations.test.ts (9.363 s)
  Phase 6E Batch 3: Worker Invitations & Multi-Partner Affiliations
    1. Worker Invitation Creation & Validation Rules
      √ should reject invitation creation from a non-partner user (72 ms)
      √ should reject invitation creation from an unapproved partner (14 ms)
      √ should reject invitation creation from a suspended partner account (5 ms)
      √ should reject invitation with invalid Indian mobile number format (11 ms)
      √ should normalize 10-digit mobile number and create invitation securely (43 ms)
      √ should allow multiple partners to independently invite the same mobile number (18 ms)
      √ should prevent duplicate pending invitations for the same partner and mobile number (9 ms)
    2. Listing & Details
      √ should list partner invitations with pagination and filter (100 ms)
      √ should list worker invitations targeting their mobile number (22 ms)
      √ should get invitation details when worker mobile matches (21 ms)
      √ should reject getInvitationDetails if authenticated worker mobile does not match (21 ms)
    3. Resend & Revocation Lifecycle
      √ should allow partner to resend a pending invitation with new token and extended expiry (19 ms)
      √ should prevent another partner from resending an invitation they do not own (19 ms)
      √ should allow partner to revoke their own pending invitation (27 ms)
      √ should prevent revoking an already revoked invitation (7 ms)
      √ should prevent another partner from revoking an invitation they do not own (9 ms)
    4. Worker Acceptance, Prerequisite Enforcement & Multi-Partner Affiliation
      √ should reject acceptance if worker has no worker profile registered (48 ms)
      √ should reject acceptance if wrong worker attempts to accept invitation (15 ms)
      √ should atomically accept invitation and create active affiliation for Partner A (50 ms)
      √ should prevent replay of already accepted invitation (9 ms)
      √ should support non-exclusive multi-partner affiliation: Worker accepts Partner B concurrently (52 ms)
      √ should allow worker to get specific affiliation by ID with IDOR protection (31 ms)
      √ should allow partners to view their affiliated workers (45 ms)
    5. Worker Rejection & Expired Invitation Rules
      √ should allow worker to reject an invitation with reason (33 ms)
      √ should reject acceptance of expired invitation and sweep overdue invitations (18 ms)
    6. Affiliation Termination Lifecycle
      √ should allow worker voluntary termination of affiliation with Partner B (29 ms)
      √ should require mandatory reason when partner terminates an affiliation (4 ms)
      √ should enforce partner IDOR: Partner B cannot terminate Partner A affiliation (9 ms)
      √ should allow Partner A to terminate affiliation with mandatory reason (21 ms)
      √ should reject termination of already terminated affiliation (15 ms)
      √ should preserve full affiliation history and allow re-affiliation (53 ms)

PASS tests/phase6e-batch3-availability.test.ts (2.898 s)
  Phase 6E Batch 3: Worker Availability & Heartbeat Management
    1. Initial State & Retrieval
      √ should return default offline availability when worker has no prior availability row (21 ms)
      √ should throw NotFoundError for non-existent worker profile (31 ms)
    2. goOnline State Machine & Eligibility Guards
      √ should reject goOnline if worker profile is unapproved (PENDING) (5 ms)
      √ should reject goOnline if worker profile is suspended (5 ms)
      √ should reject goOnline if mandatory KYC document is expired (92 ms)
      √ should reject goOnline if coordinates are out of valid geographic range (39 ms)
      √ should allow independent worker (no partner affiliation) with valid KYC to go online (17 ms)
      √ should allow approved worker with valid KYC to go online (15 ms)
    3. Heartbeat & goOffline Lifecycle
      √ should update heartbeat and coordinates while worker is online (17 ms)
      √ should allow worker to toggle offline (9 ms)
      √ should NOT silently bring worker online when sending heartbeat while offline (23 ms)
      √ should reject heartbeat update if worker is suspended (5 ms)
    4. Operational Availability & Dispatch Status Evaluation
      √ should evaluate status as OFFLINE when worker is offline (12 ms)
      √ should evaluate status as ONLINE_AVAILABLE when worker is online with fresh heartbeat (25 ms)
      √ should evaluate status as BUSY when worker is online and marked busy (15 ms)
      √ should evaluate status as STALE_OFFLINE when last heartbeat is older than 5 minutes (14 ms)
    5. Dispatch Lock Concurrency & Owner Verification
      √ should acquire dispatch lock atomically with TTL (3 ms)
      √ should reject concurrent lock acquisition attempt while lock is active (1 ms)
      √ should reject release attempt with wrong lock owner token (2 ms)
      √ should allow force release of dispatch lock regardless of owner (3 ms)
```

### 3.2 Full Repository Regression (`npm test -- --runInBand`)
```
Test Suites: 20 passed, 20 total
Tests:       519 passed, 519 total
Snapshots:   0 total
Time:        45.022 s
```
- **Prisma Schema Validation**: Valid (`The schema at prisma\schema.prisma is valid 🚀`).
- **TypeScript Compilation (`tsc`)**: Clean with zero type errors.

---

## 4. Scope Compliance Verification

| Requirement | Status | Verification Detail |
|---|---|---|
| Implement Batch 3 ONLY | **Compliant** | Implemented `WorkerInvitationService`, `WorkerAffiliationService`, `WorkerAvailabilityService`, repository extensions, and comprehensive tests. |
| Do NOT implement HTTP controllers or routes | **Compliant** | No controllers or routes were authored or modified in Batch 3. |
| Do NOT implement admin worker approval or governance | **Compliant** | Exclusively reserved for a subsequent batch. |
| Cryptographic token hashing & zero raw token in DB | **Compliant** | Only SHA-256 digests stored in `invitation_token_hash`. Raw tokens never stored in DB or written to logs. |
| Non-exclusive multi-partner affiliations | **Compliant** | Verified: worker can maintain concurrent active affiliations with multiple partners simultaneously without artificial caps. |
| Fail-closed availability guards | **Compliant** | Unapproved, suspended, or KYC-expired workers strictly blocked from going online. |
| Independent worker availability | **Compliant** | Verified: approved workers can toggle online and receive dispatches with zero partner affiliations. |
| Heartbeat preserves offline status | **Compliant** | Verified: heartbeat received while offline updates timestamp and location but preserves `isOnline: false`. |
| Dispatch lock concurrency & owner release | **Compliant** | Redis NX PX with owner token verification, TTL bounding, and robust in-process fallback verified. |

Batch 3 is complete, fully tested, and ready for Batch 4.
