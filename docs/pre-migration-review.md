# Comprehensive Pre-Migration Technical Review & Schema Audit

**Audit Date**: November 03, 2026  
**Auditor**: Senior Database Architect & Backend Systems Engineer  
**Database**: `service_platform_db` (PostgreSQL 18.6 Windows)  
**Status**: Read-only Verification Completed. **NO MIGRATIONS EXECUTED.**

---

## 1. Table Count Reconciliation & Resolution

### 1.1. Root Cause of Count Discrepancy
In the initial Phase 2 summary text, a grouping abstraction was used that stated *"13 baseline + 21 modules = 34 tables"*. However, during comprehensive DDL specification, six critical auxiliary junction and detail tables (`partner_vehicles`, `fare_breakdowns`, `booking_inventory_items`, `booking_labor_details`, `partner_location_history`, and `wallet_transactions`) were created as dedicated normalized tables.

The exact, verified count is:
- **Baseline Tables in Live DB**: **13 tables**
- **New Tables in Migrations 002–011**: **27 tables**
- **Total Unique Tables on Platform**: **40 tables**
- **Models Mapped in `prisma/schema.prisma`**: **40 models** (100% 1-to-1 exact parity)

### 1.2. Complete 40-Table Master Reconciliation Matrix

| # | Table Name | Source | Migration File | Prisma Model | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `users` | Baseline DB | Baseline (001) | `User` | Core user identity & mobile login |
| 2 | `roles` | Baseline DB | Baseline (001) | `Role` | System roles catalog (6 seeded) |
| 3 | `user_roles` | Baseline DB | Baseline (001) | `UserRole` | Many-to-many user-role assignments |
| 4 | `otp_verifications` | Baseline DB | Baseline (001) | `OtpVerification` | Mobile OTP authentication lifecycle |
| 5 | `user_sessions` | Baseline DB | Baseline (001) | `UserSession` | JWT refresh tokens & sessions |
| 6 | `customer_profiles` | Baseline DB | Baseline (001) | `CustomerProfile` | Customer profile attributes |
| 7 | `partner_profiles` | Baseline DB | Baseline (001) | `PartnerProfile` | Partner KYC, approval status |
| 8 | `partner_documents` | Baseline DB | Baseline (001) | `PartnerDocument` | Partner legal & KYC documents |
| 9 | `service_categories` | Baseline DB | Baseline (001) | `ServiceCategory` | Taxonomy (14 seeded categories) |
| 10 | `partner_skills` | Baseline DB | Baseline (001) | `PartnerSkill` | Verified skills per partner |
| 11 | `cities` | Baseline DB | Baseline (001) | `City` | Serviceable cities catalog |
| 12 | `areas` | Baseline DB | Baseline (001) | `Area` | City localities & GPS bounds |
| 13 | `partner_service_areas` | Baseline DB | Baseline (001) | `PartnerServiceArea` | Partner operational territory |
| 14 | `user_addresses` | New Module | `002_user_addresses.sql` | `UserAddress` | Customer & partner saved addresses |
| 15 | `vehicle_types` | New Module | `003_vehicle_fleet.sql` | `VehicleType` | Truck/tempo classes (Tata Ace, etc.) |
| 16 | `vehicles` | New Module | `003_vehicle_fleet.sql` | `Vehicle` | Registered vehicle fleet |
| 17 | `partner_vehicles` | New Module | `003_vehicle_fleet.sql` | `PartnerVehicle` | Partner-to-vehicle mapping |
| 18 | `inventory_categories` | New Module | `004_shifting_inventory_labor.sql` | `InventoryCategory` | Shifting room/item categories |
| 19 | `inventory_items` | New Module | `004_shifting_inventory_labor.sql` | `InventoryItem` | Standard item volume catalog |
| 20 | `services` | New Module | `005_services_rate_cards.sql` | `Service` | Granular home service packages |
| 21 | `service_rate_cards` | New Module | `005_services_rate_cards.sql` | `ServiceRateCard` | City-wise visiting & hourly rates |
| 22 | `pricing_rules` | New Module | `006_pricing_rules_coupons.sql` | `PricingRule` | Fare matrix for shifting & vehicles |
| 23 | `coupons` | New Module | `006_pricing_rules_coupons.sql` | `Coupon` | Discounts & promo codes |
| 24 | `bookings` | New Module | `007_bookings_assignments.sql` | `Booking` | Central booking entity |
| 25 | `booking_items` | New Module | `007_bookings_assignments.sql` | `BookingItem` | Line items for home services |
| 26 | `booking_inventory_items`| New Module | `007_bookings_assignments.sql` | `BookingInventoryItem` | Selected furniture/boxes for move |
| 27 | `booking_labor_details` | New Module | `007_bookings_assignments.sql` | `BookingLaborDetail` | Floors, elevators & helper counts |
| 28 | `fare_breakdowns` | New Module | `007_bookings_assignments.sql` | `FareBreakdown` | Itemized financial fare breakdown |
| 29 | `booking_assignments` | New Module | `007_bookings_assignments.sql` | `BookingAssignment` | Partner job dispatch & responses |
| 30 | `booking_status_history` | New Module | `007_bookings_assignments.sql` | `BookingStatusHistory` | Append-only state transition audit |
| 31 | `payments` | New Module | `008_payments_wallets.sql` | `Payment` | Customer gateway payments & cash |
| 32 | `refunds` | New Module | `008_payments_wallets.sql` | `Refund` | Customer payment refunds |
| 33 | `partner_wallets` | New Module | `008_payments_wallets.sql` | `PartnerWallet` | Partner operational balance store |
| 34 | `wallet_transactions` | New Module | `008_payments_wallets.sql` | `WalletTransaction` | Partner wallet transaction log |
| 35 | `partner_availability` | New Module | `009_tracking_availability.sql` | `PartnerAvailability` | Online/busy status & active booking |
| 36 | `partner_live_locations` | New Module | `009_tracking_availability.sql` | `PartnerLiveLocation` | High-frequency latest GPS position |
| 37 | `partner_location_history` | New Module | `009_tracking_availability.sql` | `PartnerLocationHistory` | Breadcrumbs during active trip |
| 38 | `reviews_ratings` | New Module | `010_reviews_ratings.sql` | `ReviewRating` | 2-way ratings & customer feedback |
| 39 | `notifications` | New Module | `011_notifications_audit_logs.sql` | `Notification` | In-app, push & SMS alert records |
| 40 | `audit_logs` | New Module | `011_notifications_audit_logs.sql` | `AuditLog` | Admin actions & compliance audit |

