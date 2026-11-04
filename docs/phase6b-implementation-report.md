# Phase 6B: Unified Identity & Role Management — Implementation Report

**Date:** 2026-11-04  
**Project:** Multi-Service Marketplace Backend  
**Architecture:** Modular Monolith (Node.js, Express, TypeScript, PostgreSQL 18, Prisma ORM, Redis)  
**Status:** Successfully Implemented & Fully Verified (112/112 Tests Passing Across 7 Suites)  

---

## 1. Executive Summary

Phase 6B introduces **Unified Identity & Contextual Role Management** across the platform. In accordance with confirmed business decisions:
1. **One mobile number = One user account.** Multiple mobile accounts are never created for the same individual.
2. **Multi-Role Entitlements:** A single user can concurrently hold multiple platform roles (`CUSTOMER`, `PARTNER`, `DRIVER`, `WORKER`, `ADMIN`, `SUPER_ADMIN`).
3. **Additive & Idempotent Role Assignment:** Assigning additional roles preserves all existing roles without duplication.
4. **Active Role Context Switching (`POST /api/v1/auth/switch-role`):** Users switch active contexts without logging out or re-authenticating with OTP. A new signed JWT access token is issued containing the `activeRole` claim alongside all assigned roles in `roles: string[]`.
5. **Zero Role Order Inference:** The backend never infers active or privileged roles from array position (`roles[0]`). Privileged contexts require an explicit `activeRole` claim. Legacy tokens lacking `activeRole` safely default to `CUSTOMER` if assigned, otherwise fail closed (`401 Unauthorized`).
6. **Partner Suspension & Customer Independence:** Partner suspension is strictly isolated to partner operational capabilities. Suspended partners can continue utilizing customer services (booking, profile, addresses).
7. **Strict Admin Hierarchy Separation:** Only `SUPER_ADMIN` can assign or revoke privileged user roles. Operational `ADMIN` users are strictly forbidden (`403 Forbidden`). Self-escalation, self-revocation, removing the last assigned role, and removing the last `SUPER_ADMIN` on the platform are strictly blocked.
8. **Operational Readiness Rules:** 
   - `CUSTOMER`: Operational when account status is `ACTIVE`.
   - `PARTNER`: Operational only when partner profile approval status is `APPROVED`.
   - `DRIVER` / `WORKER`: Return `NOT_ONBOARDED` and `isOperational: false` pending their dedicated onboarding implementations in Phase 6D and 6E.
   - `ADMIN` / `SUPER_ADMIN`: Operational when account is `ACTIVE`.
9. **Zero Schema Migrations:** All requirements were achieved within the existing PostgreSQL 18 schema and pre-seeded `roles` / `user_roles` architecture.

---

## 2. Implemented Endpoints & Middleware Contracts

### A. Active Role Switching API
- **Endpoint:** `POST /api/v1/auth/switch-role`
- **Auth Guard:** `requireAuth`
- **Request Body:**
  ```json
  {
    "role": "PARTNER"
  }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "message": "Role switched to PARTNER successfully",
    "data": {
      "activeRole": "PARTNER",
      "availableRoles": ["CUSTOMER", "PARTNER"],
      "roleStatus": {
        "role": "PARTNER",
        "approvalStatus": "APPROVED",
        "isOperational": true
      },
      "tokens": {
        "accessToken": "eyJhbGciOi...",
        "tokenType": "Bearer",
        "expiresIn": 900
      }
    }
  }
  ```
- **Error Handling:**
  - `400 Bad Request`: If role is invalid or omitted.
  - `401 Unauthorized`: If unauthenticated.
  - `403 Forbidden`: If target role is not assigned to the user in PostgreSQL.

### B. Privileged Role Administration (Super Admin Only)
- **Endpoints:**
  - `POST /api/v1/admin/users/:id/roles` (Assign role)
  - `DELETE /api/v1/admin/users/:id/roles/:roleName` (Revoke role)
- **Auth Guards:** `requireAuth, requireSuperAdmin`
- **Enforced Safety Controls:**
  - Operational `ADMIN` forbidden (`403 Forbidden`).
  - **Idempotency:** Assigning an already assigned role returns success without duplicate records.
  - **Self-Escalation Prevention:** Super Admins cannot assign roles to their own account (`403 Forbidden`).
  - **Self-Revocation Prevention:** Super Admins cannot revoke roles from their own account (`403 Forbidden`).
  - **Last Role Protection:** Users must retain at least one role (`400 Bad Request`).
  - **Last Super Admin Protection:** The platform prevents revoking `SUPER_ADMIN` if only 1 Super Admin remains (`400 / 403 Forbidden`).
  - **Transactional Audit Logging:** Role mutations write an `ADMIN_USER_ROLE_ASSIGNED` or `ADMIN_USER_ROLE_REVOKED` record inside the same atomic PostgreSQL transaction.

