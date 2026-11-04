# Phase 6: Final Security & Business Logic Audit Report

**Date**: November 4, 2026  
**Auditor**: Senior Backend Architect & Security Engineer  
**Scope**: User Management, Customer Profiles, Partner Onboarding, Document Management, Admin Approvals  
**Status**: Comprehensive Read-Only Audit Completed (Zero Code / Schema Modifications Made)

---

## 1. Executive Summary

This audit evaluates the security architecture, data integrity, access controls, and business logic across all modules implemented in **Phase 6**. 

While foundational functionalities (User Profile CRUD, Address Management with coordinates/default uniqueness, Customer Profiles, Document Upload storage abstraction, Admin RBAC, Audit Logging, and Self-Approval Prevention) are implemented and backed by 62 passing automated tests, **two significant business-logic and transactional integrity gaps** and **one missing capability** were identified:

1. **Check 1 (KYC Verification Before Approval)**: Admins can approve partner profiles without verifying mandatory KYC documents, and no mandatory document policy is currently enforced in `AdminService.approvePartner`.
2. **Check 2 (Suspension & Partner Access Revocation)**: Suspending an approved partner updates `partner_profiles.approvalStatus = 'SUSPENDED'`, but does not invalidate partner tokens/sessions, and partner-facing endpoints (`/skills`, `/service-areas`, `/profile`) do not check `approvalStatus === 'APPROVED'`.
3. **Check 3 (KYC Document Security)**: Storage is safe and private (no public static route, randomized keys, path traversal protection), but a dedicated, authorized KYC document download/streaming endpoint has not yet been implemented for admins to inspect uploaded files.
4. **Transactional Integrity**: Multi-step admin status mutations and audit log insertions are executed sequentially without atomic database transactions (`prisma.$transaction`).

---

## 2. Check 1 — KYC Verification Before Partner Approval

### Status: **FAIL / BUSINESS-RULE GAP**

