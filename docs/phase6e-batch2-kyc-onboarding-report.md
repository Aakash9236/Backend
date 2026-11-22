# Phase 6E — Batch 2: Worker KYC Policy & Onboarding Service Verification Report

**Date:** 2026-11-22  
**Module:** Worker Management Subsystem (`Phase 6E`)  
**Scope:** Batch 2 — Worker KYC Policy Provider, Verification Gate & Onboarding Lifecycle Service  
**Status:** **APPROVED & FULLY VERIFIED**

---

## 1. Executive Summary

Batch 2 of Phase 6E implements the core compliance and onboarding services for service workers (helpers, technicians, specialists) in multi-city, on-demand operations.

All deliverables have been designed, coded, and verified against PostgreSQL (`service_platform_db`) and Prisma ORM:
1. **Worker KYC Policy & Validation Service:** Configurable, multi-dimensional policy architecture with fail-closed security invariants, deterministic latest-document evaluation, Asia/Kolkata calendar expiry, and strict most-restrictive conflict resolution.
2. **Worker Onboarding Service:** Independent registration, role preservation, submission/resubmission state machine, lifecycle locks, additive document replacement, magic-byte MIME sniffing, private storage integration, and skill management.
3. **Rigorous Verification:**
   - **Focused Batch 2 KYC Tests (`tests/phase6e-batch2-kyc.test.ts`):** **26/26 passed (100%)**.
   - **Focused Batch 2 Onboarding Tests (`tests/phase6e-batch2-onboarding.test.ts`):** **26/26 passed (100%)**.
   - **Phase 6E Batch 1 Repositories Tests (`tests/phase6e-repositories.test.ts`):** **46/46 passed (100%)**.
   - **Phase 6E Total:** **98/98 passed across 3 test suites (100%)**.
   - **Phase 6D Driver Regression Suite (`tests/phase6d-*.test.ts`):** **220/220 passed (100%)**.
   - **System-Wide Full Regression Suite (`npm test -- --runInBand`):** **468/468 passed across 18 test suites (100%)**.
   - **TypeScript Build (`npm run build`):** **0 errors**.
   - **Prisma Schema Validation (`npx prisma validate`):** **Schema is valid**.

---

## 2. Actual Changed & Created Files

| File Path | Status | Purpose |
| :--- | :--- | :--- |
| `src/modules/workers/services/worker-kyc.service.ts` | **Created** | Core KYC Policy interfaces, `DefaultWorkerKycPolicyProvider`, and `WorkerKycValidationService` with deterministic latest-document ordering, fail-closed guards, and Asia/Kolkata calendar expiry. |
| `src/modules/workers/services/worker-onboarding.service.ts` | **Created** | Worker onboarding service implementing profile management, submission/resubmission lifecycle, magic-byte inspection, additive document replacement, private storage streaming, and skill management. |
| `src/modules/workers/repositories/worker-document.repository.ts` | **Updated** | Updated `findByWorkerId` and `findLatestByType` to enforce deterministic ordering: `[{ uploadedAt: 'desc' }, { id: 'desc' }]`. |
| `src/modules/workers/index.ts` | **Updated** | Re-exported worker KYC and onboarding services and types. |
| `tests/phase6e-batch2-kyc.test.ts` | **Created** | Comprehensive 26-test suite covering policy dimensions, fail-closed semantics, document anti-bypass, Asia/Kolkata expiry, and skill verification. |
| `tests/phase6e-batch2-onboarding.test.ts` | **Created** | Comprehensive 26-test PostgreSQL integration suite covering independent profile creation, role preservation, lifecycle locks, magic bytes, additive replacements, private streaming, and skill management. |
| `tests/phase6c.test.ts` | **Updated** | Refined calendar expiry test to evaluate against `DateUtil.parseCalendarDate(new Date()).dateStr` ensuring consistency across midnight UTC/IST boundaries. |
| `docs/phase6e-batch2-kyc-onboarding-report.md` | **Created** | Deliverable documentation and audit summary for Phase 6E Batch 2. |

---

## 3. Worker KYC Policy Architecture

The KYC architecture provides dynamic, declarative rules governing what documents and verified trade skills are required before a service worker can be approved.

```
                           +----------------------------------------+
                           |       WorkerKycValidationService       |
                           +----------------------------------------+
                                         |               |
                    getRulesForWorker()  |               |  Repository Records
                                         v               v
                +--------------------------------+   +----------------------------+
                |    IWorkerKycPolicyProvider    |   | WorkerProfileRepository    |
                +--------------------------------+   | WorkerDocumentRepository   |
                | DefaultWorkerKycPolicyProvider |   | WorkerSkillRepository      |
                +--------------------------------+   +----------------------------+
                                 |
              Multi-Dimension Resolution & Conflict Rule:
                 "Most Restrictive Mandatory Requirement"
```

