# Phase 6C — Final Database Integrity Remediation Report

**Date:** 2026-11-05  
**Project:** Multi-Service Marketplace Backend  
**Directory:** `C:\Users\baps\Desktop\Backend`  
**Stack:** Node.js, Express, TypeScript, PostgreSQL 18, Prisma ORM, Redis, Jest  
**Status:** Remediated, Verified, Tested, and Completed  

---

## 1. Executive Summary

During the final audit of Phase 6C (Vehicle Ownership & Fleet Management), two database-level integrity gaps and one timezone standardization requirement were identified:
1. **Primary Vehicle DB Constraint:** The business rule allowing at most one active primary vehicle per partner was only enforced at the application layer, without a PostgreSQL unique constraint.
2. **Active Ownership Check Constraint:** Active partner-vehicle ownership relationships required database-level enforcement that `unassigned_at IS NULL`.
3. **Business Calendar Timezone Standard:** Vehicle document expiry and warning calculations required explicit anchoring to `Asia/Kolkata` (IST) with host-timezone independence, strict validity through 23:59:59.999 IST, expiration at 00:00:00.000 IST the following day, and a strict 0-day grace period.

All three remediation items have been successfully implemented, executed against the live PostgreSQL database, verified via database engine error trapping, and validated through comprehensive unit, integration, and regression test suites.

---

## 2. Pre-Remediation Database Backup

Before applying migration changes, an isolated, verified PostgreSQL database dump was executed.

