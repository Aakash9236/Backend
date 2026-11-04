# User Management & Address Architecture

## 1. Overview

The User Management module provides core profile inspection, multi-role assignment viewing, safe account deactivation, and comprehensive multi-address management for the platform.

---

## 2. API Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/v1/users/me` | Retrieve profile, roles, customer & partner summaries | Yes |
| `PATCH` | `/api/v1/users/me` | Update permitted user fields (e.g. `email`) | Yes |
| `GET` | `/api/v1/users/me/roles` | List all assigned roles with descriptions | Yes |
| `DELETE` | `/api/v1/users/me` | Safely deactivate account and revoke all sessions | Yes |
| `POST` | `/api/v1/users/me/addresses` | Add a new address (Home, Work, Other) | Yes |
| `GET` | `/api/v1/users/me/addresses` | List all addresses belonging to user | Yes |
| `GET` | `/api/v1/users/me/addresses/:id` | Get address by ID (ownership verified) | Yes |
| `PATCH` | `/api/v1/users/me/addresses/:id` | Update address details | Yes |
| `DELETE` | `/api/v1/users/me/addresses/:id` | Delete address (protected against booking history) | Yes |
| `PATCH` | `/api/v1/users/me/addresses/:id/default` | Set single address as default (unsets others) | Yes |

---

## 3. Address Management Rules

1. **City & Area Referential Integrity**: Every address must reference a valid and active `city_id`. If `area_id` is supplied, it must belong to the specified city.
2. **Coordinates Validation**: `latitude` must be between -90 and 90, and `longitude` between -180 and 180 (Decimal 10, 7 precision).
3. **Single Default Address**: When `isDefault = true` or `/default` is invoked, a database transaction automatically unsets `isDefault = false` for all other addresses belonging to that user.
4. **Cross-User Protection**: A user cannot read, update, delete, or set default on another user's address. Any attempt returns `404 Not Found`.
5. **Booking Protection**: If an address is referenced as `pickup_address_id` or `drop_address_id` in historical bookings, direct deletion is blocked to maintain transactional integrity.

---

## 4. Safe Account Deactivation

When a user calls `DELETE /api/v1/users/me`:
1. `users.account_status` transitions from `ACTIVE` to `DELETED`.
2. All active `user_sessions` are immediately revoked (`revoked_at = NOW()`).
3. Subsequent requests with existing JWT access tokens fail with `401 Unauthorized` (session terminated).
4. Login attempts with OTP for deleted accounts are rejected with `403 Forbidden`.