---

## 2. Rigorous Migration Review

### 2.1. Topological Execution Order
- Validated via automated dependency graph analyzer (`scripts/check_migration_order.js`).
- Result: **0 forward reference violations**. Every foreign key points either to a table created in an earlier migration file or earlier within the same script.

### 2.2. Transaction Atomicity & Safety
- **Every migration file (002 through 011)** is explicitly wrapped in `BEGIN; ... COMMIT;`. If any syntax, permission, or constraint error occurs during execution, PostgreSQL rolls back the entire file atomically.
- All DDL statements use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.

### 2.3. Baseline Preservation & Rollback Safety
- **Zero baseline tables are altered or dropped**. All 14 service categories and 6 roles remain intact.
- Rollback scripts (`migrations/rollback/rollback_all_new_modules.sql` and individual files `rollback_002` to `rollback_011`) were statically scanned against the 13 baseline tables. **Result**: 0 baseline tables targeted. Rollbacks only drop newly introduced tables.

### 2.4. Financial Precision
- All monetary fields (`base_fare`, `per_km_rate`, `visiting_charge`, `total_price`, `amount`, `refund_amount`, `available_balance`, `closing_balance`) strictly use `numeric(10, 2)` or `numeric(12, 2)`.
- Zero floating-point (`real` or `double precision`) types are used for currency.

