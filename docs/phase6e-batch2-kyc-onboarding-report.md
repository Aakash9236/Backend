# Phase 6E — Batch 2 Implementation Report: Worker KYC Policy & Onboarding Service

**Date:** 2026-11-20  
**Phase:** 6E — Worker Management  
**Batch:** 2 of 5 (Authorized Scope: Worker KYC Policy & Onboarding Service)  
**Status:** Complete & Fully Verified  

---

## 1. Executive Summary & Authorization Scope

In accordance with Phase 6E specifications, **Batch 2** has been implemented. This sub-milestone delivers the complete KYC policy engine, fail-closed validation service, and worker onboarding domain service for the multi-city services marketplace backend.

### Strict Scope Boundary
- **Implemented in Batch 2:**
  - `WorkerKycRule`, `IWorkerKycPolicyProvider`, `DefaultWorkerKycPolicyProvider`, and `WorkerKycValidationService` in `src/modules/workers/services/worker-kyc.service.ts`.
  - `WorkerOnboardingService` and `validateFileMagicBytes` in `src/modules/workers/services/worker-onboarding.service.ts`.
  - Service DTOs and API contract interfaces in `src/modules/workers/workers.types.ts`.
  - Deterministic latest-document repository ordering (`[{ uploadedAt: 'desc' }, { id: 'desc' }]`) in `WorkerDocumentRepository`.
  - Full test suites: `tests/phase6e-worker-kyc.test.ts` (24 tests) and `tests/phase6e-worker-onboarding.test.ts` (37 tests).
- **Deferred to Later Batches (Out of Scope for Batch 2):**
  - Batch 3: Worker Invitations, Affiliations, and Availability Workflows.
  - Batch 4: Worker Administrative Verification, Approval & Multi-Role Status Integration.
  - Batch 5: HTTP Controllers, Routes, Swagger/OpenAPI docs & Final Verification.

---

## 2. Architecture & Technical Design

### 2.1 Configurable Fail-Closed Worker KYC Policy Engine

The Worker KYC policy system is decoupled from driver logistics rules and explicitly models trades and on-demand home/field service workers.

#### Policy Baselines by Worker Type (`WorkerType`)
1. **HELPER** (Unskilled / General manual assistance):
   - Mandatory Documents: `IDENTITY_PROOF`, `PROFILE_PHOTO`.
   - Optional Documents: `POLICE_VERIFICATION`, `ADDRESS_PROOF`, `MEDICAL_FITNESS`.
   - Minimum Experience: 0 years.
2. **TECHNICIAN** (Skilled trades: Electrical, Plumbing, HVAC, Appliance repair):
   - Mandatory Documents: `IDENTITY_PROOF`, `PROFILE_PHOTO`, `SKILL_CERTIFICATE`, `POLICE_VERIFICATION`.
   - Optional Documents: `ADDRESS_PROOF`, `MEDICAL_FITNESS`.
   - Minimum Experience: 1 year.
   - Requirements: `requiresSkillCertificate = true`, `requiresPoliceVerification = true`.
3. **SPECIALIST** (Master trades / High liability / Commercial services):
   - Mandatory Documents: `IDENTITY_PROOF`, `PROFILE_PHOTO`, `SKILL_CERTIFICATE`, `POLICE_VERIFICATION`, `MEDICAL_FITNESS`.
   - Optional Documents: `ADDRESS_PROOF`.
   - Minimum Experience: 3 years.
   - Requirements: `requiresSkillCertificate = true`, `requiresPoliceVerification = true`, `requiresMedicalFitness = true`.

