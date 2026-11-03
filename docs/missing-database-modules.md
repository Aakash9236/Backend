# Missing Database Modules & Proposed Architecture

**Platform**: Multi-Service On-Demand Platform  
**Target Database**: `service_platform_db` (PostgreSQL 18)  
**Document Purpose**: Definitive schema design for all remaining platform modules prior to running migrations.

---

## 1. Overview of Missing Modules

The existing 13 tables provide core identity, partner KYC onboarding, and geography master catalogs. To support **Customer Booking**, **Home & Office Shifting**, **Vehicle Booking**, **Loading/Unloading Labor**, and **Professional Home Services**, the following 11 modules and **21 tables** are required:

| Module | Purpose | New Tables Required |
| :--- | :--- | :--- |
| **1. Addresses** | Customer & Partner saved multi-addresses | `user_addresses` |
| **2. Vehicles & Fleet** | Vehicle types (Tata Ace, Pickup, etc.) & driver fleet | `vehicle_types`, `vehicles`, `partner_vehicles` |
| **3. Shifting & Inventory**| Shifting item catalog, volume/cubic ft, floor & elevator details | `inventory_categories`, `inventory_items`, `booking_inventory_items`, `booking_labor_details` |
| **4. Service Rate Cards** | Granular service packages & hourly/fixed rate cards | `services`, `service_rate_cards` |
| **5. Bookings Engine** | Booking lifecycle, items, assignments & status audit trail | `bookings`, `booking_items`, `booking_assignments`, `booking_status_history` |
| **6. Pricing & Fares** | Base fare, per km/hr rates, surge & coupons | `pricing_rules`, `fare_breakdowns`, `coupons` |
| **7. Payments & Wallets**| Escrow payments, refunds, partner wallets & payouts | `payments`, `refunds`, `partner_wallets`, `wallet_transactions` |
| **8. Real-Time Tracking** | Partner live GPS, online toggle, historical breadcrumbs | `partner_availability`, `partner_live_locations` |
| **9. Reviews & Ratings** | 2-way verified customer & partner reviews | `reviews_ratings` |
| **10. Notifications** | In-app alerts, SMS & Push history | `notifications` |
| **11. Audit Logs** | Comprehensive compliance & admin audit trail | `audit_logs` |

---

## 2. Detailed Module Specifications

### Module 1: Addresses Management

#### `user_addresses`
*Planned previously, missing from current database.*
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id`: `bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `city_id`: `bigint NOT NULL REFERENCES cities(id) ON DELETE RESTRICT`
- `area_id`: `bigint NULL REFERENCES areas(id) ON DELETE RESTRICT`
- `address_type`: `varchar(20) NOT NULL` (CHECK: `HOME`, `WORK`, `OTHER`)
- `address_line1`: `text NOT NULL`
- `address_line2`: `text NULL`
- `landmark`: `varchar(255) NULL`
- `postal_code`: `varchar(20) NOT NULL`
- `latitude`: `numeric(10, 7) NOT NULL` (CHECK: `-90 <= latitude <= 90`)
- `longitude`: `numeric(10, 7) NOT NULL` (CHECK: `-180 <= longitude <= 180`)
- `is_default`: `boolean NOT NULL DEFAULT false`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- **Indexes**:
  - `idx_user_addresses_user`: (`user_id`)
  - `idx_user_addresses_city`: (`city_id`)

---

### Module 2: Vehicles and Fleet Management