### 2.5. Concurrency & Idempotency Controls
- `uq_booking_partner_assignment` on `booking_assignments(booking_id, partner_id)`: Prevents assigning the same partner twice to a booking.
- `UNIQUE(gateway_payment_id)` and `UNIQUE(idempotency_key)` on `payments`: Prevents double charging customer credit cards or webhooks.
- `uq_service_city_rate` on `service_rate_cards(service_id, city_id)`: Prevents rate card collision.
- `uq_booking_reviewer` on `reviews_ratings(booking_id, reviewer_user_id)`: Prevents multiple reviews from the same party on a single job.

---

## 3. Prisma Schema Validation

Our custom schema verification engine (`scripts/validate_schema_against_sql.js`) ran a comprehensive check:
1. **Model Coverage**: All 40 tables (13 baseline + 27 migration) have exact mapped models.
2. **Foreign Key Parity**: Every single foreign key constraint across all 27 new tables has a matching `@relation` with identical source fields, reference fields, and `onDelete` actions (`Cascade`, `Restrict`, `SetNull`).
3. **Bi-directional Back-Relations**: Every relation has a corresponding relation field on the target model.
4. **Data Types**: All `BIGINT` match `BigInt`, `TIMESTAMPTZ` match `DateTime @db.Timestamptz`, `NUMERIC` match `Decimal`.

---

## 4. Deep Business Logic & Financial Ledger Evaluation

### 4.1. Core Workflow Verification
| Business Requirement | Verification Status | Architectural Implementation |
| :--- | :--- | :--- |
| **Multi-role per user** | Supported | `user_roles` links 1 `user_id` to multiple `role_id`s |
| **Multi-service per partner** | Supported | `partner_skills` maps 1 `partner_id` to multiple `service_category_id`s |
| **Independent partner & skill approval** | Supported | `partner_profiles.approval_status` is platform-level KYC; `partner_skills.verification_status` is service-level qualification |
| **Multi-city & area coverage** | Supported | `cities`, `areas`, and `partner_service_areas` support both city-wide (`coverage_type='CITY'`) and localized (`coverage_type='AREA'`) operations |
| **Workflows bifurcation** | Supported | **Home Services** use `booking_items` + `services` + `service_rate_cards`. **Shifting** uses `booking_inventory_items` + `booking_labor_details` + `vehicle_types` |
| **Multi-helper & vehicle logistics** | Supported | `booking_labor_details.helpers_count_requested` tracks helpers count. `booking_assignments` allows assigning multiple partners with roles `PRIMARY_PARTNER`, `DRIVER`, and `WORKER_HELPER` |
| **Audit trail of booking states** | Supported | `booking_status_history` creates an immutable chronological record of every status change (`from_status`, `to_status`, `changed_by`, `comment`) |

### 4.2. Critical Analysis: Double-Entry Accounting vs Balance Snapshots
The user specifically requested:
> *"Also verify whether the proposed wallet ledger genuinely supports double-entry accounting or only balance snapshots."*

#### Finding:
The proposed `partner_wallets` + `wallet_transactions` table structure is **NOT true double-entry bookkeeping**. It is an **Operational Single-Entry Passbook Ledger with Balance Snapshots**.

- **Why it is Single-Entry with Snapshots**:
  Each row in `wallet_transactions` records an event on a single partner's wallet, storing `amount`, `opening_balance`, and `closing_balance`. There is no offsetting Debit and Credit entry recorded simultaneously across system-wide asset, liability, and revenue accounts.
- **What Genuine Double-Entry Accounting Requires**:
  In a true double-entry ledger:
  $$\sum \text{Debits} = \sum \text{Credits}$$
  When a customer pays ₹1,000 for a booking:
  - **Debit**: `Platform Clearing / Gateway Escrow Asset Account` (+₹1,000)
  - **Credit**: `Partner Payable Liability Account` (+₹800)
  - **Credit**: `Platform Commission Revenue Account` (+₹200)
- **Architectural Recommendation**:
  For high-scale on-demand platforms, the best practice is a **Hybrid Two-Tier Financial Architecture**:
  1. **Tier 1 (Operational Wallet - Current `partner_wallets`)**: Used by the mobile app for instant balance display, daily withdrawal requests, and fast balance checks.
  2. **Tier 2 (General Ledger - Enterprise Upgrade)**: When financial audit and multi-party taxation (GST/TDS) reporting are required, introduce a dedicated general ledger with `ledger_accounts`, `journal_entries`, and `journal_lines`.