#### Multi-Policy Conflict Resolution (Most Restrictive Mandatory Rule)
Workers often match multiple dimensions simultaneously (e.g. `workerType === 'TECHNICIAN'`, `serviceCategoryCode === 'HIGH_VOLTAGE'`, and `jurisdiction === 'BENGALURU'`). `DefaultWorkerKycPolicyProvider.getRulesForWorker()` resolves conflicts deterministically by merging matching policies into the most restrictive requirement set:
- **Mandatory Documents:** Union of all `requiredDocumentTypes` across matching rules.
- **Optional Documents:** Set difference (optional docs that are not required by any matching rule).
- **Required Skills:** Union of `requiredVerifiedSkillCategories`.
- **Minimum Experience:** $\max(\text{minExperienceYears})$ across all matching rules.
- **Boolean Flags:** Set to `true` if any matching rule mandates them (`requiresPoliceVerification`, `requiresSkillCertificate`, `requiresMedicalFitness`), automatically elevating corresponding document types to mandatory.

#### Security Invariants: Fail-Closed Gate & Anti-Bypass
1. **Fail-Closed Gate:** If the policy provider is missing, returns `null` without a default rule, returns an invalid schema (e.g. `requiredDocumentTypes` is not an array), or throws an unexpected error, `WorkerKycValidationService.validateForApproval()` immediately fails closed (`isValid: false`) with a secure error reason.
2. **Anti-Bypass Gate:** For each required document type, documents are sorted strictly by `uploadedAt DESC, id DESC`. Validation evaluates **only the latest document record**. If a worker uploads a replacement document whose status is `PENDING` or `REJECTED`, validation fails immediately; it **never** falls back to older verified documents.
3. **Asia/Kolkata Calendar Expiry:** Evaluated strictly in the `Asia/Kolkata` timezone (+05:30) via `DateUtil.evaluateCalendarExpiry`:
   - Valid throughout the entire calendar day of expiry until `23:59:59.999 IST`.
   - Expired immediately at `00:00:00.000 IST` of the following calendar day (zero grace period).
   - Verified documents within 15 calendar days of expiry emit a non-blocking `DOCUMENT_EXPIRING_SOON` warning flag.
4. **Deterministic Tie-Breaking:** If two document uploads share an identical `uploadedAt` timestamp, ties are broken deterministically by primary key `id DESC`.

---

### 2.2 Worker Onboarding Service Architecture

`WorkerOnboardingService` handles the lifecycle of worker profiles, documents, and skills while maintaining multi-role preservation and multi-tenant isolation.

```
+-------------------------------------------------------------------------------+
|                           WorkerOnboardingService                             |
+-------------------------------------------------------------------------------+
       |                               |                              |
       v                               v                              v
[WorkerProfileRepo]          [WorkerDocumentRepo]             [WorkerSkillRepo]
 - getOrCreateProfile         - uploadDocument (workers/)      - addSkill
 - getMyProfile               - replaceDocument (additive)     - listMySkills
 - updateMyProfile            - listMyDocuments (isLatest)     - removeSkill (IDOR)
 - submitOnboarding           - getDocumentStatus (IDOR)              |
 - resubmitOnboarding         - streamMyDocument (IDOR)               v
 - getOnboardingStatus                 |                   [Prisma: ServiceCategory]
       |                               v
       |                    [StorageService: Local]
       v                     - magic-byte validation
[WorkerKycValidationService] - anti-orphan rollback
 - fail-closed gate
 - anti-bypass latest doc
 - Asia/Kolkata expiry
```

#### Core Capabilities & Lifecycle Rules
1. **Independent Registration & Role Preservation:**
   - A worker registers using mobile number + OTP.
   - `getOrCreateProfile(userId)` creates a single `WorkerProfile` (`submissionStatus = 'DRAFT'`, `approvalStatus = 'PENDING'`).
   - Ensures the `WORKER` role is assigned in `user_roles` without disrupting existing `CUSTOMER`, `PARTNER`, `DRIVER`, or `ADMIN` roles.
   - Strictly idempotent: repeated calls return the existing profile.
2. **Draft Profile Mutations & Locking:**
   - Profile updates (`updateMyProfile`) validate age (18 to 80 years), experience (0 to 60 years), gender, and worker type.
   - Edits are locked when `submissionStatus` is `SUBMITTED` or `UNDER_REVIEW`, or when `suspendedAt` is present.
   - Approved profiles cannot be edited directly via onboarding (requires administrative workflow).