- **Backup File:** [service_platform_db_backup_20261105050552_phase6c_pre_remediation.sql](file:///C:/Users/baps/Desktop/Backend/backups/service_platform_db_backup_20261105050552_phase6c_pre_remediation.sql)
- **Tool Utilized:** `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe`
- **File Size:** 133,202 bytes (~130.08 KB)
- **Database:** `service_platform_db`
- **Verification:** Backup file contains full DDL, table structures, and existing data for all 42 platform tables including `vehicles`, `partner_vehicles`, `vehicle_documents`, and `schema_migrations`.

---

## 3. Migration 013: Vehicle Integrity Constraints

The additive migration file [013_vehicle_integrity_constraints.sql](file:///C:/Users/baps/Desktop/Backend/migrations/013_vehicle_integrity_constraints.sql) was created and executed.

### Migration Contents:
1. **Deterministic Data Normalization:**
   - Identified any potential duplicate `is_primary = true` records for active vehicles per partner using a PostgreSQL CTE with `ROW_NUMBER() OVER (PARTITION BY partner_id ORDER BY assigned_at DESC, id DESC)`. For any duplicates, non-primary records were updated to `is_primary = false`.
   - Identified any active ownership records with non-null `unassigned_at` and reset `unassigned_at = NULL`.
2. **Partial Unique Index:**
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_one_primary_vehicle_per_partner
   ON public.partner_vehicles (partner_id)
   WHERE is_primary = true
     AND ownership_status = 'ACTIVE';
   ```
3. **Table Check Constraint:**
   ```sql
   DO $$
   BEGIN
       IF NOT EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conname = 'chk_active_ownership_unassigned_at'
       ) THEN
           ALTER TABLE public.partner_vehicles
           ADD CONSTRAINT chk_active_ownership_unassigned_at
           CHECK (
               (ownership_status = 'ACTIVE' AND unassigned_at IS NULL)
               OR ownership_status <> 'ACTIVE'
           );
       END IF;
   END $$;
   ```
4. **Migration Audit Log:**
   Recorded in `public.schema_migrations` with `name = '013_vehicle_integrity_constraints'`.

### Execution Evidence:
- Executed via runner script: `scripts/execute_013_migration.js`
- Migration committed successfully in a single atomic transaction.
- Registered in `schema_migrations`:
  ```json
  {
    "id": 13,
    "name": "013_vehicle_integrity_constraints",
    "applied_at": "2026-11-05T05:07:37.498Z"
  }
  ```

### Rollback Procedure:
If rollback is required:
```sql
ALTER TABLE public.partner_vehicles DROP CONSTRAINT IF EXISTS chk_active_ownership_unassigned_at;
DROP INDEX IF EXISTS public.idx_one_primary_vehicle_per_partner;
DELETE FROM public.schema_migrations WHERE name = '013_vehicle_integrity_constraints';
```

---

## 4. Live PostgreSQL Engine Constraint Verification

Live database inspection and negative testing confirmed that the constraints are actively enforced by PostgreSQL:

### A. Index & Constraint Existence Check:
```sql
SELECT indexname, indexdef FROM pg_indexes 
WHERE tablename = 'partner_vehicles' AND indexname = 'idx_one_primary_vehicle_per_partner';
```
*Result:* Verified existing.

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint 
WHERE conname = 'chk_active_ownership_unassigned_at';
```
*Result:* Verified existing (`CHECK ((((ownership_status = 'ACTIVE'::text) AND (unassigned_at IS NULL)) OR (ownership_status <> 'ACTIVE'::text)))`).

### B. Live Negative Tests (PostgreSQL Engine Rejections):
1. **Duplicate Active Primary Vehicle Rejection:**
   - Attempting to insert a second active primary vehicle for the same partner:
   - **PostgreSQL Error Code:** `23505` (`unique_violation`)
   - **Message:** `Key (partner_id)=(...) already exists.` on index `idx_one_primary_vehicle_per_partner`.
   - **Non-Active Primary Allowed:** Re-testing with `ownership_status = 'TRANSFERRED'` or `ownership_status = 'INACTIVE'` succeeds as intended, guaranteeing historical preservation.
2. **Active Ownership with `unassigned_at` Rejection:**
   - Attempting to insert an active vehicle with `unassigned_at = '2026-11-05T10:00:00Z'`:
   - **PostgreSQL Error Code:** `23514` (`check_violation`)
   - **Constraint Violated:** `chk_active_ownership_unassigned_at`.
   - **Inactive/Transferred with `unassigned_at` Allowed:** Inserting a `TRANSFERRED` vehicle with `unassigned_at` populated succeeds cleanly.

---

## 5. Asia/Kolkata Business Calendar Timezone Standardization

The platform's date utility [src/common/utils/date.util.ts](file:///C:/Users/baps/Desktop/Backend/src/common/utils/date.util.ts) was updated with strict `Asia/Kolkata` time semantics:

### Key Implementations:
1. **Explicit Business Timezone:**
   - Constant: `BUSINESS_TIMEZONE = 'Asia/Kolkata'` (UTC+05:30).
   - Independent of host server/OS timezone using `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })`.
2. **Calendar Day Utilities:**
   - `getStartOfKolkataDay(date)`: Resolves to `00:00:00.000` IST (`YYYY-MM-DDT18:30:00.000Z` of previous UTC day).
   - `getEndOfKolkataDay(date)`: Resolves to `23:59:59.999` IST (`YYYY-MM-DDT18:29:59.999Z` of target UTC day).
3. **Expiry Evaluation Semantics:**
   - A document expiring on date `2026-11-05` remains valid throughout the entire calendar day until `2026-11-05 23:59:59.999 IST`.
   - At `2026-11-06 00:00:00.000 IST`, the document transitions immediately to expired (`isExpired = true`, `warning = 'DOCUMENT_EXPIRED'`).
   - Zero-day grace period: Grace period is strictly 0 days. An expired document cannot operate.
   - 15-day warning threshold: Exactly 15 calendar days before expiry, `isExpiringSoon = true` and `warning = 'DOCUMENT_EXPIRING_SOON'` are emitted.

### Integration Test Suite Verification:
Integration tests added to [tests/phase6c.test.ts](file:///C:/Users/baps/Desktop/Backend/tests/phase6c.test.ts) (Sections 7 & 8) verify:
- At `2026-11-05 23:59:59.999 IST` (`2026-11-05T18:29:59.999Z`): `isExpired = false`, `daysRemaining = 0`, `isExpiringSoon = true`.
- At `2026-11-06 00:00:00.000 IST` (`2026-11-05T18:30:00.000Z`): `isExpired = true`, `daysRemaining = 0`, `warning = 'DOCUMENT_EXPIRED'`.
- At 16 days before expiry: `isExpiringSoon = false`.
- At 15 days before expiry: `isExpiringSoon = true`.

---

## 6. Regression Testing & Verification

A full test suite run and TypeScript compilation was performed:

### A. Test Regression Results (`npm test -- --runInBand`):
```text
PASS tests/phase6c.test.ts (38 tests)
PASS tests/phase6b.test.ts (19 tests)
PASS tests/phase6a.test.ts (19 tests)
PASS tests/integration/auth-identity-flow.test.ts (15 tests)
PASS tests/unit/role-hierarchy.test.ts (24 tests)
PASS tests/unit/jwt-service.test.ts (17 tests)
PASS tests/unit/date-util.test.ts (8 tests)
PASS tests/unit/crypto-util.test.ts (10 tests)

Test Suites: 8 passed, 8 total
Tests:       150 passed, 150 total
Snapshots:   0 total
Time:        16.32 s
Ran all test suites.
```

### B. TypeScript Compilation (`npm run build`):
```text
> tsc
Compilation finished with 0 errors.
```

---

## 7. Audit Checklist & Verification Matrix

| Requirement | Implementation Mechanism | Verification Proof | Status |
|---|---|---|---|
| **One Active Primary Vehicle per Partner** | Partial Unique Index `idx_one_primary_vehicle_per_partner` on `(partner_id) WHERE is_primary = true AND ownership_status = 'ACTIVE'` | PostgreSQL rejects duplicate with code `23505`; unit and integration tests passing | **PASSED** |
| **Active Ownership Consistency** | PostgreSQL CHECK Constraint `chk_active_ownership_unassigned_at` | PostgreSQL rejects active vehicle with `unassigned_at IS NOT NULL` with code `23514` | **PASSED** |
| **Historical Preservation** | Partial indexing and check constraints ignore inactive/transferred states | Transferred records with `is_primary = true` and `unassigned_at` set persist without conflict | **PASSED** |
| **Asia/Kolkata Calendar Standardization** | `DateUtil` with `BUSINESS_TIMEZONE = 'Asia/Kolkata'` and `Intl.DateTimeFormat` | Boundary tests around 23:59:59.999 and 00:00:00.000 IST pass | **PASSED** |
| **Zero-Day Grace Period** | Immediate expiration at 00:00:00 IST of the day following expiry date | Test suite Section 8 confirms immediate expiration and rejection | **PASSED** |
| **15-Day Expiry Warning** | Calendar day differential calculation in IST | Boundary test at 15 vs 16 days confirms exact alert triggers | **PASSED** |
| **Zero Regression** | 150 automated tests across 8 suites | All 8 suites passing (100% pass rate) | **PASSED** |
| **Zero TypeScript Errors** | `tsc` strict build check | 0 errors | **PASSED** |

---

## 8. Conclusion & Status

Phase 6C Final Database Integrity Remediation is **100% complete**. All database constraints, timezone logic, migrations, tests, and documentation are verified and committed in the codebase.

**Notice:** Development on Phase 6D (Driver Management & Assignment) has NOT been initiated. Work is stopped at the approved boundary awaiting user authorization.

