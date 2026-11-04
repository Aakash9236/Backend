# Master Project Architecture Reconciliation Audit

**Date of Audit**: November 4, 2026  
**Auditor**: Senior Backend Architect, PostgreSQL Database Engineer & Security Specialist  
**Execution Mode**: READ-ONLY Architectural Audit  
**Workspace**: `C:\Users\baps\Desktop\Backend`  
**Database**: `service_platform_db` (PostgreSQL 18 on `127.0.0.1:5432`)

---

## 1. Executive Summary

This document provides a comprehensive, verified reconciliation of the current implementation of the Multi-Service On-Demand Platform backend against the finalized platform business architecture.

### Current Implementation State
- **PostgreSQL Database**: 41 total tables in `public` schema (40 business tables + 1 `schema_migrations` tracking table).
- **Prisma Schema**: 41 models in `prisma/schema.prisma` with 100% 1:1 parity with live database tables.
- **Relational Integrity**: 66 Foreign Keys, 32 Unique Constraints, and 118 Indexes verified in PostgreSQL.
- **Migration History**: 11 sequential atomic migrations (001 through 011) successfully executed and tracked.
- **Backend Architecture**: Modular Monolith on Node.js, Express.js, TypeScript, Prisma ORM, Winston, and Zod.
- **Active Endpoints**: 41 endpoints across Health, Auth, Users, Addresses, Customer Profiles, Partners, Admin, and Locations.
- **Automated Test Suite**: 62 automated tests across 5 test suites (`tests/`), passing at 100%.

### Key Reconciliation Findings
1. **Strong Foundational Parity**: Auth, multi-role users, customer profiles, address management, and partner onboarding foundations are solidly built.
2. **Missing Sub-System Models**: The current schema lacks explicit models for:
   - Vehicle Ownership vs. Driver Assignment separation.
   - Driver invitation, onboarding, and acceptance lifecycle.
   - Independent Worker registration and multi-partner affiliations.
   - Configurable KYC document requirements matrix.
   - Granular Admin / Super-Admin permission management.
3. **Phase 6 Audit Gaps Still Present**:
   - Zero-document or unverified-document partner approval is still technically allowed in `AdminService.approvePartner`.
   - Partner suspension sets `approvalStatus = 'SUSPENDED'` but does not revoke partner tokens or block partner-specific endpoints.
   - No authenticated API exists to download/stream KYC files for admin visual verification.
   - Admin operations and audit log entries are executed sequentially without atomic database transactions.

---

## 2. Existing System Inventory

### 2.1. PostgreSQL Table Inventory (Verified Live)