3. **Strict Submission Lifecycle:**
   - `submitOnboarding`: Validates profile completeness and runs pre-submission KYC validation. If mandatory documents are missing, rejects submission with `ValidationError`.
   - Transitions `submissionStatus` from `DRAFT` to `SUBMITTED` and records `submittedAt`.
   - **Crucial Rule:** The onboarding service **NEVER** auto-approves a worker (`approvalStatus` strictly remains `PENDING`). Approval is reserved exclusively for Admin Verification (Batch 4).
   - `resubmitOnboarding`: Permitted only when `approvalStatus === 'REJECTED'` or `submissionStatus === 'ACTION_REQUIRED'`. Resets `submissionStatus = 'SUBMITTED'`, `approvalStatus = 'PENDING'`, and clears `rejectionReason`.
4. **Secure Document Lifecycle & Anti-Orphan Storage:**
   - Supported document types: `IDENTITY_PROOF`, `PROFILE_PHOTO`, `POLICE_VERIFICATION`, `ADDRESS_PROOF`, `SKILL_CERTIFICATE`, `MEDICAL_FITNESS`, `OTHER`.
   - Supported MIME formats: PDF, JPEG, PNG, WEBP.
   - **Magic-Byte Content Inspection (`validateFileMagicBytes`):** Inspects binary signatures (`%PDF`, `0xFF 0xD8 0xFF`, `0x89 0x50 0x4E 0x47`, `RIFF...WEBP`) to reject MIME-spoofed files (e.g. executables or scripts renamed as `.pdf`).
   - Maximum file size: 5MB (`MAX_WORKER_DOCUMENT_SIZE_BYTES`).
   - Private storage namespace: Saved in isolated `workers/` subfolder.
   - **Anti-Orphan Rollback:** If database insertion fails after physical upload, `storageService.deleteFile(storageKey)` is called immediately to prevent storage leaks.
   - **Additive Document History:** Uploading a replacement creates a new record. Older document records remain in the database for audit and compliance trails.
5. **Skills Management:**
   - Workers link trade qualifications to active `service_categories` via `addSkill`.
   - Enforces unique constraint (`workerId`, `serviceCategoryId`), preventing duplicate skill records (`ConflictError`).
   - Newly added skills default to `verificationStatus = 'PENDING'`.
   - Workers can list their skills (`listMySkills`) and remove skills (`removeSkill`).
6. **Cross-Tenant Isolation & IDOR Protection:**
   - `streamMyDocument`, `getDocumentStatus`, and `removeSkill` enforce strict worker ownership (`resource.workerId === profile.id`).
   - Unauthorized attempts by another user immediately throw `ForbiddenError`.
   - Never exposes internal physical filesystem paths or raw storage keys in responses or error messages.

---

## 3. Test Suites & Verification Results

### 3.1 New Test Suites Authored for Batch 2
1. **`tests/phase6e-worker-kyc.test.ts` (24 Tests)**
   - **Policy Provider & Baselines (6 tests):** Baseline default rules, HELPER baseline, TECHNICIAN baseline (skill cert + police verification), SPECIALIST baseline (medical fitness + 3 yrs exp), composite rules (`TECHNICIAN:ELECTRICAL`), and most-restrictive rule merging.
   - **Fail-Closed Security Gates (4 tests):** Missing provider, throwing provider, null policy specification, non-array `requiredDocumentTypes`.
   - **Anti-Bypass Mandatory Document Evaluation (5 tests):** Missing documents rejection, alias matching (`AADHAAR`, `PAN`, `VOTER_ID`, `PASSPORT`), latest-document evaluation (`uploadedAt DESC, id DESC`), rejected latest doc rejection, deterministic tie-breaking by ID.
   - **Asia/Kolkata Calendar Expiry & 15-Day Warning (3 tests):** Valid throughout calendar day in IST, expired at 00:00:00 IST next day, `DOCUMENT_EXPIRING_SOON` warning within 15 days.
   - **Skill & Qualification Validation (3 tests):** Missing required skill category, pending skill verification rejection, verified skill acceptance.
   - **Experience Years Validation (2 tests):** Shortfall calculation and rejection, passing when threshold met.
   - **Repository Integration (1 test):** Non-existent worker ID fail-closed handling.

