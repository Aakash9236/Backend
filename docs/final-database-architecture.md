# Complete Platform Database Architecture (40 Tables)

**Platform**: Multi-Service On-Demand Platform  
**Target Engine**: PostgreSQL 18.6 (Windows x64)  
**Schema Count**: 13 Baseline Audited Tables + 27 Incremental Migration Tables = **40 Total Tables**  
**Architecture Style**: High-Concurrency Normalized Relational Schema with Audit Trails & Financial Ledgers

---

## 1. Architectural Principles & Business Rules

### 1.1. Multi-City & Geography
- Every transaction (booking, address, partner service area, vehicle rate card, pricing rule) is scoped to a valid `city_id`.
- Granular localities are scoped via `areas` with GPS coordinates.

### 1.2. Multi-Role Identity
- A user (`users`) starts with mobile authentication and can hold multiple simultaneous roles (`user_roles` linking to `roles`: `CUSTOMER`, `PARTNER`, `DRIVER`, `WORKER`, `ADMIN`, `SUPER_ADMIN`).

### 1.3. Multi-Service Partner Qualification
- A partner (`partner_profiles`) can be verified for multiple service lines (`partner_skills` referencing `service_categories`).
- **Core Guard**: Partner status defaults to `PENDING` and must be manually verified by Admin (`reviewed_by`, `approval_status = 'APPROVED'`) before receiving assignments. Skill verification (`partner_skills.verification_status`) is maintained independently.

### 1.4. Segregated Business Workflows
- **On-Demand Home Services**: Visited by a single technician (Electrician, Plumber, AC Repair). Uses `booking_items` referencing granular `services` and city-wise `service_rate_cards`.
- **Home & Office Shifting**: Multi-party logistics workflow involving vehicle selection (`vehicle_types`, `vehicles`), inventory item volume calculations (`booking_inventory_items`), elevator/floor fees and loading/unloading labor helpers (`booking_labor_details`).

### 1.5. Location Architecture: Hot Tier (Redis) vs Cold Tier (PostgreSQL)
- **PostGIS Evaluation**: PostGIS is not installed in this PostgreSQL instance. Furthermore, streaming 500+ GPS updates/sec directly to PostgreSQL causes severe WAL write-amplification and table bloat.
- **Production Architecture**:
  - **Real-Time Dispatch (Redis Hot Tier)**: Driver apps update Redis via Socket.IO using `GEOADD`. Nearest partner matching is executed in-memory using `GEOSEARCH` in < 1ms.
  - **Database Persistence (Cold Tier)**: PostgreSQL stores coordinates in `numeric(10, 7)`. `partner_live_locations` stores the latest state on major transitions, while `partner_location_history` records trip route breadcrumbs at 30-second intervals for active bookings.

### 1.6. Financial Ledger: Operational Wallet vs True Double-Entry General Ledger
- **Current Operational Wallet (`partner_wallets`, `wallet_transactions`)**: Implements an **Operational Single-Entry Passbook Ledger with Balance Snapshots**. Every transaction logs the immutable `amount`, `opening_balance`, and `closing_balance` to audit partner balances and prevent race conditions.
- **Enterprise Double-Entry Upgrade Path**: When multi-party corporate taxation (GST/TDS) and general ledger audits are required, a formal Chart of Accounts (`ledger_accounts`, `journal_entries`, `journal_lines`) can be added where every event debits and credits offsetting accounts ($\sum \text{Debits} = \sum \text{Credits}$).
- **Anti-Duplicate Guarantees**:
  - `UNIQUE(gateway_payment_id)` and `UNIQUE(idempotency_key)` on `payments` prevent double payments.
  - `UNIQUE(booking_id, partner_id)` on `booking_assignments` prevents duplicate job dispatch.

---

## 2. Complete 40-Table Inventory by Domain

### Group A: Identity, Authentication & Roles (5 Tables)
1. `users` (Baseline): Primary user identities
2. `roles` (Baseline): System roles catalog
3. `user_roles` (Baseline): User to roles mapping
4. `otp_verifications` (Baseline): Mobile OTP verification tracking
5. `user_sessions` (Baseline): Active login sessions & refresh tokens

### Group B: Profiles, KYC & Documents (3 Tables)
6. `customer_profiles` (Baseline): Customer specific data
7. `partner_profiles` (Baseline): Partner onboarding & approval status
8. `partner_documents` (Baseline): KYC legal proofs & reviews

### Group C: Geography & Coverage (4 Tables)
9. `cities` (Baseline): Multi-city master catalog
10. `areas` (Baseline): Locality boundaries within cities
11. `partner_service_areas` (Baseline): Operational coverage definitions
12. `user_addresses` (New - 002): Multi-address customer & partner address book

### Group D: Taxonomy, Services & Fleet (7 Tables)
13. `service_categories` (Baseline): Hierarchical category tree
14. `partner_skills` (Baseline): Partner skill qualifications
15. `vehicle_types` (New - 003): Vehicle classifications & capacity limits
16. `vehicles` (New - 003): Registered transport fleet
17. `partner_vehicles` (New - 003): Driver to vehicle operational mapping
18. `services` (New - 005): Specific catalog service offerings
19. `service_rate_cards` (New - 005): City-wise rate cards for home services

### Group E: Shifting Inventory & Moving Labor (4 Tables)
20. `inventory_categories` (New - 004): Room and furniture classifications
21. `inventory_items` (New - 004): Standard moving items & cubic-feet volumes
22. `booking_inventory_items` (New - 007): Selected inventory items per booking
23. `booking_labor_details` (New - 007): Floors, elevators, helper counts & fees

### Group F: Booking Engine & Assignments (5 Tables)
24. `pricing_rules` (New - 006): Fare calculation matrix for moving & vehicles
25. `coupons` (New - 006): Promotional discount engine
26. `bookings` (New - 007): Master booking record and schedule
27. `booking_items` (New - 007): Line items for home services
28. `fare_breakdowns` (New - 007): Transparent cost breakdown per booking

### Group G: Dispatch, Tracking & Lifecycle (5 Tables)
29. `booking_assignments` (New - 007): Partner dispatch and acceptance tracking
30. `booking_status_history` (New - 007): Immutable booking state audit log
31. `partner_availability` (New - 009): Partner online/busy status
32. `partner_live_locations` (New - 009): Latest GPS coordinates
33. `partner_location_history` (New - 009): GPS breadcrumb route tracking

### Group H: Payments, Wallets, Ratings & Governance (7 Tables)
34. `payments` (New - 008): Gateway payment transactions & idempotency
35. `refunds` (New - 008): Payment refund tracking
36. `partner_wallets` (New - 008): Partner operational wallet balances
37. `wallet_transactions` (New - 008): Wallet ledger transactions with balance snapshots
38. `reviews_ratings` (New - 010): Verified two-way feedback
39. `notifications` (New - 011): In-app, SMS & Push alert audit
40. `audit_logs` (New - 011): Admin actions & compliance audit trail