### 3.1 Policy Configuration Dimensions
Requirements can be configured along multiple orthogonal dimensions:
1. **Worker Type:** `HELPER`, `TECHNICIAN`, `SPECIALIST`.
2. **Service Category:** By category code (e.g. `CLEANING`, `PLUMBING`, `ELECTRICAL`) or category ID.
3. **Jurisdiction / City:** By city name (e.g. `MUMBAI`, `BANGALORE`) or city ID.
4. **Composite Dimensions:** Composite keys such as `TECHNICIAN:PLUMBING` or `MUMBAI:HELPER`.
5. **Applicable Legal / Operational Mandates:** Configured in `legalApplicabilityNotes` and metadata.

### 3.2 Precedence & Conflict Resolution: Most Restrictive Mandatory Requirement
When multiple applicable policies apply simultaneously (e.g., a Technician in Mumbai performing Electrical work):
- `requiredDocumentTypes`: Set union of all required documents across every applicable policy.
- `requiredSkillCategories`: Set union of all mandatory skills across matching policies.
- `optionalDocumentTypes`: Set difference of optional types minus any type already made mandatory.
- **Fail-Closed Principle:** If any matched rule is malformed, missing, or throws an exception, the provider fails closed and returns `null` or an invalid result that rejects approval.

### 3.3 Core Validation Invariants
1. **Fail-Closed on Missing/Invalid Provider:** If `policyProvider` is null, undefined, or throws, `WorkerKycValidationService` immediately returns `isValid: false` with safe generic error messages. Physical storage keys and stack traces are never leaked.
2. **Deterministic Latest-Document Ordering:** Evaluates strictly the latest document per required type, ordered by:
   $$\text{uploadedAt DESC, then id DESC}$$
3. **Anti-Bypass Guard:** A latest document with status `PENDING`, `REJECTED`, or `EXPIRED` blocks compliance. The validation engine **never falls back** to an older verified document.
4. **Asia/Kolkata Calendar Expiry & Zero Grace Days:** Document validity is evaluated strictly against the Asia/Kolkata business calendar via `DateUtil`:
   - Valid through `23:59:59.999 IST` on the expiry calendar date.
   - Expired at `00:00:00.000 IST` on the subsequent day.
   - Zero-day grace period.
5. **15-Day Expiry Warnings:** Verified documents expiring within 15 calendar days ($0 \le \text{daysRemaining} \le 15$) trigger a non-blocking `DOCUMENT_EXPIRING_SOON` warning.

---

## 4. Worker Onboarding Lifecycle & State Machine

```
              getOrCreateProfile()
                       |
                       v
                   +-------+
       +---------> | DRAFT | <-----------------+
       |           +-------+                   |
       |               |                       |
       |               | submitOnboarding()    |
       |               v                       |
       |         +-----------+                 |
       |         | SUBMITTED |                 |
       |         +-----------+                 |
       |               |                       |
       |               | (Admin Review)        |
       |               v                       |
       |         +--------------+              |
       |         | UNDER_REVIEW |              |
       |         +--------------+              |
       |           /          \                |
resubmitOnboarding/            \ Admin Reject  |
       |         /              \              |
       |        v                v             |
       |   +----------+     +----------+       |
       +---| APPROVED |     | REJECTED | ------+
           +----------+     +----------+
           (Batch 3 only)
```

### 4.1 Ten Business Rules Enforced
1. **Independent Registration:** Worker profile creation functions independently without requiring prior partner affiliation or invitation.
2. **One Worker Profile Per User:** Enforced through database-level unique constraint on `worker_profiles(user_id)` and idempotent `getOrCreateProfile()`.
3. **Role Preservation:** Assigning the `WORKER` role preserves all pre-existing user roles (`CUSTOMER`, `PARTNER`, `ADMIN`) in `user_roles`.
4. **No Auto-Approval on Creation:** Profile creation initializes `submissionStatus = 'DRAFT'` and `approvalStatus = 'PENDING'`.
5. **Role Assignment $\ne$ Operational Approval:** Holding the `WORKER` role does not imply dispatch or operational eligibility until approved.
6. **Submission Lifecycle Lock:** When `submissionStatus` is `'SUBMITTED'` or `'UNDER_REVIEW'`, profile edits, skill additions, and skill removals are locked to prevent invalidating the review.
7. **Controlled Resubmission:** Rejected profiles (`REJECTED` or `ACTION_REQUIRED`) can be resubmitted via `resubmitOnboarding()`, which resets `approvalStatus = 'PENDING'`, clears `rejectionReason`, and transitions `submissionStatus = 'SUBMITTED'`.
8. **Admin-Exclusive Approval:** Onboarding services **never** set `approvalStatus = 'APPROVED'`. Approval remains strictly an admin workflow.
9. **Authenticated Tenant Scoping:** All operations are scoped to the authenticated `userId`.
10. **Cross-Worker Access Denial (IDOR):** Direct document access, streaming, or skill modification for another worker's resources is blocked with `403 ForbiddenError`.