#### `vehicle_types`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `type_name`: `varchar(100) NOT NULL UNIQUE` (e.g., `'Tata Ace / Chota Hathi'`, `'Bolero Pickup'`, `'Tata 407'`, `'Eicher 14ft'`, `'Bike'`)
- `category_id`: `bigint NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT`
- `capacity_kg`: `numeric(10, 2) NOT NULL`
- `volume_cuft`: `numeric(10, 2) NULL`
- `base_fare`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `per_km_rate`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `per_min_rate`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `is_active`: `boolean NOT NULL DEFAULT true`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### `vehicles`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `vehicle_type_id`: `bigint NOT NULL REFERENCES vehicle_types(id) ON DELETE RESTRICT`
- `registration_number`: `varchar(50) NOT NULL UNIQUE`
- `make`: `varchar(100) NULL`
- `model`: `varchar(100) NULL`
- `year_of_manufacture`: `integer NULL`
- `fitness_certificate_expiry`: `date NULL`
- `insurance_expiry`: `date NULL`
- `pollution_expiry`: `date NULL`
- `verification_status`: `varchar(20) NOT NULL DEFAULT 'PENDING'` (CHECK: `PENDING`, `VERIFIED`, `REJECTED`)
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### `partner_vehicles`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `partner_id`: `bigint NOT NULL REFERENCES partner_profiles(id) ON DELETE CASCADE`
- `vehicle_id`: `bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE`
- `is_primary`: `boolean NOT NULL DEFAULT true`
- `assigned_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- **Constraints**: UNIQUE (`partner_id`, `vehicle_id`)

---

### Module 3: Shifting Requirements & Inventory

#### `inventory_categories`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `category_name`: `varchar(100) NOT NULL UNIQUE` (e.g., `'Living Room'`, `'Bedroom'`, `'Kitchen'`, `'Appliances'`, `'Office Furniture'`)
- `is_active`: `boolean NOT NULL DEFAULT true`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### `inventory_items`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `inventory_category_id`: `bigint NOT NULL REFERENCES inventory_categories(id) ON DELETE RESTRICT`
- `item_name`: `varchar(150) NOT NULL` (e.g., `'Double Bed King Size'`, `'3 Seater Sofa'`, `'Double Door Refrigerator'`, `'Washing Machine'`, `'Office Desk'`)
- `estimated_volume_cuft`: `numeric(8, 2) NOT NULL DEFAULT 10.00`
- `estimated_weight_kg`: `numeric(8, 2) NULL`
- `requires_dismantling`: `boolean NOT NULL DEFAULT false`
- `is_active`: `boolean NOT NULL DEFAULT true`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### `booking_inventory_items`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `booking_id`: `bigint NOT NULL REFERENCES bookings(id) ON DELETE CASCADE`
- `inventory_item_id`: `bigint NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT`
- `quantity`: `integer NOT NULL DEFAULT 1` (CHECK: `quantity > 0`)
- `needs_packing`: `boolean NOT NULL DEFAULT true`
- `needs_dismantling`: `boolean NOT NULL DEFAULT false`

#### `booking_labor_details`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `booking_id`: `bigint NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE`
- `pickup_floor`: `integer NOT NULL DEFAULT 0`
- `pickup_has_elevator`: `boolean NOT NULL DEFAULT false`
- `drop_floor`: `integer NOT NULL DEFAULT 0`
- `drop_has_elevator`: `boolean NOT NULL DEFAULT false`
- `helpers_count_requested`: `integer NOT NULL DEFAULT 0` (CHECK: `>= 0`)
- `labor_charge`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `packing_charge`: `numeric(10, 2) NOT NULL DEFAULT 0.00`

---

### Module 4: Services Catalog & Rate Cards

#### `services`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `category_id`: `bigint NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT`
- `service_name`: `varchar(150) NOT NULL` (e.g., `'Switchboard Repair'`, `'Ceiling Fan Installation'`, `'Tap Leakage Fix'`, `'AC Master Servicing'`)
- `service_code`: `varchar(50) NOT NULL UNIQUE`
- `description`: `text NULL`
- `duration_minutes`: `integer NOT NULL DEFAULT 60`
- `is_active`: `boolean NOT NULL DEFAULT true`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### `service_rate_cards`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `service_id`: `bigint NOT NULL REFERENCES services(id) ON DELETE CASCADE`
- `city_id`: `bigint NOT NULL REFERENCES cities(id) ON DELETE RESTRICT`
- `visiting_fee`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `base_service_fee`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `hourly_fee`: `numeric(10, 2) NULL`
- `is_active`: `boolean NOT NULL DEFAULT true`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- **Constraints**: UNIQUE (`service_id`, `city_id`)

---

### Module 5: Bookings & Assignment Engine

#### `bookings`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `booking_number`: `varchar(30) NOT NULL UNIQUE` (e.g., `'BK-20261103-0001'`)
- `customer_id`: `bigint NOT NULL REFERENCES customer_profiles(id) ON DELETE RESTRICT`
- `service_category_id`: `bigint NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT`
- `city_id`: `bigint NOT NULL REFERENCES cities(id) ON DELETE RESTRICT`
- `booking_type`: `varchar(30) NOT NULL` (CHECK: `HOME_SERVICE`, `HOME_SHIFTING`, `OFFICE_SHIFTING`, `VEHICLE_RENTAL`)
- `booking_status`: `varchar(30) NOT NULL DEFAULT 'REQUESTED'` (CHECK: `REQUESTED`, `ASSIGNED`, `ACCEPTED`, `PARTNER_ON_THE_WAY`, `ARRIVED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`)
- `scheduled_at`: `timestamptz NOT NULL`
- `pickup_address_id`: `bigint NOT NULL REFERENCES user_addresses(id) ON DELETE RESTRICT`
- `drop_address_id`: `bigint NULL REFERENCES user_addresses(id) ON DELETE RESTRICT`
- `vehicle_type_id`: `bigint NULL REFERENCES vehicle_types(id) ON DELETE RESTRICT`
- `total_estimated_amount`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `final_amount`: `numeric(10, 2) NULL`
- `cancellation_reason`: `text NULL`
- `cancelled_by`: `bigint NULL REFERENCES users(id) ON DELETE SET NULL`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- **Indexes**:
  - `idx_bookings_customer`: (`customer_id`)
  - `idx_bookings_status`: (`booking_status`)
  - `idx_bookings_scheduled`: (`scheduled_at`)

#### `booking_items`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `booking_id`: `bigint NOT NULL REFERENCES bookings(id) ON DELETE CASCADE`
- `service_id`: `bigint NOT NULL REFERENCES services(id) ON DELETE RESTRICT`
- `quantity`: `integer NOT NULL DEFAULT 1`
- `unit_price`: `numeric(10, 2) NOT NULL`
- `total_price`: `numeric(10, 2) NOT NULL`

#### `booking_assignments`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `booking_id`: `bigint NOT NULL REFERENCES bookings(id) ON DELETE CASCADE`
- `partner_id`: `bigint NOT NULL REFERENCES partner_profiles(id) ON DELETE RESTRICT`
- `role_assigned`: `varchar(20) NOT NULL` (CHECK: `PRIMARY_PARTNER`, `DRIVER`, `WORKER_HELPER`)
- `assignment_status`: `varchar(20) NOT NULL DEFAULT 'OFFERED'` (CHECK: `OFFERED`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `UNASSIGNED`)
- `assigned_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `responded_at`: `timestamptz NULL`
- **Indexes**:
  - `idx_assignment_partner`: (`partner_id`, `assignment_status`)