### C. Enhanced Identity Introspection
- **`GET /api/v1/auth/me`:**
  - Returns `activeRole` and `roleStatus` alongside user profile, permissions, and `roles`:
  ```json
  {
    "success": true,
    "data": {
      "id": "1",
      "mobileNumber": "+919999333001",
      "email": "user@example.com",
      "accountStatus": "ACTIVE",
      "isMobileVerified": true,
      "activeRole": "CUSTOMER",
      "roles": ["CUSTOMER", "PARTNER"],
      "roleStatus": {
        "role": "CUSTOMER",
        "approvalStatus": "ACTIVE",
        "isOperational": true
      },
      "createdAt": "2026-11-04T09:00:00.000Z"
    }
  }
  ```
- **`GET /api/v1/users/me/roles`:**
  - Returns an enriched array of assigned roles with operational readiness metadata:
  ```json
  {
    "success": true,
    "data": [
      {
        "roleName": "CUSTOMER",
        "description": "Standard customer role",
        "assignedAt": "2026-11-04T09:30:00.000Z",
        "status": "ACTIVE",
        "isOperational": true,
        "isActiveContext": true
      },
      {
        "roleName": "PARTNER",
        "description": "Service partner role",
        "assignedAt": "2026-11-04T09:35:00.000Z",
        "status": "APPROVED",
        "isOperational": true,
        "isActiveContext": false
      }
    ]
  }
  ```

### D. Active-Role Context Middleware (`requireActiveRole`)
- **Signature:** `requireActiveRole(...allowedRoles: string[])`
- **Behavior:**
  - Validates `req.user.activeRole`.
  - Distinguishes **Role Entitlement** (`roles.includes(r)`) from **Active Role Context** (`req.user.activeRole === r`).
  - **Legacy Token Compatibility:** If `activeRole` is omitted in the JWT:
    - If `CUSTOMER` is in `roles` and `CUSTOMER` is an allowed context, permits execution as `CUSTOMER`.
    - If privileged context (e.g., `PARTNER`, `ADMIN`) is required, strictly rejects with `401 Unauthorized` (`Active role context is missing from token. Please switch role or refresh token.`).
    - **Never infers array ordering `roles[0]`**.

---

## 3. Code Modifications & Architecture Integrity

| Component | File Path | Scope of Implementation |
|---|---|---|
| **Auth Types** | `src/modules/auth/auth.types.ts` | Added `activeRole` to `JwtUserPayload` & `AuthSessionResponse`; added `RoleStatusInfo` and `SwitchRoleResult`. |
| **Auth Middlewares** | `src/common/middlewares/auth.middleware.ts` | Implemented `requireActiveRole`, `requireSuperAdmin`, and secure legacy JWT fallback. |
| **Auth Validator** | `src/modules/auth/auth.validator.ts` | Added Zod schema `switchRoleSchema`; updated `refreshTokenBodySchema`. |
| **Auth Service** | `src/modules/auth/auth.service.ts` | Implemented `switchRole`, `getRoleOperationalStatus`, role validation against live DB, updated `refreshTokens` with fallback to `CUSTOMER` upon role revocation, and populated `roleStatus` on `getMe`. |
| **Auth Controller** | `src/modules/auth/auth.controller.ts` | Added `switchRole` handler; enriched `getMe` and `refresh`. |
| **Auth Routes** | `src/modules/auth/auth.routes.ts` | Registered `POST /api/v1/auth/switch-role` with OpenAPI documentation. |
| **Admin Repository** | `src/modules/admin/admin.repository.ts` | Added `findUserWithRoles`, `findRoleByName`, `countUsersWithRole`, `assignRoleWithAudit`, `revokeRoleWithAudit`. |
| **Admin Service** | `src/modules/admin/admin.service.ts` | Implemented `assignUserRole` and `revokeUserRole` with guard rails and atomic audit logging. |
| **Admin Controller & Routes** | `src/modules/admin/admin.controller.ts`, `src/modules/admin/admin.routes.ts` | Registered `POST /api/v1/admin/users/:id/roles` & `DELETE /api/v1/admin/users/:id/roles/:roleName`. |
| **Users Service** | `src/modules/users/users.service.ts` | Enriched `getUserRoles` with operational status (`NOT_ONBOARDED` for DRIVER/WORKER), isActiveContext, while preserving array contract. |
| **Test Suite** | `tests/phase6b.test.ts` | 27 dedicated automated tests covering all 18 specified scenarios and edge cases. |

---

## 4. Verification & Test Evidence