| # | Table Name | Type | Purpose | Migration Origin |
|---|---|---|---|---|
| 1 | `users` | Base Table | Central identity table (mobile number, status, verification flag) | 001 Baseline |
| 2 | `roles` | Base Table | Platform role definitions (6 pre-seeded roles) | 001 Baseline |
| 3 | `user_roles` | Base Table | Junction table: maps users to multiple roles | 001 Baseline |
| 4 | `otp_verifications` | Base Table | Mobile OTP requests, cryptographic hashes, attempts, status | 001 Baseline |
| 5 | `user_sessions` | Base Table | Refresh token hashes, session expiry, IP/UserAgent, revocation | 001 Baseline |
| 6 | `customer_profiles` | Base Table | Customer details (name, DOB, gender, avatar) | 001 Baseline |
| 7 | `partner_profiles` | Base Table | Partner profiles (individual/business, approval status, review) | 001 Baseline |
| 8 | `partner_documents` | Base Table | Partner KYC documents, storage keys, verification status | 001 Baseline |
| 9 | `service_categories` | Base Table | Hierarchical service taxonomy (14 pre-seeded categories) | 001 Baseline |
| 10 | `partner_skills` | Base Table | Technical qualifications linking partners to service categories | 001 Baseline |
| 11 | `cities` | Base Table | Operational cities (Mumbai, Bengaluru, Delhi, etc.) | 001 Baseline |
| 12 | `areas` | Base Table | Municipal sub-divisions within cities with coordinates & PIN | 001 Baseline |
| 13 | `partner_service_areas` | Base Table | Partner operational coverage (CITY or AREA bounds) | 001 Baseline |
| 14 | `user_addresses` | Base Table | User saved locations (Home, Work, Other, coordinates, default) | 002 Addresses |
| 15 | `vehicle_types` | Base Table | Vehicle classifications, capacities (kg/cuft), base rates | 003 Vehicles |
| 16 | `vehicles` | Base Table | Physical fleet registry (registration, RC, fitness, insurance) | 003 Vehicles |
| 17 | `partner_vehicles` | Base Table | Junction linking partners to vehicles | 003 Vehicles |
| 18 | `inventory_categories` | Base Table | Shifting item groups (Living Room, Bedroom, Electronics) | 004 Shifting |
| 19 | `inventory_items` | Base Table | Shifting inventory catalog (volume, weight, fragile flag) | 004 Shifting |
| 20 | `services` | Base Table | Catalog of bookable on-demand home services | 005 Services |
| 21 | `service_rate_cards` | Base Table | Rate cards linking services to specific cities | 005 Services |
| 22 | `pricing_rules` | Base Table | Dynamic pricing rules (peak, rain, night, vehicle surcharges) | 006 Pricing |
| 23 | `coupons` | Base Table | Promotional discount codes, validity windows, usage limits | 006 Pricing |
| 24 | `bookings` | Base Table | Core booking transaction table for shifting and home services | 007 Bookings |
| 25 | `booking_items` | Base Table | Line items for on-demand home service bookings | 007 Bookings |
| 26 | `booking_inventory_items` | Base Table | Inventory items booked for shifting moves | 007 Bookings |
| 27 | `booking_labor_details` | Base Table | Shifting labor details (floors, elevators, helpers requested) | 007 Bookings |
| 28 | `fare_breakdowns` | Base Table | Itemized financial breakdown for each booking | 007 Bookings |
| 29 | `booking_assignments` | Base Table | Dispatch offers, partner allocations, response tracking | 007 Bookings |
| 30 | `booking_status_history` | Base Table | State audit trail for booking status lifecycle changes | 007 Bookings |
| 31 | `payments` | Base Table | Payment gateway transactions, authorized/captured amounts | 008 Payments |
| 32 | `refunds` | Base Table | Customer payment refunds and processing statuses | 008 Payments |
| 33 | `partner_wallets` | Base Table | Ledger balances, pending payouts, currency for partners | 008 Payments |
| 34 | `wallet_transactions` | Base Table | Immutable credit/debit transaction log for partner wallets | 008 Payments |
| 35 | `partner_availability` | Base Table | Partner real-time availability and shift status | 009 Tracking |
| 36 | `partner_live_locations` | Base Table | Real-time GPS location coordinates of active partners/drivers | 009 Tracking |
| 37 | `partner_location_history` | Base Table | Breadcrumb GPS telemetry history during active jobs | 009 Tracking |
| 38 | `reviews_ratings` | Base Table | Post-booking ratings and reviews between customers and partners | 010 Reviews |
| 39 | `notifications` | Base Table | Multichannel notifications (In-app, SMS, Push) | 011 Notif/Audit |
| 40 | `audit_logs` | Base Table | Immutable administrative and sensitive transaction audit log | 011 Notif/Audit |
| 41 | `schema_migrations` | System Table | Migration tracking table (id, migration_name, executed_at) | Platform Seed |

### 2.2. Constraints & Indexes Summary
- **Foreign Keys**: 66 verified in `information_schema.table_constraints`.
- **Unique Constraints**: 32 verified in `information_schema.table_constraints`.
- **Database Indexes**: 118 verified in `pg_indexes`.
- **Pre-seeded Roles** (`roles` table):
  1. `CUSTOMER`: End consumer booking services or shifting.
  2. `PARTNER`: Professional service provider or shifting contractor.
  3. `DRIVER`: Vehicle operator.
  4. `WORKER`: Loading and unloading specialist.
  5. `ADMIN`: Operations administrator.
  6. `SUPER_ADMIN`: Root platform administrator.
- **Pre-seeded Service Categories** (`service_categories` table): 14 operational categories (Home Services, Shifting, Vehicle Services, Electrician, Plumber, Carpenter, AC Repair, Motor Mechanic, etc.).

---

## 3. Architecture Alignment Analysis (Requirements vs. Current State)

### A. Identity and Account Management
- **One mobile number = One user**: Fully supported (`users.mobile_number` UNIQUE).
- **OTP-based auth**: Fully supported (cryptographic random OTP, salted SHA-256 hash, attempt lockout, replay protection).
- **Multiple roles per user**: Fully supported (`user_roles` junction table).
- **Separate registration and approval**: Supported for Partners (`approval_status = 'PENDING'`), but **not supported for Drivers or Workers** (no driver/worker approval state tables exist).
- **Role switching in Partner App**: Backend supports multiple roles on JWT, but no dedicated `POST /api/v1/auth/switch-role` endpoint exists to issue role-scoped context tokens.

### B. Partner App Unified Architecture
- **Single Partner App**: Supported architecturally.
- **Multi-trade onboarding**: Supported for service trades (`partner_skills`), but **missing invitation and registration flows** for Drivers and Workers.