#### `booking_status_history`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `booking_id`: `bigint NOT NULL REFERENCES bookings(id) ON DELETE CASCADE`
- `from_status`: `varchar(30) NULL`
- `to_status`: `varchar(30) NOT NULL`
- `changed_by`: `bigint NULL REFERENCES users(id) ON DELETE SET NULL`
- `comment`: `text NULL`
- `changed_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

---

### Module 6: Pricing, Fare Breakdowns & Coupons

#### `pricing_rules`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `city_id`: `bigint NOT NULL REFERENCES cities(id) ON DELETE RESTRICT`
- `service_category_id`: `bigint NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT`
- `base_fare`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `base_distance_km`: `numeric(8, 2) NOT NULL DEFAULT 0.00`
- `extra_km_rate`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `helper_rate_per_person`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `floor_charge_without_lift`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `surge_multiplier`: `numeric(4, 2) NOT NULL DEFAULT 1.00`
- `is_active`: `boolean NOT NULL DEFAULT true`

#### `fare_breakdowns`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `booking_id`: `bigint NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE`
- `base_fare`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `distance_fare`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `inventory_volume_fare`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `labor_charge`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `floor_charge`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `taxes_and_fees`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `discount_amount`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `surge_amount`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
- `total_fare`: `numeric(10, 2) NOT NULL`

---

### Module 7: Payments, Refunds & Partner Wallets

#### `payments`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `booking_id`: `bigint NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT`
- `payment_gateway`: `varchar(50) NOT NULL` (e.g. `'RAZORPAY'`, `'CASH_ON_DELIVERY'`, `'WALLET'`)
- `gateway_order_id`: `varchar(100) NULL`
- `gateway_payment_id`: `varchar(100) NULL`
- `amount`: `numeric(10, 2) NOT NULL`
- `currency`: `varchar(10) NOT NULL DEFAULT 'INR'`
- `payment_status`: `varchar(20) NOT NULL DEFAULT 'PENDING'` (CHECK: `PENDING`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `REFUNDED`)
- `paid_at`: `timestamptz NULL`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### `refunds`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `payment_id`: `bigint NOT NULL REFERENCES payments(id) ON DELETE RESTRICT`
- `gateway_refund_id`: `varchar(100) NULL`
- `amount`: `numeric(10, 2) NOT NULL`
- `refund_reason`: `text NOT NULL`
- `refund_status`: `varchar(20) NOT NULL DEFAULT 'PENDING'` (CHECK: `PENDING`, `PROCESSED`, `FAILED`)
- `processed_at`: `timestamptz NULL`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### `partner_wallets`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `partner_id`: `bigint NOT NULL UNIQUE REFERENCES partner_profiles(id) ON DELETE CASCADE`
- `current_balance`: `numeric(12, 2) NOT NULL DEFAULT 0.00`
- `pending_payout`: `numeric(12, 2) NOT NULL DEFAULT 0.00`
- `currency`: `varchar(10) NOT NULL DEFAULT 'INR'`
- `is_locked`: `boolean NOT NULL DEFAULT false`
- `updated_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### `wallet_transactions`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `wallet_id`: `bigint NOT NULL REFERENCES partner_wallets(id) ON DELETE RESTRICT`
- `booking_id`: `bigint NULL REFERENCES bookings(id) ON DELETE SET NULL`
- `transaction_type`: `varchar(20) NOT NULL` (CHECK: `CREDIT_BOOKING_EARNING`, `CREDIT_TIP`, `DEBIT_PLATFORM_COMMISSION`, `DEBIT_PAYOUT`, `DEBIT_PENALTY`)
- `amount`: `numeric(10, 2) NOT NULL`
- `closing_balance`: `numeric(12, 2) NOT NULL`
- `description`: `text NULL`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

