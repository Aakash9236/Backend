# Phase 6A — Security Remediation & Hardening Plan (Revised & Corrected)

**Project:** Multi-Service Marketplace Backend  
**Directory:** `C:\Users\baps\Desktop\Backend`  
**Database:** `service_platform_db` (PostgreSQL 18, Prisma ORM)  
**Date:** November 4, 2026  
**Status:** Implementation Preparation Complete — Awaiting Final User Authorization  

---

## 1. Executive Summary

Following feedback on the initial inspection, this revised implementation plan addresses all 5 security vulnerabilities and incorporates strict business constraints:
1. **Configurable KYC Requirement Engine:** Decoupled from hardcoded assumptions. Implements a reusable `KycValidationService` allowing document rules to be injected and evaluated dynamically. Rejects approval if required documents are missing, pending, rejected, or expired, while explicitly ignoring rejection of optional documents. Runtime, admin-managed database configuration is formally earmarked for Phase 6F.
2. **Comprehensive Partner Endpoint Authorization:** Enforces partner approval status across *all* partner endpoints. Suspended partners are blocked from operational actions with HTTP 403 while customer privileges and sessions remain fully intact. Refresh token mechanics are analyzed to verify suspension cannot be bypassed via token refresh.
3. **Strict Suspension State Machine Guard:** Restricts suspension strictly to partners currently in `APPROVED` status.
4. **Atomic Prisma Transactions for Admin Operations:** Encloses all admin business mutations and audit-log writes inside atomic `prisma.$transaction` calls.
5. **Secure KYC Document Streaming Endpoint:** Implements `GET /api/v1/admin/partners/documents/:id/file` with full admin RBAC, secure path resolution, safe MIME headers, zero path leakage, and stream handling.

A verified PostgreSQL database backup has been taken and confirmed prior to any code preparation. **Zero database migrations and zero schema changes are required.**

---

## 2. Detailed Technical Remediation Specifications

### Issue A: KYC Policy & Validation Engine

#### 1. Business Logic Decisions
- **No Hardcoded Universal Documents:** Aadhaar, PAN, and GST are **not** hardcoded as universally mandatory.
- **Configurable Contract:** A reusable `KycValidationService` defines and validates requirement rules. The rule set specifies required document types and optional document types per scenario.
- **Phase Boundary Clarification:** A static policy provider handles Phase 6A evaluation without claiming to be an admin-managed runtime configuration. Database-backed, admin-managed KYC requirement configuration will be implemented in Phase 6F.
- **Approval Gate Behavior:**
  - Mandatory documents must be present and have `verificationStatus === 'VERIFIED'`.
  - If a mandatory document is missing, `PENDING`, `REJECTED`, or expired, partner approval is rejected with HTTP 400.
  - If an *optional* document is present and `REJECTED`, it does **not** block partner approval.

#### 2. Architecture of `KycValidationService`
Create `src/modules/admin/services/kyc-validation.service.ts`:
```typescript
export interface KycRule {
  requiredTypes: string[];
  optionalTypes: string[];
}

export interface KycDocumentRecord {
  documentType: string;
  verificationStatus: string;
  expiryDate?: Date | null;
}

export interface KycValidationResult {
  isValid: boolean;
  missingTypes: string[];
  unverifiedTypes: string[];
  expiredTypes: string[];
  reasons: string[];
}

export interface IKycPolicyProvider {
  getRulesForPartner(profile: { profileType: string }): Promise<KycRule>;
}
```
Validation algorithm inside `KycValidationService.validateForApproval(partner, documents)`:
1. Fetch rule from `IKycPolicyProvider`.
2. For each `requiredType` in rule:
   - Check if at least one document of that type exists.
   - If not found: flag as `missingTypes`.
   - If found: check `verificationStatus === 'VERIFIED'`. If pending/rejected: flag as `unverifiedTypes`.
   - Check expiry: If `expiryDate` exists and is `< new Date()`: flag as `expiredTypes`.
