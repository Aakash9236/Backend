# Phase 6E — Batch 1: Worker Database Foundation & Repositories Verification Report

**Date:** 2026-11-17  
**Module:** Worker Management Subsystem (`Phase 6E`)  
**Scope:** Batch 1 — Database Foundation, Migration 015, Prisma Integration & Repository Layer  
**Status:** **APPROVED & FULLY VERIFIED**

---

## 1. Executive Summary

Batch 1 of Phase 6E establishes the enterprise-grade database foundation and Data Access Layer (DAL) for worker management across multi-city, on-demand services (cleaning, moving, electrical, plumbing, painting, assembly, etc.).

All deliverables have been implemented, migrated against live PostgreSQL (`service_platform_db`), mapped cleanly into Prisma ORM, wrapped in 6 dedicated transaction-aware repositories, and rigorously verified through automated integration testing.

### Key Milestones Achieved
1. **Pre-Migration Backup:** Secured live database backup `backups/service_platform_db_backup_20261117130200_phase6e_pre_b1.sql` (158.57 KB).
2. **Database Migration 015:** Created and applied `migrations/015_worker_management_foundation.sql` containing all 6 worker tables, foreign keys, check constraints, and partial unique indexes.
3. **Rollback Script:** Authored and verified `migrations/015_worker_management_foundation_rollback.sql`.
4. **Prisma ORM Integration:** Updated `prisma/schema.prisma` with 6 new models and reciprocal relations on `User`, `PartnerProfile`, `ServiceCategory`, and `City`. Validated and regenerated Prisma Client.
5. **Database Error Handling:** Implemented `src/modules/workers/utils/worker-db-error.util.ts`, converting low-level PostgreSQL and Prisma exceptions into domain `AppError` subclasses (`ConflictError`, `BadRequestError`, `NotFoundError`).
6. **Repository Layer:** Authored 6 transaction-aware, production-ready repositories in `src/modules/workers/repositories/` with exported classes and singleton instances.
7. **Verification & Regression:** 
   - **Phase 6E Repositories Suite (`tests/phase6e-repositories.test.ts`):** **46/46 tests passed (100%)**.
   - **Phase 6D Driver Regression Suite (`tests/phase6d-*.test.ts`):** **220/220 tests passed (100%)**.
   - **System-wide Backend Regression Suite (`npm test`):** **416/416 tests passed across 16 suites (100%)**.
   - **TypeScript Build (`npm run build`):** **0 errors**.
   - **Prisma Validation (`npx prisma validate`):** **Schema valid**.

---

## 2. Pre-Migration Safety & Backup Details

In accordance with platform safety protocols, a pre-migration backup was generated before applying changes:

- **Target Database:** `service_platform_db`
- **PostgreSQL Version:** 18.1 (x64 Windows)
- **Backup Location:** `backups/service_platform_db_backup_20261117130200_phase6e_pre_b1.sql`
- **File Size:** 162,377 bytes (~158.57 KB)
- **Status:** Verified complete; schema and data preserved.

---

## 3. Database Migration Architecture (Migration 015)

Migration `015_worker_management_foundation.sql` was applied cleanly and recorded in `schema_migrations`.

```
========================================================================================
                               SCHEMA MIGRATION 015
========================================================================================
Applied: migrations/015_worker_management_foundation.sql
Rollback: migrations/015_worker_management_foundation_rollback.sql
Registered in: schema_migrations (version = '015_worker_management_foundation')
========================================================================================
```

### 3.1 Entity Model & Integrity Constraints