---

## 5. Secure Document Lifecycle & Private Storage

Worker documents are stored through the unified private storage infrastructure (`LocalStorageService`):

1. **Approved Document Formats:** `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
2. **Binary Magic-Byte Sniffing:** Every upload is inspected using byte signatures to block MIME spoofing:
   - PDF: `%PDF` (`0x25 0x50 0x44 0x46`)
   - JPEG: `0xFF 0xD8 0xFF`
   - PNG: `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A`
   - WEBP: `RIFF` at offset 0, `WEBP` at offset 8
3. **File Size Enforcement:** Strictly rejects files exceeding 5MB ($5 \times 1024 \times 1024$ bytes).
4. **Collision-Resistant Private Keys:** Storage keys follow the pattern `workers/<timestamp>_<uuid>.<ext>`.
5. **Path Traversal Protection:** Resolved through `resolveSafePath` against the application base directory; relative references (`../`) are rejected.
6. **Anti-Orphan Rollback:** If database insertion fails after storage upload, the newly uploaded file is immediately cleaned up with `storage.deleteFile(storageKey)`.
7. **Additive Versioning:** Re-uploading a document type creates a new record; prior records remain immutable for historical and compliance audits.
8. **Secure Streaming:** Streams file content directly via `streamMyDocument()` without disclosing internal filesystem paths or raw storage keys.

---

## 6. Worker Skills & Qualifications

1. **Active Category Validation:** Verified against `service_categories` to ensure the category exists and `isActive = true`.
2. **Duplicate Prevention:** Enforces uniqueness per `(worker_id, service_category_id)` (`uq_worker_skill` constraint). Duplicate additions throw `409 ConflictError`.
3. **Verification State:** Initialized as `PENDING`. Unverified skills are never treated as approved or eligible.
4. **Audit History:** Verification reviewer and timestamp metadata are preserved in `reviewed_by` and `reviewed_at`.
5. **Lifecycle Removal Guards:** Skills cannot be removed while a profile is under review (`SUBMITTED`/`UNDER_REVIEW`) or after administrative approval without formal modification.

---

## 7. Test Verification & Baseline Comparison

### 7.1 Focused Batch 2 KYC Tests (`tests/phase6e-batch2-kyc.test.ts`)
```
PASS tests/phase6e-batch2-kyc.test.ts (8.031 s)
  Phase 6E Batch 2: Worker KYC Policy & Validation Service
    1. Policy Provider & Dimension Mappings (8 tests)
      √ should return baseline default rules when no params specified
      √ should configure HELPER requiring IDENTITY_PROOF
      √ should configure TECHNICIAN requiring IDENTITY_PROOF and SKILL_CERTIFICATE
      √ should configure SPECIALIST requiring IDENTITY_PROOF, SKILL_CERTIFICATE, and POLICE_VERIFICATION
      √ should support category-specific rules
      √ should support jurisdiction-specific rules
      √ should support composite rules (WorkerType + Category)
      √ should apply MOST RESTRICTIVE mandatory requirement when multiple policies conflict
    2. Fail-Closed Security Invariants (4 tests)
      √ should fail closed when policy provider is missing or null
      √ should fail closed when policy provider throws an exception
      √ should fail closed when policy provider returns null
      √ should fail closed when policy configuration is malformed or invalid
    3. Document Validation & Anti-Bypass Gate (7 tests)
      √ should report missing mandatory documents
      √ should validate verified latest documents successfully
      √ should fail validation when latest document is PENDING
      √ should fail validation when latest document is REJECTED
      √ ANTI-BYPASS: should evaluate ONLY latest document and NEVER fall back to older verified document
      √ ANTI-BYPASS: should fail if latest replacement was REJECTED even with older verified doc
      √ DETERMINISTIC ORDERING: should use ID DESC as tie-breaker when uploadedAt timestamps are identical
    4. Asia/Kolkata Expiry Rules & Warnings (3 tests)
      √ should fail validation with zero grace days when verified document is expired in Asia/Kolkata
      √ should issue warning 15 days before expiry when document is expiring soon
      √ should NOT flag warning when document has more than 15 days remaining
    5. Skill Verification Requirements (4 tests)
      √ should fail validation when a required skill category is missing
      √ should fail validation when a required skill is added but still PENDING
      √ should pass validation when required skill is VERIFIED and active
      √ should ignore inactive skills even if verified

Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total (100%)
```

### 7.2 Focused Batch 2 Onboarding Tests (`tests/phase6e-batch2-onboarding.test.ts`)
```
PASS tests/phase6e-batch2-onboarding.test.ts (9.376 s)
  Phase 6E Batch 2: Worker Onboarding & Document Management Service
    1. Worker Profile Lifecycle & Role Preservation (6 tests)
      √ should create independent worker profile and preserve existing CUSTOMER & PARTNER roles
      √ should be idempotent: calling getOrCreateProfile again returns existing profile
      √ should update draft profile fields successfully
      √ should reject dateOfBirth for underage worker (< 18 years old)
      √ should reject invalid worker type
      √ should return onboarding status overview
    2. Document Management & Magic-Byte Security (9 tests)
      √ should validate authentic PDF magic bytes successfully
      √ should validate authentic JPEG magic bytes successfully
      √ should validate authentic PNG magic bytes successfully
      √ should validate authentic WEBP magic bytes successfully
      √ should reject spoofed file content where MIME declared does not match binary magic bytes
      √ should reject oversized file upload (> 5MB)
      √ should upload valid worker document to private storage and create DB record
      √ should support ADDITIVE replacement of document without overwriting previous history
      √ should securely stream worker document and enforce IDOR protection against cross-worker access
    3. Skills & Qualifications Management (6 tests)
      √ should add a service category skill in PENDING status
      √ should reject duplicate active skill for the same worker and category
      √ should reject adding a skill with invalid or non-existent service category
      √ should list all skills for authenticated worker
      √ should allow removing a skill in draft lifecycle
      √ should block removing another worker skill (IDOR protection)
    4. Submission & Resubmission Lifecycle (5 tests)
      √ should block submission if mandatory KYC documents are missing
      √ should submit onboarding when profile is complete and transition status to SUBMITTED
      √ LIFECYCLE LOCK: should block profile modifications while SUBMITTED (under review)
      √ LIFECYCLE LOCK: should block duplicate submission while already SUBMITTED
      √ should support controlled resubmission when rejected

Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total (100%)
```

### 7.3 Phase 6E Batch 1 Repositories Tests (`tests/phase6e-repositories.test.ts`)
- **46 passed, 46 total (100%)**.

### 7.4 Phase 6D Driver Regression Suite (`tests/phase6d-*.test.ts`)
- **220 passed, 220 total across 7 test suites (100%)**.

### 7.5 Full Backend Regression Suite (`npm test -- --runInBand`)
```
Test Suites: 18 passed, 18 total
Tests:       468 passed, 468 total (100%)
Snapshots:   0 total
Time:        43.251 s
```

### 7.6 Test Count Comparison Matrix
| Milestone / Test Suite | Previous Baseline | Phase 6E Batch 2 Result | Delta |
| :--- | :--- | :--- | :--- |
| **Phase 6D Driver Suite** | 220 tests | 220 tests | 0 |
| **Phase 6E Batch 1 Repositories** | 46 tests | 46 tests | 0 |
| **Phase 6E Batch 2 KYC Policy** | 0 tests | 26 tests | +26 |
| **Phase 6E Batch 2 Onboarding** | 0 tests | 26 tests | +26 |
| **Phase 6E Subsystem Total** | 46 tests | **98 tests** | **+52** |
| **Full Backend Regression Suite** | 416 tests | **468 tests** | **+52** |

---

## 8. Build, Schema & Migration Status

1. **TypeScript Compilation:**
   ```bash
   npm run build
   # Exited with code 0 (0 errors)
   ```
2. **Prisma Schema Validation:**
   ```bash
   npx prisma validate
   # The schema at prisma\schema.prisma is valid 🚀
   ```
3. **Migration Status:**
   - **No new migration required.** The existing Migration 015 (`015_worker_management_foundation.sql`) fully accommodates all entity models, relationships, check constraints, and indexes required for Batch 2.

---

## 9. Known Limitations & Next Steps

1. **Administrative Approval:** Administrative document verification, skill approval, and worker profile activation/rejection/suspension workflows remain strictly reserved for Batch 3.
2. **Partner Affiliations & Invitations:** Partner-worker invitations and consent workflows will be implemented in Batch 4.
3. **Real-time Duty & Availability:** Dispatch matching and geo-availability workflows will be implemented in Batch 5.
4. **HTTP Controllers & Routes:** HTTP presentation endpoints for worker onboarding will be authored alongside the administrative API endpoints in Batch 3.