3. Documents matching `optionalTypes` are checked: if rejected, they do not add to `reasons` or invalidate `isValid`.
4. If `!result.isValid`: `AdminService.approvePartner` throws `BadRequestError(result.reasons.join('; '))`.

---

### Issue B: Partner Endpoint Authorization & Session Integrity

#### 1. Endpoint-by-Endpoint Matrix

| Endpoint | HTTP Method | Lifecycle Requirement | Target Middleware | Behavior When Suspended / Rejected |
|---|---|---|---|---|
| `/onboarding` | `POST` | Authenticated User | `requireAuth` | Blocked if active profile already exists |
| `/profile` | `GET` | `PENDING`, `APPROVED`, `SUSPENDED` | `requireAuth`, `requirePartnerProfile` | Permitted (partners can view their own profile/rejection reason/suspension reason) |
| `/profile` | `PATCH` | `PENDING`, `APPROVED` | `requirePartnerProfile`, `requireActivePartner` | **403 Forbidden** if `SUSPENDED` or `REJECTED` |
| `/documents` | `POST` | `PENDING` (Onboarding/resubmission) | `requirePartnerProfile`, `requireOnboardingPartner` | **403 Forbidden** if `SUSPENDED` |
| `/documents` | `GET` | `PENDING`, `APPROVED`, `SUSPENDED` | `requirePartnerProfile` | Permitted (view submitted docs) |
| `/skills` | `POST` | `APPROVED` only | `requireApprovedPartner` | **403 Forbidden** if `SUSPENDED`, `REJECTED`, or `PENDING` |
| `/skills` | `GET` | `APPROVED` only | `requireApprovedPartner` | **403 Forbidden** if `SUSPENDED` or `REJECTED` |
| `/service-areas` | `POST` | `APPROVED` only | `requireApprovedPartner` | **403 Forbidden** if `SUSPENDED`, `REJECTED`, or `PENDING` |
| `/service-areas` | `GET` | `APPROVED` only | `requireApprovedPartner` | **403 Forbidden** if `SUSPENDED` or `REJECTED` |

#### 2. Refresh-Token & Dual-Role Session Mechanics
- **User Account vs Partner Profile:** 
  - `users.account_status` governs platform login, refresh-token rotation, and customer capabilities.
  - `partner_profiles.approval_status` governs partner operational privileges.
  - When an admin suspends a partner, `partner_profiles.approvalStatus` is set to `'SUSPENDED'`. The user's row in `users` remains `'ACTIVE'`.
- **Token Refresh Behavior:**
  - When the user calls `POST /api/v1/auth/refresh`, the refresh token is rotated, and a new JWT is issued.
  - Even though the JWT payload retains `roles: ['CUSTOMER', 'PARTNER']`, all partner operational endpoints execute database-backed middleware (`requireApprovedPartner` / `requireActivePartner`).
  - The middleware directly inspects `partnerProfile.approvalStatus` from PostgreSQL.
  - Therefore, **suspension cannot be bypassed via token refresh**.
- **Customer Isolation:**
  - Customer endpoints (`/api/v1/customers/*`, `/api/v1/users/me`) do not check `partner_profiles`.
  - A suspended partner who orders a service or views their customer profile experiences zero disruption.
  - No global session revocation or token invalidation is triggered.

---

### Issue C: Partner Suspension State Transition

#### 1. State Transition Rule
- A partner can transition to `SUSPENDED` **only if** their current `approvalStatus` is `APPROVED`.
- In `AdminService.suspendPartner`:
  ```typescript
  if (partner.approvalStatus !== 'APPROVED') {
    throw new BadRequestError(
      `Invalid state transition: Cannot suspend partner in '${partner.approvalStatus}' status. Only currently APPROVED partners can be suspended.`
    );
  }
  ```
- Reject transitions from `PENDING`, `REJECTED`, or already `SUSPENDED` with HTTP 400.

---

### Issue D: Atomic Admin Operations & Audit Logging

#### 1. Transactional Repository Architecture
All administrative mutations and their accompanying audit logs must execute within an atomic `prisma.$transaction`. If either query fails, the entire transaction rolls back.

