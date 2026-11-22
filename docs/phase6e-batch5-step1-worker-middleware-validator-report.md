# Phase 6E — Batch 5 — Step 1: Worker Middleware & Validation Layer Implementation Report

**Execution Date:** 2026-11-22  
**Module:** Worker Management (`src/modules/workers`)  
**Phase:** 6E — Batch 5 — Step 1: Middleware & Validator Layer  
**Boundary Adherence:** STEP 1 ONLY (Zero controllers, routes, route registrations, Swagger files, schema changes, or business logic alterations)  
**Verification Results:**
- `tests/phase6e-batch5-step1-middleware-validators.test.ts`: **49/49 Passed** (100%)
- `tests/auth.test.ts` (Existing Authentication & RBAC Regression): **19/19 Passed** (100%)
- TypeScript Build (`npm run build`): **0 errors (Exit code 0)**
- Prisma Schema Validation (`npx prisma validate`): **Valid 🚀**

---

## 1. Summary of Changes

### 1.1 Files Created
1. **[`src/modules/workers/workers.validator.ts`](file:///c:/Users/DELL/OneDrive/Desktop/BackendFIle/Backend/src/modules/workers/workers.validator.ts)**
   - Authoritative Zod validation schemas and TypeScript DTO types mapping directly to the actual inputs accepted by `WorkerOnboardingService`, `WorkerInvitationService`, `WorkerAffiliationService`, `WorkerAvailabilityService`, and `WorkerAdminGovernanceService`.
   - Reusable query-string parsing and bounding schemas for pagination and filter options.
2. **[`src/modules/workers/workers.middleware.ts`](file:///c:/Users/DELL/OneDrive/Desktop/BackendFIle/Backend/src/modules/workers/workers.middleware.ts)**
   - Express Request augmentation declaring `req.workerProfile?: WorkerProfile`.
   - `requireWorkerProfile`: Resolves profile strictly via authenticated `req.user.userId`.
   - `requireApprovedWorker`: Enforces approval status, blocking pending, rejected, or suspended workers.
   - `requireOperationalWorker`: Verifies approved worker status and active root user account without duplicating the availability service's dynamic KYC evaluation.
3. **[`tests/phase6e-batch5-step1-middleware-validators.test.ts`](file:///c:/Users/DELL/OneDrive/Desktop/BackendFIle/Backend/tests/phase6e-batch5-step1-middleware-validators.test.ts)**
   - 49 focused unit and integration test cases covering auth helpers, Zod validation schemas, and worker middlewares.
4. **[`docs/phase6e-batch5-step1-worker-middleware-validator-report.md`](file:///c:/Users/DELL/OneDrive/Desktop/BackendFIle/Backend/docs/phase6e-batch5-step1-worker-middleware-validator-report.md)**
   - This documentation report.

### 1.2 Files Modified
1. **[`src/common/middlewares/auth.middleware.ts`](file:///c:/Users/DELL/OneDrive/Desktop/BackendFIle/Backend/src/common/middlewares/auth.middleware.ts)**
   - Added and exported dedicated worker role helpers:
     - `export const requireWorker = requireRole(UserRole.WORKER);`
     - `export const requireActiveWorker = requireActiveRole(UserRole.WORKER);`
   - Preserves 100% backward compatibility with all existing session, JWT, and RBAC mechanisms.
2. **[`src/modules/workers/index.ts`](file:///c:/Users/DELL/OneDrive/Desktop/BackendFIle/Backend/src/modules/workers/index.ts)**
   - Re-exported `workers.validator` and `workers.middleware`.

---

## 2. Authentication Helper Behavior

In [`src/common/middlewares/auth.middleware.ts`](file:///c:/Users/DELL/OneDrive/Desktop/BackendFIle/Backend/src/common/middlewares/auth.middleware.ts):
- **`requireWorker`:**
  - Invokes `requireRole(UserRole.WORKER)`.
  - Verifies that `req.user.roles` contains `UserRole.WORKER`.
  - Rejects missing authentication with `UnauthorizedError` (401).
  - Rejects unauthorized users with `ForbiddenError` (403): `"Access forbidden: You do not have the required role (WORKER) to perform this action."`.
- **`requireActiveWorker`:**
  - Invokes `requireActiveRole(UserRole.WORKER)`.
  - Verifies that `req.user.activeRole === UserRole.WORKER` and that the user holds the worker role in their assigned roles array.
  - Rejects tokens lacking an active role with `UnauthorizedError` (401).
  - Rejects requests under a non-worker active context (e.g. `CUSTOMER` or `PARTNER`) with `ForbiddenError` (403), prompting role-switch.

---

## 3. Worker Middleware Architecture

In [`src/modules/workers/workers.middleware.ts`](file:///c:/Users/DELL/OneDrive/Desktop/BackendFIle/Backend/src/modules/workers/workers.middleware.ts):

### 3.1 `requireWorkerProfile`
- **Identity Isolation:** Reads the authenticated user ID exclusively from `req.user.userId`.
- **Anti-IDOR:** Never inspects or trusts client-supplied query, param, or body IDs for self-identity resolution.
- **Cache / Request Optimization:** If `req.workerProfile` is already resolved (e.g. from upstream middleware), skips redundant database queries and calls `next()`.
- **Error Behavior:** If no worker profile exists, throws `NotFoundError('Worker profile not found. Please complete initial onboarding.')`.
- **Attachment:** Attaches the resolved Prisma `WorkerProfile` instance to `req.workerProfile`.

### 3.2 `requireApprovedWorker`
- **Prerequisite:** Invokes `requireWorkerProfile` if `req.workerProfile` has not yet been resolved.
- **Suspension Guard:** Rejects workers with `ForbiddenError` if `approvalStatus === 'SUSPENDED'` or `suspendedAt !== null`.
- **Rejection Guard:** Rejects workers with `ForbiddenError` if `approvalStatus === 'REJECTED'`.
- **Pending Review Guard:** Rejects workers with `ForbiddenError` if `approvalStatus !== 'APPROVED'` (`"Worker onboarding application is under review. Operational actions require approval."`).
- **Purity:** Does not mutate worker database records.

### 3.3 `requireOperationalWorker`
- **Readiness Gate:** Verifies `requireApprovedWorker`.
- **Identity Consistency:** Queries `prisma.user` to confirm `user.accountStatus === 'ACTIVE'`. If the root user account is `BLOCKED` or `DELETED`, throws `ForbiddenError`.
- **Architectural Boundary Adherence:** In strict adherence to prompt requirements, this middleware **does NOT duplicate** the availability service's dynamic KYC document expiry or geographic boundary rules. The existing `WorkerAvailabilityService.goOnline` remains the single source of truth for online operational transitions.

---

## 4. Zod Validator Inventory & Schema Rules

In [`src/modules/workers/workers.validator.ts`](file:///c:/Users/DELL/OneDrive/Desktop/BackendFIle/Backend/src/modules/workers/workers.validator.ts):

| Schema Name | Target Endpoint / Use Case | Validated Fields & Constraints | Anti-Bypass / Security Measures |
| :--- | :--- | :--- | :--- |
| `updateWorkerProfileSchema` | Worker profile self-service (`PUT /me`) | `firstName` (2-100 chars), `lastName` (max 100), `dateOfBirth` (YYYY-MM-DD), `gender` (`MALE`, `FEMALE`, `OTHER`), `bio` (max 1000), `experienceYears` (int 0-60), `workerType` (`HELPER`, `TECHNICIAN`, `SPECIALIST`), `primaryCityId` (string or positive int). | `.strict()`: Client-supplied privileged fields (`userId`, `approvalStatus`, `submissionStatus`, `suspendedAt`, `reviewedBy`) are rejected. |
| `uploadWorkerDocumentSchema` | Document metadata (`POST /me/documents`) | `documentType` (`IDENTITY_PROOF`, `PROFILE_PHOTO`, `POLICE_VERIFICATION`, `ADDRESS_PROOF`, `SKILL_CERTIFICATE`, `MEDICAL_FITNESS`, `OTHER`), `documentNumber` (max 100), `expiryDate` (YYYY-MM-DD). | `.strict()`: File binary validation is delegated to multer and service magic-byte inspector. Storage paths/keys are rejected. |
| `addWorkerSkillSchema` | Skill registration (`POST /me/skills`) | `serviceCategoryId` (required string or positive int), `experienceYears` (int 0-60). | `.strict()` |
| `createWorkerInvitationSchema` | Partner invitation (`POST /partners/workers/invitations`) | `invitedMobile` (required, matches `/^\+91[6-9]\d{9}$/`), `workerName` (max 150), `proposedRole` (max 50), `notes` (max 500). | `.strict()`: Rejects malformed numbers and prevents arbitrary field injections. |
| `revokeWorkerInvitationSchema` | Partner invitation revocation | `reason` (required, 1-500 chars). | `.strict()` |
| `acceptWorkerInvitationSchema` | Worker accepts invitation | `notes` (optional, max 500). | `.strict()` |
| `rejectWorkerInvitationSchema` | Worker rejects invitation | `reason` (optional, max 500). | `.strict()` |
| `lookupWorkerInvitationSchema` | Public invitation inspection (body) | `token` (required, 16-128 chars). | `.strict()`: Validates token string bounds safely without logging tokens. |
| `terminateAffiliationSchema` | Affiliation termination (Worker / Partner) | `reason` (required, 1-500 chars). | `.strict()` |
| `updateDutyStatusSchema` | Duty status toggle (`POST /me/duty-status`) | `isOnline` (required boolean), `latitude` (-90 to 90, optional), `longitude` (-180 to 180, optional). | `.strict()`: Worker ID cannot be supplied in body. |
| `workerHeartbeatSchema` | Worker heartbeat (`POST /me/heartbeat`) | `latitude` (-90 to 90, optional), `longitude` (-180 to 180, optional). | `.strict()`: Worker ID cannot be supplied in body. |
| `adminRejectWorkerSchema` | Administrative worker rejection | `reason` (required, 1-1000 chars). | `.strict()` |
| `adminSuspendWorkerSchema` | Administrative worker suspension | `reason` (required, 1-1000 chars). | `.strict()` |
| `adminRejectDocumentSchema` | Administrative document rejection | `reason` (required, 1-1000 chars). | `.strict()` |
| `adminRejectSkillSchema` | Administrative skill rejection | `reason` (required, 1-1000 chars). | `.strict()` |
| `paginationQuerySchema` | Reusable query pagination | `page` (int, positive, default 1), `limit` (int, positive, max 100, default 20). | Coerces strings to integers with safe defaults and caps. |
| `workerApplicationFilterQuerySchema` | Admin application review query | `page`, `limit`, `approvalStatus` (enum), `submissionStatus` (enum), `workerType` (enum), `primaryCityId` (string), `search` (max 100), `isActive` (boolean). | Strict enum validation; safe boolean preprocessing. |
| `workerInvitationFilterQuerySchema` | Partner invitation query | `page`, `limit`, `status` (enum). | Strict enum validation. |

---

## 5. Automated Test Results

### 5.1 Focused Test Suite: `tests/phase6e-batch5-step1-middleware-validators.test.ts`
- **Total Tests:** 49
- **Passing:** 49
- **Failing:** 0
- **Duration:** ~9.8s

**Detailed Test Group Breakdown:**
1. **Authentication Helpers:**
   - `requireWorker` calls `next()` when user holds `WORKER` role.
   - `requireWorker` throws `ForbiddenError` when user lacks `WORKER` role.
   - `requireWorker` throws `UnauthorizedError` when `req.user` is absent.
   - `requireActiveWorker` calls `next()` when active role is `WORKER`.
   - `requireActiveWorker` throws `ForbiddenError` when active role is not `WORKER`.
   - `requireActiveWorker` throws `UnauthorizedError` when active role is missing.
2. **Worker Zod Validators:**
   - Valid profile payload passes; invalid workerType, invalid gender, negative experience, and excessive experience (>60) fail.
   - Privileged fields (`userId`, `approvalStatus`, etc.) rejected under `.strict()`.
   - Valid document metadata passes; invalid documentType and invalid expiry format fail.
   - Valid skill payload passes; negative experience and missing category ID fail.
   - Invitation schemas: valid Indian mobile passes; invalid mobile format fails; mandatory revocation reason enforced; token length bounds validated.
   - Affiliation termination: non-empty trimmed reason enforced.
   - Availability & heartbeat: boolean `isOnline` validated; out-of-bounds latitude/longitude rejected; optional coordinates accepted.
   - Admin governance: non-empty trimmed reasons enforced for worker rejection, suspension, document rejection, and skill rejection.
   - Pagination & filters: default page=1, limit=20; non-positive page rejected; limit > 100 capped/rejected.
3. **Worker Middleware:**
   - `requireWorkerProfile` throws `UnauthorizedError` on missing `req.user`.
   - `requireWorkerProfile` throws `NotFoundError` when profile does not exist.
   - `requireWorkerProfile` resolves and attaches `req.workerProfile`.
   - `requireWorkerProfile` skips database lookup when profile is already attached.
   - `requireApprovedWorker` rejects `PENDING` workers with `ForbiddenError`.
   - `requireApprovedWorker` rejects `REJECTED` workers with `ForbiddenError`.
   - `requireApprovedWorker` rejects `SUSPENDED` workers with `ForbiddenError`.
   - `requireApprovedWorker` passes `APPROVED` non-suspended workers.
   - `requireOperationalWorker` rejects workers whose root user account is `BLOCKED`.
   - `requireOperationalWorker` passes `APPROVED` workers whose user account is `ACTIVE`.
   - `requireOperationalWorker` rejects unapproved workers prior to user check.

### 5.2 Existing Auth Regression: `tests/auth.test.ts`
- **Total Tests:** 19
- **Passing:** 19
- **Failing:** 0
- Confirms zero regressions in existing OTP, session lifecycle, token refresh, or RBAC guards.

---

## 6. Verification Commands

```powershell
# 1. Focused test suite
npx jest tests/phase6e-batch5-step1-middleware-validators.test.ts --runInBand
# Result: 49 passed, 49 total

# 2. Existing auth regression
npx jest tests/auth.test.ts --runInBand
# Result: 19 passed, 19 total

# 3. TypeScript compilation
npm run build
# Result: Exit code 0 (0 errors)

# 4. Prisma schema validation
npx prisma validate
# Result: The schema at prisma\schema.prisma is valid 🚀
```

---

## 7. Compliance Checklist

- [x] Implemented worker authentication helper exports in `src/common/middlewares/auth.middleware.ts` (`requireWorker`, `requireActiveWorker`).
- [x] Implemented `src/modules/workers/workers.validator.ts` covering all required groups.
- [x] Implemented `src/modules/workers/workers.middleware.ts` (`requireWorkerProfile`, `requireApprovedWorker`, `requireOperationalWorker`).
- [x] Authored and passed 49 focused tests.
- [x] Zero controllers implemented.
- [x] Zero routes implemented.
- [x] Zero route registrations modified.
- [x] Zero Swagger documentation created/modified.
- [x] Zero changes to existing Batch 1–4 services or repositories.
- [x] Zero changes to database schema or migrations.
- [x] **STOPPED after Step 1. Step 2 has NOT been started.**