### Implementation Evidence
- **File**: [`src/modules/admin/admin.service.ts`](file:///c:/Users/baps/Desktop/Backend/src/modules/admin/admin.service.ts)
- **Function**: `AdminService.approvePartner(adminUserIdStr, partnerIdStr, context)` (Lines 30–72)
- **File**: [`src/modules/admin/admin.repository.ts`](file:///c:/Users/baps/Desktop/Backend/src/modules/admin/admin.repository.ts)
- **Function**: `AdminRepository.updatePartnerStatus(partnerId, data)` (Lines 94–112)

### Inspection Analysis
In `AdminService.approvePartner`:
```typescript
const partner = await this.repo.findPartnerDetailById(partnerId);
if (!partner) throw new NotFoundError('Partner profile not found.');

if (partner.userId === adminUserId) {
  throw new ForbiddenError('Administrators cannot review or approve their own partner profile.');
}
if (partner.approvalStatus === 'APPROVED') {
  throw new BadRequestError('Partner is already in APPROVED status.');
}

const updated = await this.repo.updatePartnerStatus(partnerId, {
  status: 'APPROVED',
  reason: null,
  adminUserId,
});
```

1. **Document Check Missing**: The service retrieves `partner.documents` via `findPartnerDetailById`, but executes **zero checks** on the presence or status of documents.
2. **Missing Mandatory Document Policy**: The codebase does not define which document types are mandatory for an `INDIVIDUAL` partner vs. a `BUSINESS` partner (e.g. `AADHAAR` + `PAN` for individuals; `GST_CERTIFICATE` + `PAN` for businesses).
3. **Premature Approval Permitted**: An admin can approve a partner whose KYC documents are `PENDING`, `REJECTED`, or completely un-uploaded (0 documents).
4. **Transaction Safety**: `updatePartnerStatus` and `createAuditLog` are separate queries without a wrapping transaction.

### Test Scenarios Executed

| Scenario | Expected Result | Actual Result | Evaluation |
|---|---|---|---|
| All mandatory documents verified | Approval allowed | Approval allowed (200 OK) | As Expected |
| One mandatory document pending | Approval blocked (400) | Approval allowed (200 OK) | **FAIL** |
| One mandatory document rejected | Approval blocked (400) | Approval allowed (200 OK) | **FAIL** |
| Zero / Missing documents | Approval blocked (400) | Approval allowed (200 OK) | **FAIL** |
| Optional document pending | Follow configured rules | No document rules configured | **GAP** |

### Identified Risk
A partner can onboard, submit fake or no documents, and be approved by an administrator, introducing regulatory, legal, and operational risks before service dispatch.

---

## 3. Check 2 — Partner Suspension and Immediate Access Revocation

### Status: **PARTIAL / FAIL**

### Implementation Evidence
- **File**: [`src/modules/admin/admin.service.ts`](file:///c:/Users/baps/Desktop/Backend/src/modules/admin/admin.service.ts)
- **Function**: `AdminService.suspendPartner(adminUserIdStr, partnerIdStr, reason, context)` (Lines 129–175)
- **File**: [`src/common/middlewares/auth.middleware.ts`](file:///c:/Users/baps/Desktop/Backend/src/common/middlewares/auth.middleware.ts)
- **Function**: `requireAuth` (Lines 21–58) and `requirePartner` (Line 94)
- **File**: [`src/modules/partners/partners.routes.ts`](file:///c:/Users/baps/Desktop/Backend/src/modules/partners/partners.routes.ts) (Lines 20–260)

### Inspection Analysis
1. **User Account vs. Partner Profile**:
   - `suspendPartner` updates `partner_profiles.approvalStatus = 'SUSPENDED'`.
   - The user's account in `users.account_status` remains `ACTIVE`. This correctly preserves the user's `CUSTOMER` access.
2. **Session Persistence**:
   - `user_sessions` rows for the suspended partner are **not modified**.
   - `requireAuth` checks only `user_sessions.revokedAt !== null` and `users.accountStatus === 'ACTIVE'`.
3. **Partner Authorization Guard (`requirePartner`)**:
   - `requirePartner = requireRole(UserRole.PARTNER)` checks only the static JWT payload `req.user.roles.includes('PARTNER')`.
   - It does not check `partner_profiles.approvalStatus`.
4. **Partner Routes Inspection**:
   - `partners.routes.ts` applies `router.use(requireAuth)`. It does not apply any check verifying that `partner.approvalStatus === 'APPROVED'`.
   - Consequently, a suspended partner can still add skills, modify service areas, update business profile, and upload documents.
5. **Token Refresh**:
   - `authService.refreshTokens` only checks `user.accountStatus !== 'ACTIVE'`. A suspended partner can continuously refresh their session tokens.
6. **Booking Eligibility**:
   - Booking assignment functionality is **not yet implemented** (scheduled for Phase 7). This behavior cannot currently be verified in code and must be strictly enforced during Phase 7 dispatch matching.

### Test Scenarios Executed

| Scenario | Expected Result | Actual Result | Evaluation |
|---|---|---|---|
| Admin suspends approved partner | Partner status becomes `SUSPENDED` | `partner_profiles.approvalStatus = 'SUSPENDED'` | **PASS** |
| Customer privileges preserved | Suspended partner can still act as customer | Customer profile/addresses remain accessible | **PASS** |
| Suspended partner accesses partner APIs | Access denied (403 Forbidden) | Access allowed (200 OK) | **FAIL** |
| Suspended partner uses existing access token | Partner routes deny access | Partner routes succeed | **FAIL** |
| Suspended partner tries to refresh token | Denied or partner role stripped | Refresh succeeds with PARTNER role | **FAIL** |
| Booking assignment considered | Suspended partner excluded | *Not Implemented (Phase 7)* | **NOT APPLICABLE** |

### Identified Risk
A rogue or suspended service partner can continue interacting with partner management APIs. When Phase 7 booking dispatch is built, failing to check `approvalStatus === 'APPROVED'` would allow suspended partners to receive customer jobs.

---

## 4. Check 3 — Private KYC Document Access Security

### Status: **PARTIAL (SECURE BY DEFAULT / MISSING CAPABILITY)**

### Implementation Evidence
- **File**: [`src/common/services/storage.service.ts`](file:///c:/Users/baps/Desktop/Backend/src/common/services/storage.service.ts)
- **Class**: `LocalStorageService` (Lines 23–164)
- **File**: [`src/app.ts`](file:///c:/Users/baps/Desktop/Backend/src/app.ts) (Lines 1–62)
- **File**: [`src/modules/partners/partners.routes.ts`](file:///c:/Users/baps/Desktop/Backend/src/modules/partners/partners.routes.ts) (Lines 135–170)
- **File**: [`src/modules/admin/admin.routes.ts`](file:///c:/Users/baps/Desktop/Backend/src/modules/admin/admin.routes.ts) (Lines 150–200)

### Inspection Analysis
1. **Public Static Serving**:
   - `app.ts` does **not** mount `express.static('uploads')`.
   - Direct HTTP GET requests to `http://localhost:5000/uploads/...` hit `notFoundHandler` returning `404 Not Found`. Physical files cannot be reached via direct URL.
2. **Storage Key Isolation**:
   - Files are stored in `uploads/documents/` using random UUIDs and timestamps (e.g. `1762238400000_3d4b687f-9452-4412-a1f9-86f2b1d310ea.pdf`).
   - Original filenames provided by users are never used for filesystem paths.
   - Only the internal storage key is recorded in `partner_documents.document_storage_key`.
3. **Path Traversal Defense**:
   - `LocalStorageService.resolveSafePath` normalizes paths and verifies `absolutePath.startsWith(this.baseDir)`. Traversal attempts (e.g. `../../etc/passwd`) are rejected with `BadRequestError`.
4. **Document Retrieval Capability**:
   - Neither `partners.routes.ts` nor `admin.routes.ts` contains an endpoint to download, stream, or view the binary content of an uploaded KYC document (e.g. `GET /api/v1/admin/partners/documents/:id/file`).
   - Currently, administrators can only view document metadata (`documentType`, `verificationStatus`, `documentStorageKey`) in the JSON dossier, but cannot view the actual image or PDF to verify authenticity.
   - Because no retrieval endpoint exists, unauthorized access to files via API is currently impossible (secure by default), but administrator visual verification capability is missing.

### Test Scenarios Executed

| Scenario | Expected Result | Actual Result | Evaluation |
|---|---|---|---|
| Direct URL access to uploaded file | Not publicly accessible (404) | 404 Not Found | **PASS** |
| Path traversal attempt in storage service | Blocked with security error | Blocked (`Invalid or insecure storage key`) | **PASS** |
| Customer / Unauthorized API access to files | Access denied | No download endpoint exposed | **PASS (By Default)** |
| Cross-partner access to files | Access denied | No download endpoint exposed | **PASS (By Default)** |
| Admin document viewing/download API | Authorized admin can view/stream file | *Endpoint does not exist* | **MISSING CAPABILITY** |

### Identified Risk
Because admins cannot stream or view the uploaded document image/PDF via a dedicated authenticated API, verifying whether an uploaded document is a legitimate ID or a blank file is impossible in practice.

---

## 5. Additional Verification Results

| Item | Requirement | Code Location | Result | Test Evidence |
|---|---|---|---|---|
| **Audit Logs** | Approval, rejection, suspension, doc/skill verification logged | `admin.service.ts:56, 102, 162, 203, 237, 269, 298` | **PASS** | `tests/phase6.test.ts:30, 32, 33` |
| **Mandatory Reasons** | Rejection and suspension require non-empty reasons | `admin.validator.ts:3, 14` (`min(5).max(500)`) | **PASS** | `tests/phase6.test.ts:34, 35` |
| **Admin Route Protection** | Non-admins blocked from calling `/api/v1/admin/*` | `admin.routes.ts:10` (`requireAuth, requireAdmin`) | **PASS** | `tests/phase6.test.ts:26` (403 Forbidden) |
| **Self-Approval Guard** | Admins cannot review or approve their own partner profile | `admin.service.ts:38, 87, 144` (`partner.userId === adminUserId`) | **PASS** | `tests/phase6.test.ts:29` (403 Forbidden) |
| **Lifecycle State Transitions** | Re-approving `APPROVED` partner returns 400 | `admin.service.ts:44` | **PASS** | `tests/phase6.test.ts:31` (400 Bad Request) |
| **Invalid State Transitions** | Suspending a `PENDING` or `REJECTED` partner | `admin.service.ts:150` (Only checks `=== 'SUSPENDED'`) | **PARTIAL** | Allows suspending unapproved partner |
| **Atomic Transactions** | Admin status changes + audit logs in single transaction | `admin.service.ts:49-65` (Independent awaits) | **FAIL** | Not wrapped in `prisma.$transaction` |

---

## 6. Summary of Gaps & Weaknesses

### Gap 1: Lack of KYC Document Validation Before Partner Approval
- **Severity**: **HIGH**
- **Issue**: `AdminService.approvePartner` only validates self-approval and existing approval status. It never inspects `partner.documents`.
- **Consequence**: Admins can approve partners without any KYC verification, exposing the platform to unvetted operators.

### Gap 2: Incomplete Partner Suspension Enforcement
- **Severity**: **HIGH**
- **Issue**: `AdminService.suspendPartner` modifies `partner_profiles.approvalStatus = 'SUSPENDED'`, but:
  - Does not invalidate active partner sessions or strip the `PARTNER` role from the user session.
  - No middleware verifies `partnerProfile.approvalStatus === 'APPROVED'` before serving partner endpoints.
- **Consequence**: Suspended partners can continue modifying their profile, skills, and service areas.

### Gap 3: Missing Atomic Transactions on Admin Operations
- **Severity**: **MEDIUM**
- **Issue**: Status updates on `partner_profiles`, `partner_documents`, and `partner_skills` and corresponding `audit_logs` inserts are executed as separate asynchronous queries rather than within `prisma.$transaction`.
- **Consequence**: A failure during audit logging leaves the entity state mutated without a corresponding audit trail, violating compliance requirements.

### Gap 4: Missing Admin KYC Document Download/Stream Endpoint
- **Severity**: **MEDIUM**
- **Issue**: Admins cannot view or download uploaded KYC documents to perform visual verification before approving or rejecting them.
- **Consequence**: Verification decisions must be made blindly or through direct out-of-band database/filesystem access.

### Gap 5: Permissive Suspension Transition
- **Severity**: **LOW**
- **Issue**: `AdminService.suspendPartner` allows transitioning a `PENDING` partner directly to `SUSPENDED`.
- **Consequence**: Corrupts the expected state machine (`PENDING` -> `APPROVED` -> `SUSPENDED`).

---

## 7. Recommended Safe Fixes (For Implementation Approval)

The following smallest safe fixes are proposed for user approval before Phase 7:

### Fix Proposal 1: Enforce Mandatory KYC Verification Before Approval
1. Define mandatory document requirements in `src/common/constants/kyc.constant.ts`:
   - `INDIVIDUAL`: `['AADHAAR', 'PAN']`
   - `BUSINESS`: `['GST_CERTIFICATE', 'PAN']`
2. In `AdminService.approvePartner`:
   - Inspect `partner.documents`.
   - Verify that all mandatory document types exist and have `verificationStatus === 'VERIFIED'`.
   - If any mandatory document is missing or not verified, reject approval with a descriptive `400 Bad Request` (e.g. `Cannot approve partner: Mandatory document 'AADHAAR' is pending verification`).

### Fix Proposal 2: Add `requireApprovedPartner` Guard & Enforce Suspension
1. Create a middleware `requireApprovedPartner` in `src/common/middlewares/auth.middleware.ts`:
   - Queries `partner_profiles` for the authenticated `userId`.
   - If `!partner || partner.approvalStatus !== 'APPROVED'`, returns `403 Forbidden` (`Partner account is ${partner.approvalStatus.toLowerCase()}. Active approval is required.`).
2. Apply `requireApprovedPartner` to operational partner routes in `partners.routes.ts` (`/skills`, `/service-areas`).
3. In `AdminService.suspendPartner`:
   - Restrict status transition: partner must be in `APPROVED` status to be suspended (`if (partner.approvalStatus !== 'APPROVED') throw new BadRequestError(...)`).

### Fix Proposal 3: Wrap Admin Actions in `prisma.$transaction`
Update `approvePartner`, `rejectPartner`, `suspendPartner`, `verifyDocument`, `rejectDocument`, `verifySkill`, and `rejectSkill` in `admin.repository.ts` / `admin.service.ts` to perform the status update and the audit log creation inside `prisma.$transaction(async (tx) => { ... })`.

### Fix Proposal 4: Implement Secure Admin Document Retrieval Endpoint
Create an admin-only endpoint:
`GET /api/v1/admin/partners/documents/:id/file`
- Guarded by `requireAuth` and `requireAdmin`.
- Retrieves `documentStorageKey` from `partner_documents`.
- Uses `storageService.getFile(doc.documentStorageKey)` to stream the file with appropriate `Content-Type` (`image/jpeg`, `application/pdf`, etc.).
- Keeps physical files non-public while enabling legitimate admin visual inspection.

---

## 8. Final Audit Metric & Recommendation

| Metric | Count |
|---|---|
| **Total Checks Evaluated** | 9 |
| **Checks Passed** | 5 |
| **Checks Failed** | 2 (Check 1 KYC Enforcement, Admin Atomic Transactions) |
| **Partial Checks** | 2 (Check 2 Partner Suspension, State Transition Validation) |
| **Missing Capabilities** | 1 (Check 3 Admin Document Download Endpoint) |

### Approval Recommendation
**DO NOT PROCEED TO PHASE 7 YET.**

Phase 6 contains critical business logic gaps in the Partner KYC approval gate and Partner Suspension enforcement. Proceeding to Phase 7 (Booking Engine) with these gaps would allow unvetted or suspended partners to be matched and assigned to real customer bookings.

**Recommended Action**: Implement the 4 targeted fixes outlined in Section 7, re-run test verification, and only then proceed to Phase 7 Booking Management.