In `src/modules/admin/admin.repository.ts`:
1. **`updatePartnerStatusWithAudit`**:
   ```typescript
   async updatePartnerStatusWithAudit(
     partnerId: bigint,
     status: string,
     reason: string | null,
     adminUserId: bigint,
     auditData: {
       action: string;
       oldValues: any;
       newValues: any;
       ipAddress?: string;
       userAgent?: string;
     }
   ): Promise<PartnerProfile> {
     return prisma.$transaction(async (tx) => {
       const updated = await tx.partnerProfile.update({
         where: { id: partnerId },
         data: {
           approvalStatus: status,
           rejectionReason: reason,
           reviewedBy: adminUserId,
           reviewedAt: new Date(),
           updatedAt: new Date(),
         },
       });

       await tx.auditLog.create({
         data: {
           actorUserId: adminUserId,
           action: auditData.action,
           entityName: 'partner_profiles',
           entityId: partnerId,
           oldValues: auditData.oldValues,
           newValues: auditData.newValues,
           ipAddress: auditData.ipAddress ?? null,
           userAgent: auditData.userAgent ?? null,
         },
       });

       return updated;
     });
   }
   ```
2. **`updateDocumentStatusWithAudit`**: Atomic update for `partner_documents` and `audit_logs`.
3. **`updateSkillStatusWithAudit`**: Atomic update for `partner_skills` and `audit_logs`.

---

### Issue E: Secure KYC Document Streaming

#### 1. Endpoint Specification
- **Method & Path:** `GET /api/v1/admin/partners/documents/:id/file`
- **Security Middleware:** `requireAuth`, `requireAdmin`
- **Input Validation:**
  - Route param `:id` must be a valid positive integer string representing a BigInt ID.
  - Return `400 Bad Request` if invalid.
- **Service & Storage Logic:**
  1. Retrieve `PartnerDocument` by `id` from PostgreSQL.
  2. If not found: throw `NotFoundError('Partner document record not found')`.
  3. Validate that `documentStorageKey` is populated.
  4. Pass `documentStorageKey` to `LocalStorageService`. The service enforces directory confinement to `uploads/documents/` and checks physical file existence.
  5. If file does not exist on disk: throw `NotFoundError('Document file not found on storage server')`.
  6. Sanitize filename: Extract extension and generate a safe download filename: `partner_doc_${document.id}_${document.documentType.toLowerCase()}${ext}`.
  7. Set response headers:
     - `Content-Type`: resolved MIME type (`image/jpeg`, `image/png`, `application/pdf`, etc.)
     - `Content-Disposition`: `inline; filename="<sanitized-filename>"`
     - `Cache-Control`: `private, no-cache, no-store, must-revalidate`
     - `Pragma`: `no-cache`
     - `Expires`: `0`
     - `X-Content-Type-Options`: `nosniff`
  8. Stream file via `fs.createReadStream(filePath).pipe(res)`.
  9. **Zero Filesystem Leakage:** Error messages and logs sent to the client never reveal internal operating system directory paths (e.g. `C:\Users\baps\...`).

---

## 3. Database Schema & Migration Requirement

- **Required Database Migrations:** **`0` (Zero)**
- **Required Prisma Schema Changes:** **`0` (Zero)**

All existing 40 business tables (`users`, `partner_profiles`, `partner_documents`, `partner_skills`, `audit_logs`, etc.) fully accommodate these remediations.

---

## 4. PostgreSQL Backup Verification

A pre-remediation backup of `service_platform_db` was successfully created and verified:
- **Backup File:** `C:\Users\baps\Desktop\Backend\backups\service_platform_db_backup_20261104092123_phase6a.sql`
- **Backup Size:** 125,546 bytes
- **Header Verification:** Valid PostgreSQL plain-text database dump header confirmed.
- **Table Count Verification:** 41 `CREATE TABLE` definitions verified (40 business tables + 1 `schema_migrations` tracking table).

---

## 5. Exact Files to Create and Modify

### Files to Create (3 Files)
1. `src/modules/admin/services/kyc-validation.service.ts`:
   - Defines `IKycPolicyProvider`, `KycValidationService`, validation contracts, and result types.