| Table Name | Primary Key | Key Foreign Keys & Constraints | Business Purpose |
| :--- | :--- | :--- | :--- |
| `worker_profiles` | `id bigint ALWAYS AS IDENTITY` | `user_id UNIQUE REFERENCES users(id) ON DELETE CASCADE`<br>`primary_city_id REFERENCES cities(id) ON DELETE SET NULL`<br>`reviewed_by REFERENCES users(id) ON DELETE SET NULL`<br>`chk_worker_type IN ('HELPER','TECHNICIAN','SPECIALIST')`<br>`chk_worker_approval_status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')`<br>`chk_worker_submission_status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','ACTION_REQUIRED','APPROVED')`<br>`chk_worker_experience >= 0` | Master identity and onboarding state for independent or partner-affiliated service workers. |
| `worker_documents` | `id bigint ALWAYS AS IDENTITY` | `worker_id REFERENCES worker_profiles(id) ON DELETE RESTRICT`<br>`reviewed_by REFERENCES users(id) ON DELETE SET NULL`<br>`chk_worker_doc_type IN ('IDENTITY_PROOF','PROFILE_PHOTO','POLICE_VERIFICATION','ADDRESS_PROOF','SKILL_CERTIFICATE','MEDICAL_FITNESS','OTHER')`<br>`chk_worker_document_verification_status IN ('PENDING','VERIFIED','REJECTED')`<br>`chk_worker_doc_size >= 0` | Append-only document verification history with metadata (`original_name`, `mime_type`, `file_size_bytes`). |
| `worker_skills` | `id bigint ALWAYS AS IDENTITY` | `worker_id REFERENCES worker_profiles(id) ON DELETE CASCADE`<br>`service_category_id REFERENCES service_categories(id) ON DELETE RESTRICT`<br>`reviewed_by REFERENCES users(id) ON DELETE SET NULL`<br>`CONSTRAINT uq_worker_skill UNIQUE (worker_id, service_category_id)`<br>`chk_worker_skill_verification_status IN ('PENDING','VERIFIED','REJECTED')`<br>`chk_worker_skill_experience >= 0` | Verified skills and service trade capabilities per category (cleaning, plumbing, electrical). |
| `worker_invitations` | `id bigint ALWAYS AS IDENTITY` | `partner_id REFERENCES partner_profiles(id) ON DELETE RESTRICT`<br>`inviting_user_id REFERENCES users(id) ON DELETE SET NULL`<br>`worker_user_id REFERENCES users(id) ON DELETE SET NULL`<br>`revoked_by REFERENCES users(id) ON DELETE SET NULL`<br>`invitation_token_hash UNIQUE VARCHAR(128)`<br>`chk_worker_invitation_status IN ('PENDING','ACCEPTED','REJECTED','EXPIRED','REVOKED')`<br>`Partial Unique Index idx_one_pending_invitation_per_partner_worker ON (partner_id, invited_mobile) WHERE invitation_status = 'PENDING'` | Cryptographically secure invitations from service partners to prospective or registered workers. |
| `worker_partner_affiliations` | `id bigint ALWAYS AS IDENTITY` | `worker_id REFERENCES worker_profiles(id) ON DELETE RESTRICT`<br>`partner_id REFERENCES partner_profiles(id) ON DELETE RESTRICT`<br>`invitation_id REFERENCES worker_invitations(id) ON DELETE SET NULL`<br>`chk_worker_affiliation_status IN ('ACTIVE','TERMINATED','SUSPENDED')`<br>`chk_worker_affiliation_terminated: (status != 'TERMINATED') OR (terminated_at IS NOT NULL)`<br>`Partial Unique Index idx_active_worker_partner_affiliation ON (worker_id, partner_id) WHERE affiliation_status = 'ACTIVE'` | M:N affiliation mapping allowing workers to join multiple service partner organizations. |
| `worker_availability` | `id bigint ALWAYS AS IDENTITY` | `worker_id UNIQUE REFERENCES worker_profiles(id) ON DELETE CASCADE`<br>`current_latitude DECIMAL(10,7)`<br>`current_longitude DECIMAL(10,7)`<br>`idx_worker_online_busy ON (is_online, is_busy)` | Real-time duty tracking, location ping, and heartbeat for dispatch readiness. |

---

## 4. Prisma ORM Integration

`prisma/schema.prisma` was updated with the 6 models and reciprocal relation fields:
- `User.workerProfile` (`WorkerProfile?`)
- `User.workerProfileReviews` (`WorkerProfile[] @relation("WorkerProfileReviewer")`)
- `User.workerDocumentReviews` (`WorkerDocument[] @relation("WorkerDocumentReviewer")`)
- `User.workerSkillReviews` (`WorkerSkill[] @relation("WorkerSkillReviewer")`)
- `User.workerInvitationsSent` (`WorkerInvitation[] @relation("WorkerInvitingUser")`)
- `User.workerInvitationsReceived` (`WorkerInvitation[] @relation("WorkerUserInvitation")`)
- `User.workerInvitationsRevoked` (`WorkerInvitation[] @relation("WorkerInvitationRevoker")`)
- `PartnerProfile.workerInvitations` (`WorkerInvitation[]`)
- `PartnerProfile.workerAffiliations` (`WorkerPartnerAffiliation[]`)
- `ServiceCategory.workerSkills` (`WorkerSkill[]`)
- `City.workerProfiles` (`WorkerProfile[]`)