2. **`tests/phase6e-worker-onboarding.test.ts` (37 Tests)**
   - **Profile Creation & Idempotency (4 tests):** DRAFT/PENDING initialization, idempotent calls without duplicate profiles, multi-role preservation (`CUSTOMER` retained, `WORKER` added), 404 for non-existent user.
   - **Profile Updates & Field Validation (6 tests):** Field updates in DRAFT, minimum age 18 rejection, negative/excessive experience rejection, invalid `workerType` rejection, invalid gender rejection, whitespace-only first name rejection.
   - **Skills Management (6 tests):** Adding skill linked to service category, duplicate skill prevention, non-existent category 404, listing worker skills, IDOR protection against other users deleting skills, self-removal of skills.
   - **Document Upload & Magic-Byte Security (11 tests):** Authentic PDF, JPEG, PNG, WEBP verification; MIME spoofing rejection; MIME mismatch rejection; unsupported document types rejection; oversized file (>5MB) rejection; valid document uploads; anti-orphan storage cleanup on DB failure; additive history preservation.
   - **Submission Lifecycle Transitions (6 tests):** DRAFT -> SUBMITTED transition without auto-approval, duplicate submission rejection, profile edit locking while SUBMITTED, rejection of invalid resubmission, resubmission after administrative rejection, operational status calculation.
   - **Cross-User Isolation & Secure Streaming (4 tests):** Owner document streaming, IDOR blocking for unauthorized users on streaming and status checks, 404 for non-existent documents.

### 3.2 Verification Results Summary

| Test Suite | Total Tests | Passed | Failed | Status |
| :--- | :---: | :---: | :---: | :---: |
| `phase6e-worker-kyc.test.ts` | 24 | 24 | 0 | **PASS** |
| `phase6e-worker-onboarding.test.ts` | 37 | 37 | 0 | **PASS** |
| `phase6e-repositories.test.ts` (Batch 1) | 46 | 46 | 0 | **PASS** |
| **All Phase 6E Tests Combined** | **107** | **107** | **0** | **PASS** |
| **Phase 6D Regression Suites (7 suites)** | **220** | **220** | **0** | **PASS** |
| **Full Project Regression Test Suite (18 suites)** | **477** | **477** | **0** | **PASS** |

### 3.3 Build & Schema Validation
- `npm run build` (`tsc`): Executed with exit code `0` (Zero compiler errors or warnings).
- `npx prisma validate`: Schema at `prisma/schema.prisma` is valid and in sync.

---

## 4. Deliverables & File Changes

```
Backend/
├── src/
│   └── modules/
│       └── workers/
│           ├── index.ts                                   # Exported services & types
│           ├── workers.types.ts                           # Service DTOs & response schemas
│           ├── repositories/
│           │   └── worker-document.repository.ts          # Deterministic ordering [{ uploadedAt: 'desc' }, { id: 'desc' }]
│           └── services/
│               ├── worker-kyc.service.ts                  # [NEW] Worker KYC policy engine & validation service
│               └── worker-onboarding.service.ts           # [NEW] Worker onboarding, doc upload, skills service
├── tests/
│   ├── phase6e-worker-kyc.test.ts                        # [NEW] 24 unit & integration tests for Worker KYC
│   └── phase6e-worker-onboarding.test.ts                 # [NEW] 37 integration tests for Worker Onboarding
└── docs/
    └── phase6e-batch2-kyc-onboarding-report.md           # [NEW] Batch 2 implementation & verification report
```

---

## 5. Readiness for Batch 3

Phase 6E Batch 2 is complete, verified, and adheres strictly to authorized scope boundaries. All 477 tests across the entire backend pass with 100% regression safety.

The system is ready for authorization to proceed to:
**Phase 6E, Batch 3: Worker Invitations, Affiliations, and Availability Workflows**.
