# Version-Controlled Migration Plan & Execution Strategy (40 Tables)

**Database**: `service_platform_db`  
**Host**: `127.0.0.1:5432`  
**PostgreSQL Version**: 18.6  
**Status**: Pre-Migration Review Completed. **NO MIGRATIONS EXECUTED YET.**

---

## 1. Migration Sequence & Table Breakdown

Each migration is numbered sequentially, isolated in its own file under `migrations/`, and wrapped in an atomic `BEGIN; ... COMMIT;` transaction block.

```
migrations/
├── 001_baseline_existing_schema.sql         [BASELINE - 13 Tables, SKIPPED ON LIVE DB]
├── 002_user_addresses.sql                   [1 Table: user_addresses]
├── 003_vehicle_fleet.sql                    [3 Tables: vehicle_types, vehicles, partner_vehicles]
├── 004_shifting_inventory_labor.sql         [2 Tables: inventory_categories, inventory_items]
├── 005_services_rate_cards.sql              [2 Tables: services, service_rate_cards]
├── 006_pricing_rules_coupons.sql            [2 Tables: pricing_rules, coupons]
├── 007_bookings_assignments.sql             [7 Tables: bookings, booking_items, booking_inventory_items, booking_labor_details, fare_breakdowns, booking_assignments, booking_status_history]
├── 008_payments_wallets.sql                 [4 Tables: payments, refunds, partner_wallets, wallet_transactions]
├── 009_tracking_availability.sql            [3 Tables: partner_availability, partner_live_locations, partner_location_history]
├── 010_reviews_ratings.sql                  [1 Table: reviews_ratings]
└── 011_notifications_audit_logs.sql         [2 Tables: notifications, audit_logs]

Total Migration Tables: 27
Total Baseline Tables:  13
Total Master Platform:  40 Tables
```

---

## 2. Pre-Flight Safety Guarantees

1. **Backup Verification**:
   - `backups/service_platform_db_backup_20261103_191149.sql` (34,392 bytes) is verified on disk.
2. **Transaction Wrapping**:
   - Each migration file from `002` to `011` begins with `BEGIN;` and ends with `COMMIT;`. If any syntax error or failure occurs, PostgreSQL automatically rolls back the entire file with zero partial changes.
3. **Non-Destructive DDL**:
   - Every script uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.
   - **Zero** existing tables are modified or dropped. All 14 existing service categories and 6 existing roles remain untouched.
4. **Topological Order Verified**:
   - Verified via automated dependency analysis: 0 forward references.

---

## 3. How to Execute Migrations (Upon User Approval)

A unified PowerShell or Node.js runner can apply them sequentially:

```powershell
$envContent = Get-Content -Raw .env
$dbPass = ($envContent -split "`n" | Where-Object { $_ -match "^DB_PASSWORD=" }) -replace "^DB_PASSWORD=", ""
$env:PGPASSWORD = $dbPass.Trim()

$migrations = @(
    "002_user_addresses.sql",
    "003_vehicle_fleet.sql",
    "004_shifting_inventory_labor.sql",
    "005_services_rate_cards.sql",
    "006_pricing_rules_coupons.sql",
    "007_bookings_assignments.sql",
    "008_payments_wallets.sql",
    "009_tracking_availability.sql",
    "010_reviews_ratings.sql",
    "011_notifications_audit_logs.sql"
)

foreach ($m in $migrations) {
    Write-Host "Applying migration: $m..."
    & 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d service_platform_db -f "migrations/$m"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Migration $m failed! Aborting."
        break
    }
}

$env:PGPASSWORD = ''
```

---

## 4. Post-Migration Verification Queries

After executing migrations, the following query verifies all 40 tables are present:

```sql
SELECT count(*) AS total_tables 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
-- Expected: 40 (13 baseline + 27 new)
```

---

## 5. Rollback Contingency

Individual and bulk rollback scripts are stored under `migrations/rollback/`:
- `migrations/rollback/rollback_all_new_modules.sql`: Drops all 27 new tables atomically in reverse dependency order.
- `migrations/rollback/rollback_002_user_addresses.sql` through `rollback_011_notifications_audit_logs.sql`: Independent step rollbacks.
- Verified safe: **Zero baseline tables are targeted in any rollback script.**
- Original backup `backups/service_platform_db_backup_20261103_191149.sql` is ready for instant disaster recovery if ever needed.