Prisma Client was regenerated (`npx prisma generate`) with zero errors.

---

## 5. Error Mapping Utility (`worker-db-error.util.ts`)

The helper function `handleWorkerDbError(error: unknown, fallbackMessage?: string): never` standardizes database exceptions into domain HTTP errors:

1. **Unique Violations (`23505` / `P2002`):**
   - `idx_one_pending_invitation_per_partner_worker` -> `ConflictError('A pending invitation already exists from this partner to this worker mobile number.')`
   - `idx_active_worker_partner_affiliation` -> `ConflictError('An active affiliation already exists between this worker and partner.')`
   - `uq_worker_skill` -> `ConflictError('This skill category is already registered for this worker.')`
   - `worker_profiles_user_id_key` -> `ConflictError('A worker profile is already registered for this user account.')`
   - `worker_invitations_invitation_token_hash_key` -> `ConflictError('Invitation token hash collision. Please retry.')`
   - `worker_availability_worker_id_key` -> `ConflictError('Availability record already exists for this worker.')`
2. **Foreign Key Violations (`23503` / `P2003`):**
   - `fk_worker_document_worker` -> `ConflictError('Cannot remove worker profile because verification documents are attached.')`
   - `fk_worker_skill_category` -> `NotFoundError('Referenced service category does not exist.')`
   - `fk_worker_affiliation_partner` / `fk_worker_invitation_partner` -> `NotFoundError('Referenced partner profile does not exist.')`
   - `fk_worker_affiliation_worker` -> `NotFoundError('Referenced worker profile does not exist.')`
   - `fk_worker_profile_user` -> `NotFoundError('Referenced user account does not exist.')`
3. **Check Constraint Violations (`23514` / `P2004`):**
   - `chk_worker_approval_status`, `chk_worker_submission_status`, `chk_worker_type`, `chk_worker_experience`, `chk_worker_skill_experience`, `chk_worker_invitation_status`, `chk_worker_affiliation_status`, `chk_worker_affiliation_terminated`, `chk_worker_doc_type`, `chk_worker_document_verification_status`, `chk_worker_skill_verification_status` mapped to descriptive `BadRequestError`s.

---

## 6. Data Access Layer & Repositories

Six dedicated repositories were implemented under `src/modules/workers/repositories/`, with comprehensive transaction support (`tx?: Prisma.TransactionClient`):

### 6.1 `WorkerProfileRepository`
- `findById(id, tx)`: Fetches worker profile by ID with user, primaryCity, and reviewer relations.
- `findByUserId(userId, tx)`: Fetches worker profile by User ID.
- `create(data, tx)`: Creates profile with defaults (`PENDING` approval, `DRAFT` submission).
- `update(id, data, tx)`: Updates profile information (bio, experienceYears, workerType, primaryCity).
- `submitOnboarding(id, tx)`: Updates submission status to `SUBMITTED` with `submittedAt = now()`.
- `updateSubmissionStatus(id, status, submittedAt, tx)`: General submission status transitions.
- `updateApprovalStatus(id, status, reviewerId, rejectionReason, tx)`: Administrative approval transitions.
- `updateSuspensionStatus(id, status, suspensionReason, suspendedAt, tx)`: Suspension and reactivation handling.
- `findMany(filter, options, tx)`: Paginated query with filters on approval status, submission status, worker type, city, and text search across names.

### 6.2 `WorkerDocumentRepository`
- `create(data, tx)`: Additive record insertion preserving document history. Supports file metadata (`originalName`, `mimeType`, `fileSizeBytes`).
- `findById(id, tx)`: Fetches document by ID with worker user and reviewer relations.
- `findByWorkerId(workerId, tx)`: Lists all documents for a worker sorted descending by `uploadedAt`.
- `findLatestByWorker(workerId, tx)`: Computes and returns the single latest document for each distinct document type.
- `findLatestByType(workerId, documentType, tx)`: Retrieves the most recently uploaded document for a specific document type.
- `findPendingVerification(options, tx)`: FIFO admin verification queue for documents with status `PENDING`.
- `updateVerificationStatus(id, data, tx)`: Updates verification status with reviewer ID and timestamp.