### C. Vehicle Ownership Architecture
- **Registered Owner**: Current schema links vehicles via `partner_vehicles` (`partner_id`, `vehicle_id`, `is_primary`).
- **Gap Identified**: `vehicles` does not distinguish between **vehicle owner** and **assigned driver**. `partner_vehicles` serves as a generic junction without tracking ownership deeds, lease agreements, or driver assignment history.

### D. Driver Management Architecture
- **Gap Identified**: Completely missing from existing schema and APIs:
  - No `driver_invitations` table (owner invites driver by mobile number).
  - No driver acceptance/rejection lifecycle.
  - No `vehicle_driver_assignments` table to track which driver is actively operating which vehicle with assignment start/end history.
  - No dedicated driver KYC/license verification workflow.

### E. Worker Management Architecture
- **Gap Identified**: Completely missing from existing schema and APIs:
  - No `worker_profiles` table for loading/unloading specialists.
  - No `worker_affiliations` table to allow workers to affiliate with multiple vehicle partners.
  - No independent worker dispatch availability flag.

### F. Professional Skills Architecture
- **Multiple skills**: Fully supported via `partner_skills`.
- **Independent verification**: Fully supported (`partner_skills.verification_status` is independent of `partner_profiles.approval_status`).
- **Admin verification APIs**: Fully supported (`PATCH /api/v1/admin/partners/skills/:id/verify`).

### G. KYC and Document Verification
- **Current Support**: Single `partner_documents` table with `document_type`, `document_storage_key`, `verification_status`.
- **Gaps Identified**:
  - No vehicle document model (vehicle RC, insurance, fitness, permit are stored as date columns on `vehicles`, not verifiable documents).
  - No driver license document model.
  - Document requirements are hardcoded/unconfigured. No configurable KYC rule matrix exists.
  - Document statuses only support `PENDING`, `VERIFIED`, `REJECTED`. Missing `EXPIRED` and `RESUBMISSION_REQUIRED`.

### H. Admin & Super Admin Governance
- **Role separation**: Seeded roles `ADMIN` and `SUPER_ADMIN`.
- **Self-approval guard**: Implemented and verified in `AdminService`.
- **Audit logging**: Implemented via `audit_logs`.
- **Gaps Identified**:
  - No granular admin permissions (all admins have global access).
  - Admin operations and audit log entries are non-atomic (not wrapped in `prisma.$transaction`).

---

## 4. Current API Inventory

The backend exposes **41 active endpoints**:

```
Health (2):
  GET  /api/v1/health
  GET  /api/v1/health/database

Auth (6):
  POST /api/v1/auth/otp/request
  POST /api/v1/auth/otp/verify
  POST /api/v1/auth/refresh
  POST /api/v1/auth/logout
  POST /api/v1/auth/logout-all
  GET  /api/v1/auth/me

Users & Addresses (10):
  GET    /api/v1/users/me
  PATCH  /api/v1/users/me
  GET    /api/v1/users/me/roles
  DELETE /api/v1/users/me
  POST   /api/v1/users/me/addresses
  GET    /api/v1/users/me/addresses
  GET    /api/v1/users/me/addresses/:id
  PATCH  /api/v1/users/me/addresses/:id
  DELETE /api/v1/users/me/addresses/:id
  PATCH  /api/v1/users/me/addresses/:id/default

Customers (3):
  GET   /api/v1/customers/profile
  POST  /api/v1/customers/profile
  PATCH /api/v1/customers/profile

Partners (9):
  POST  /api/v1/partners/onboarding
  GET   /api/v1/partners/profile
  PATCH /api/v1/partners/profile
  POST  /api/v1/partners/documents
  GET   /api/v1/partners/documents
  POST  /api/v1/partners/skills
  GET   /api/v1/partners/skills
  POST  /api/v1/partners/service-areas
  GET   /api/v1/partners/service-areas

Admin (9):
  GET   /api/v1/admin/partners/pending
  GET   /api/v1/admin/partners/:id
  PATCH /api/v1/admin/partners/:id/approve
  PATCH /api/v1/admin/partners/:id/reject
  PATCH /api/v1/admin/partners/:id/suspend
  PATCH /api/v1/admin/partners/documents/:id/verify
  PATCH /api/v1/admin/partners/documents/:id/reject
  PATCH /api/v1/admin/partners/skills/:id/verify
  PATCH /api/v1/admin/partners/skills/:id/reject

Locations (2):
  GET   /api/v1/locations/cities
  GET   /api/v1/locations/cities/:cityId/areas
```