---

### Module 8: Partner Availability & Real-Time Tracking

#### `partner_availability`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `partner_id`: `bigint NOT NULL UNIQUE REFERENCES partner_profiles(id) ON DELETE CASCADE`
- `is_online`: `boolean NOT NULL DEFAULT false`
- `current_booking_id`: `bigint NULL REFERENCES bookings(id) ON DELETE SET NULL`
- `last_heartbeat_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

#### `partner_live_locations`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `partner_id`: `bigint NOT NULL UNIQUE REFERENCES partner_profiles(id) ON DELETE CASCADE`
- `latitude`: `numeric(10, 7) NOT NULL`
- `longitude`: `numeric(10, 7) NOT NULL`
- `heading`: `numeric(5, 2) NULL`
- `speed_kph`: `numeric(5, 2) NULL`
- `accuracy_meters`: `numeric(6, 2) NULL`
- `updated_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

---

### Module 9: Reviews & Ratings

#### `reviews_ratings`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `booking_id`: `bigint NOT NULL REFERENCES bookings(id) ON DELETE CASCADE`
- `reviewer_id`: `bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `reviewee_id`: `bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `rating`: `integer NOT NULL` (CHECK: `rating >= 1 AND rating <= 5`)
- `feedback_tags`: `text[] NULL`
- `comment`: `text NULL`
- `is_public`: `boolean NOT NULL DEFAULT true`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`
- **Constraints**: UNIQUE (`booking_id`, `reviewer_id`)

---

### Module 10: Notifications

#### `notifications`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id`: `bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `booking_id`: `bigint NULL REFERENCES bookings(id) ON DELETE SET NULL`
- `title`: `varchar(200) NOT NULL`
- `message`: `text NOT NULL`
- `channel`: `varchar(20) NOT NULL DEFAULT 'IN_APP'` (CHECK: `IN_APP`, `PUSH`, `SMS`)
- `is_read`: `boolean NOT NULL DEFAULT false`
- `read_at`: `timestamptz NULL`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

---

### Module 11: Audit Logs

#### `audit_logs`
- `id`: `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `actor_id`: `bigint NULL REFERENCES users(id) ON DELETE SET NULL`
- `action`: `varchar(100) NOT NULL` (e.g., `'ADMIN_APPROVE_PARTNER'`, `'PRICE_RULE_UPDATE'`)
- `entity_name`: `varchar(100) NOT NULL` (e.g., `'partner_profiles'`, `'pricing_rules'`)
- `entity_id`: `bigint NOT NULL`
- `old_values`: `jsonb NULL`
- `new_values`: `jsonb NULL`
- `ip_address`: `inet NULL`
- `created_at`: `timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`

---

## 3. Migration Phasing & Safety Strategy

All proposed additions are **additive**:
1. Zero existing tables or columns will be altered or dropped.
2. All foreign keys referencing existing tables (`users`, `partner_profiles`, `cities`, `service_categories`) use strict integrity rules (`RESTRICT` or `CASCADE`).
3. Database backup will be generated prior to executing any DDL.
4. Each module will be applied as a transactional migration script.