### 6.3 `WorkerSkillRepository`
- `create(data, tx)`: Links a skill category with experience years. Protected by `uq_worker_skill`.
- `findById(id, tx)`: Fetches skill record with worker, category, and reviewer relations.
- `findByWorkerId(workerId, tx)`: Lists all skills assigned to a worker profile.
- `findByCategory(workerId, serviceCategoryId, tx)`: Retrieves skill for a specific worker and category.
- `updateVerificationStatus(id, data, tx)`: Sets verification status with reviewer metadata.
- `delete(id, tx)`: Removes a skill record.
- `findPendingVerification(options, tx)`: FIFO review queue of pending skills.

### 6.4 `WorkerInvitationRepository`
- `create(data, tx)`: Inserts invitation with SHA-256 token hash (`invitationTokenHash`).
- `findById(id, tx)`: Retrieves invitation by ID with partner and user relations.
- `findByTokenHash(tokenHash, tx)`: Finds invitation by cryptographic token hash.
- `findPendingByPartnerAndMobile(partnerId, invitedMobile, tx)`: Finds active pending invitation.
- `listReceivedForMobile(invitedMobile, workerUserId, options, tx)`: Lists received invitations.
- `listCreatedByPartner(partnerId, status, options, tx)`: Lists partner-sent invitations.
- `updateStatus(id, status, metadata, tx)`: Direct status update.
- `incrementResendCount(id, newExpiresAt, tx)`: Increments resend counter with optional expiration extension.
- `atomicTransitionStatus(id, fromStatus, toStatus, metadata, tx)`: Conditional atomic transition preventing race conditions.
- `expireEligibleInvitations(now, tx)`: Batch expires past pending invitations.

### 6.5 `WorkerPartnerAffiliationRepository`
- `create(data, tx)`: Establishes affiliation with status `ACTIVE`.
- `findById(id, tx)`: Fetches affiliation by ID with worker and partner details.
- `findActive(workerId, partnerId, tx)`: Checks if an active affiliation exists.
- `listActiveByWorker(workerId, tx)`: Lists all active affiliations for a worker (supports M:N affiliations).
- `listByWorker(workerId, status, options, tx)`: Paginated historical and active affiliations.
- `listActiveByPartner(partnerId, options, tx)`: Lists active affiliated workers for a partner.
- `terminate(id, terminationReason, terminatedAt, tx)`: Terminates affiliation and preserves historical record.

### 6.6 `WorkerAvailabilityRepository`
- `findByWorkerId(workerId, tx)`: Fetches availability record by worker ID.
- `upsertAvailability(workerId, data, tx)`: Atomic upsert of online/busy status and coordinates.
- `updateDutyStatus(workerId, isOnline, isBusy, tx)`: Toggles duty status with heartbeat update.
- `updateHeartbeat(workerId, lat, long, tx)`: Updates keep-alive timestamp and optional GPS coordinates.
- `findOnlineAvailable(tx)`: Finds workers online and free (`isOnline = true` and `isBusy = false`).

---

## 7. Automated Verification & Test Results

### 7.1 Phase 6E Repository Integration Test Suite
Command: `npx jest tests/phase6e-repositories.test.ts --runInBand`