---

## 5. Location Architecture Evaluation: B-Tree vs PostGIS vs Redis

The user requested:
> *"Evaluate whether latitude/longitude numeric columns with ordinary indexes are sufficient for the expected nearby-partner search workload. Clearly distinguish ordinary B-tree indexes from actual spatial indexes."*

### 5.1. Technical Comparison: B-Tree vs Spatial GiST

| Feature | Ordinary B-Tree (`numeric`) | Spatial GiST / PostGIS (`geometry/geography`) |
| :--- | :--- | :--- |
| **Dimensionality** | 1-Dimensional linear hierarchy | 2-Dimensional R-Tree (Bounding Box Hierarchies) |
| **Range Queries** | `WHERE lat BETWEEN y1 AND y2`: Efficient for 1st column, but requires scanning leaf nodes to filter 2nd column (`lon`) | `ST_DWithin(geom, point, radius)`: Prunes 2D space simultaneously in $$O(\log N)$$ |
| **Distance Calculation** | Requires running the **Haversine formula** (trigonometric `sin`, `cos`, `atan2`) on every candidate row | Built-in ellipsoidal geodesic distance directly computed using optimized C routines |
| **KNN (Nearest Neighbor)** | Cannot sort by distance in the index. Must compute distance for all rows and sort in memory | Native `<->` KNN operator returns the $K$ closest partners directly using the index tree without scanning non-candidate points |
| **Write Overhead** | Low to medium | Higher (geometry bounding box recalculation) |

### 5.2. Evaluation for On-Demand Workload
1. **PostGIS Availability**:
   - Our environment audit confirmed that PostGIS is **not installed** in the local Windows PostgreSQL 18 setup.
2. **The High-Concurrency Bottleneck**:
   - In an on-demand platform with 2,000 active partners pinging GPS every 3–5 seconds:
     - Sending 400 to 600 GPS writes per second directly into PostgreSQL will cause massive **Write-Ahead Log (WAL) bloat, checkpoint lag, and table bloat** due to MVCC row versioning.
   - **PostgreSQL should not be the primary ingest point for real-time driver GPS pings.**
3. **The Recommended High-Performance Dispatch Architecture**:
   - **Hot Tier (Redis In-Memory)**:
     - Driver mobile apps send live GPS pings to Node.js WebSocket / Socket.IO.
     - Node updates Redis using `GEOADD partners:available <longitude> <latitude> <partner_id>`.
     - When a customer requests a service or shifting truck, Node executes:
       `GEOSEARCH partners:available FROMLONLAT <cust_lon> <cust_lat> BYRADIUS 5 km WITHDIST WITHCOORD`.
     - **Execution time in Redis**: **< 1 millisecond** with zero disk I/O!
   - **Cold / Persistence Tier (PostgreSQL)**:
     - `partner_live_locations`: Updated only on meaningful events (going online/offline, accepting a job, job arrival).
     - `partner_location_history`: Records waypoint breadcrumbs at 30-second intervals during an active trip.
     - B-Tree index on `(partner_id)` and `(booking_id)` is 100% sufficient for historical trip route display.

---

## 6. Pre-Migration Verification Checklist

- [x] Full database backup created (`backups/service_platform_db_backup_20261103_191149.sql`).
- [x] All 13 baseline tables preserved with zero modifications.
- [x] Exactly 27 new migration tables defined (total 40 tables).
- [x] All migration files wrapped in explicit `BEGIN; ... COMMIT;` blocks.
- [x] Zero forward-reference dependency violations in migrations.
- [x] 10 individual rollback scripts created and verified non-destructive to baseline.
- [x] Prisma schema verified with exact 40-model parity and foreign key alignment.
- [x] Live PostgreSQL database has NOT been modified.

**Awaiting user explicit approval to execute migrations.**