2. `src/modules/partners/partners.middleware.ts`:
   - Contains lifecycle middlewares: `requirePartnerProfile`, `requireApprovedPartner`, `requireActivePartner`, `requireOnboardingPartner`.
3. `tests/unit/phase6a-security.test.ts`:
   - Comprehensive test suite covering all 11 required test scenarios.

### Files to Modify (5 Files)
1. `src/modules/admin/admin.repository.ts`:
   - Add transactional methods: `updatePartnerStatusWithAudit`, `updateDocumentStatusWithAudit`, `updateSkillStatusWithAudit`.
2. `src/modules/admin/admin.service.ts`:
   - Integrate `KycValidationService` into `approvePartner`.
   - Add transition validation to `suspendPartner`.
   - Add `getDocumentFile(adminUserId, documentId)`.
3. `src/modules/admin/admin.controller.ts`:
   - Add `getDocumentFile` handler for streaming binary KYC files with security headers.
4. `src/modules/admin/admin.routes.ts`:
   - Mount `GET /partners/documents/:id/file` with OpenAPI documentation.
5. `src/modules/partners/partners.routes.ts`:
   - Apply lifecycle middlewares (`requireApprovedPartner`, `requireActivePartner`, `requireOnboardingPartner`) across all endpoints.

---

## 6. Comprehensive Test Plan

The test suite in `tests/unit/phase6a-security.test.ts` will verify:
1. **KYC Gate Tests:**
   - Partner approval rejected with HTTP 400 when required document is missing.
   - Partner approval rejected with HTTP 400 when required document is in `PENDING` status.
   - Partner approval rejected with HTTP 400 when required document is in `REJECTED` status.
   - Partner approval rejected with HTTP 400 when required document is expired (`expiryDate < now`).
   - Partner approval succeeds when required documents are `VERIFIED` even if an optional document is `REJECTED`.
2. **Suspension State Transition Tests:**
   - Suspending a partner in `PENDING` status fails with HTTP 400.
   - Suspending a partner in `REJECTED` status fails with HTTP 400.
   - Suspending an already `SUSPENDED` partner fails with HTTP 400.
   - Suspending an `APPROVED` partner succeeds with HTTP 200.
3. **Partner Authorization & Lifecycle Tests:**
   - Approved partner can access `/skills` and `/service-areas`.
   - Suspended partner receives `403 Forbidden` on `/skills` and `/service-areas`.
   - Suspended partner receives `403 Forbidden` on `PATCH /profile` and `POST /documents`.
   - Suspended partner can still view `GET /profile` to see suspension status.
   - User with both `CUSTOMER` and `PARTNER` roles retains 100% access to customer endpoints after partner suspension.
   - Refresh token rotation succeeds for suspended partner, but refreshed access token remains blocked from operational partner endpoints.
4. **Atomic Transaction Tests:**
   - If audit log insertion throws an error, the partner status update is rolled back.
   - Status update and audit log commit atomically on success.
5. **Secure Document Streaming Tests:**
   - Unauthenticated request returns `401 Unauthorized`.
   - Non-admin user request returns `403 Forbidden`.
   - Invalid document ID (e.g. `abc` or `-1`) returns `400 Bad Request`.
   - Non-existent document ID returns `404 Not Found`.
   - Missing physical file on disk returns `404 Not Found` without disclosing server filesystem paths.
   - Valid admin request returns binary stream with correct `Content-Type` and `Content-Disposition: inline`.
6. **Regression Verification:**
   - Run full existing test suite (`npm test`) to guarantee zero regression across Authentication, User Management, Customer Profiles, and Partner Onboarding.

---

## 7. Open Questions & Phase 6F Scope Alignment

- **Phase 6F Scope:** Dynamic, database-driven KYC document rules (managed via admin UI/API tables like `kyc_document_requirements`) will be implemented in Phase 6F. In Phase 6A, `KycValidationService` uses an injectable interface architecture so switching to the database provider in Phase 6F requires zero changes to the approval engine.