```
PASS tests/phase6e-repositories.test.ts
  Phase 6E Batch 1: Worker Database Foundation & Repositories Integration Tests
    1. WorkerProfileRepository
      √ should create a worker profile successfully (6 ms)
      √ should find worker profile by ID with user, city, and reviewer relations (3 ms)
      √ should find worker profile by User ID (3 ms)
      √ should prevent duplicate worker profiles for the same user (ConflictError) (17 ms)
      √ should update worker profile fields successfully (4 ms)
      √ should transition submission status on onboarding submission (3 ms)
      √ should update approval status with reviewer metadata (3 ms)
      √ should update suspension status with reason and timestamp (3 ms)
      √ should query worker profiles with pagination and filters (41 ms)
    2. WorkerDocumentRepository
      √ should create a worker document record (6 ms)
      √ should find document by ID with worker details (3 ms)
      √ should support additive document versioning (preserving history) (3 ms)
      √ should find latest document by type correctly (2 ms)
      √ should list latest documents across all types using findLatestByWorker (3 ms)
      √ should update verification status with reviewer information (2 ms)
      √ should query pending verification documents in FIFO queue (2 ms)
    3. WorkerSkillRepository
      √ should add a skill to a worker profile (5 ms)
      √ should find skill by ID with worker and category relations (4 ms)
      √ should find skill by worker and category (findByCategory) (2 ms)
      √ should reject duplicate skill for the same worker and category (ConflictError) (3 ms)
      √ should update skill verification status (2 ms)
      √ should list all skills for a worker (2 ms)
      √ should delete a skill record successfully (3 ms)
    4. WorkerInvitationRepository
      √ should create a worker invitation with hashed token (6 ms)
      √ should find invitation by ID and by token hash (6 ms)
      √ should find pending invitation by partner and mobile (1 ms)
      √ should reject a duplicate PENDING invitation from the same partner to the same mobile (ConflictError) (4 ms)
      √ should allow MULTIPLE DIFFERENT partners to invite the SAME mobile simultaneously (3 ms)
      √ should list invitations received for a mobile number (2 ms)
      √ should list invitations created by a partner (2 ms)
      √ should increment resend count successfully (1 ms)
      √ should perform conditional atomic state transitions (4 ms)
      √ should batch expire past invitations using expireEligibleInvitations (4 ms)
    5. WorkerPartnerAffiliationRepository
      √ should create an active affiliation between worker and partner (3 ms)
      √ should find affiliation by ID and active affiliation between worker and partner (5 ms)
      √ should prevent duplicate ACTIVE affiliations for the SAME worker and partner (ConflictError) (3 ms)
      √ should allow MULTIPLE ACTIVE affiliations for the same worker across DIFFERENT partners (4 ms)
      √ should list active affiliations for a partner (2 ms)
      √ should terminate an affiliation while preserving the historical record (4 ms)
      √ should allow a NEW active affiliation between the same worker and partner after prior termination (2 ms)
    6. WorkerAvailabilityRepository
      √ should upsert worker availability record (4 ms)
      √ should find availability by worker ID (3 ms)
      √ should update duty status (toggle offline/busy) (2 ms)
      √ should update heartbeat and coordinates (2 ms)
      √ should list online and available workers (3 ms)
    7. Transaction Isolation & Rollback Atomicity
      √ should rollback all operations if an error occurs within a Prisma transaction (15 ms)

Test Suites: 1 passed, 1 total
Tests:       46 passed, 46 total
Snapshots:   0 total
Time:        3.039 s
```

### 7.2 Phase 6D Driver Regression Suite
Command: `npx jest phase6d --runInBand`

```
Test Suites: 7 passed, 7 total
Tests:       220 passed, 220 total
Snapshots:   0 total
Time:        10.521 s
```

### 7.3 System-Wide Regression Suite
Command: `npm test -- --runInBand`

```
Test Suites: 16 passed, 16 total
Tests:       416 passed, 416 total
Snapshots:   0 total
Time:        17.141 s
```

---

## 8. Scope Boundary Enforcement

Batch 1 scope boundaries were strictly adhered to:
- **No KYC business services** implemented yet (scheduled for Batch 2).
- **No onboarding workflow services** implemented yet (scheduled for Batch 2).
- **No invitation/affiliation business services** implemented yet (scheduled for Batch 3).
- **No admin approval services or controllers** implemented yet (scheduled for Batch 4).
- **No HTTP routes or API endpoints** exposed in Batch 1.
- **Zero modification** to existing driver or vehicle business logic.

---

## 9. Conclusion & Readiness

Phase 6E Batch 1 is **COMPLETE, VERIFIED, AND APPROVED**.

The PostgreSQL foundation, Prisma models, error mapping utilities, and 6 repositories are active and fully operational in `service_platform_db`. The backend is completely stable with zero regressions across all 416 tests.

We are ready to proceed with the next authorized batch upon user instruction.