### A. Dedicated Phase 6B Test Suite (`tests/phase6b.test.ts`)
```
PASS tests/phase6b.test.ts
  Phase 6B: Unified Identity & Role Management
    Multiple Roles & Idempotent Assignment
      √ 1. should automatically assign CUSTOMER role to first-time user upon OTP verification (97 ms)
      √ 2. should preserve CUSTOMER role when onboarding as a PARTNER (50 ms)
      √ 3. should show multiple roles assigned to a single account without duplicates (4 ms)
      √ 4. should idempotently handle role assignment without duplicating user_roles records (23 ms)
    Role Context Switching (POST /api/v1/auth/switch-role)
      √ 3. should successfully switch from CUSTOMER to PARTNER context and return signed token (23 ms)
      √ 4. should successfully switch back from PARTNER to CUSTOMER context (27 ms)
      √ 5. should reject switching to an unassigned role with 403 Forbidden (15 ms)
      √ 6. should reject invalid role name with 400 Bad Request (11 ms)
      √ 7. should reject unauthenticated role switch request with 401 Unauthorized (10 ms)
    Enhanced Identity Introspection Endpoints
      √ 8. should return activeRole in GET /api/v1/auth/me (11 ms)
      √ 9. should return enriched roles with status in GET /api/v1/users/me/roles (13 ms)
    requireActiveRole Middleware & Legacy Token Compatibility
      √ 10. should permit action when active role matches required context (9 ms)
      √ 11. should forbid action when active role does NOT match required context (403) (10 ms)
      √ 12. should handle legacy token without activeRole safely for CUSTOMER context (8 ms)
      √ 13. should reject legacy token without activeRole for privileged contexts without inferring array order (10 ms)
    Partner Suspension & Customer Independence
      √ 14. should suspend partner without modifying user account_status or revoking sessions (33 ms)
      √ 15. should block suspended partner from operational actions while allowing switch to CUSTOMER (44 ms)
    Refresh Token Rotation & Role Revocation
      √ 16. should preserve activeRole during token refresh if still assigned (29 ms)
      √ 17. should fallback safely to CUSTOMER if requested activeRole was revoked in database (25 ms)
    Privileged Role Administration (Super Admin Only)
      √ 18. should forbid operational ADMIN from assigning roles with 403 Forbidden (10 ms)
      √ 19. should allow SUPER_ADMIN to assign a privileged role to another user (18 ms)
      √ 20. should prevent self-escalation (Super Admin assigning roles to themselves) (9 ms)
      √ 21. should prevent self-revocation (Super Admin revoking their own role) (9 ms)
      √ 22. should allow SUPER_ADMIN to revoke a role from a user while preserving other roles (21 ms)
      √ 23. should prevent revoking the last remaining role from an account (12 ms)
      √ 24. should prevent removing the last SUPER_ADMIN from the platform (35 ms)
      √ 25. should atomically rollback role assignment when audit log insertion fails (31 ms)

Test Suites: 1 passed, 1 total
Tests:       27 passed, 27 total
Snapshots:   0 total
Time:        3.416 s
```

### B. Full Backend Regression Run (`npm test`)
```
Test Suites: 7 passed, 7 total
Tests:       112 passed, 112 total
Snapshots:   0 total
Time:        5.938 s
```
- `tests/phase6b.test.ts`: 27/27 PASS
- `tests/phase6a.test.ts`: 21/21 PASS
- `tests/phase6.test.ts`: 36/36 PASS
- `tests/auth.test.ts`: 19/19 PASS
- `tests/health.test.ts`: 2/2 PASS
- `tests/error-handling.test.ts`: 2/2 PASS
- `tests/env.test.ts`: 5/5 PASS

### C. Build & Typecheck Verification (`npm run build`)
```
> service-platform-backend@1.0.0 build
> tsc
(Exited with code 0, 0 compiler errors)
```

---

## 5. Security & Architectural Compliance Checklist

- [x] **PostgreSQL Backup Verified:** `backups/service_platform_db_backup_20261104092123_phase6a.sql` verified and readable.
- [x] **0 Database Migrations:** No schema alteration or migration was generated.
- [x] **Zero Microservices / Out-of-Scope Dependencies:** Architecture strictly preserved as a modular monolith.
- [x] **Zero Array-Order Inferences:** Tokens never infer privileged roles from `roles[0]`.
- [x] **Fail-Closed RBAC:** Missing role context safely rejects with 401/403.
- [x] **Self-Escalation & Self-Revocation Prevention:** Verified in integration tests.
- [x] **Atomic Transactions & Audit Trails:** Admin role assignments and revocations write audit logs within the same transaction with verified rollback.
- [x] **Customer Session Independence:** Dual-role partner suspensions do not impact customer booking access.
- [x] **Strict Stop Condition:** Complete Phase 6B only. Do not begin Phase 6C.
