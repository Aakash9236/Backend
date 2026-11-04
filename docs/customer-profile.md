# Customer Profile Module

## 1. Overview

The Customer Profile module maintains personal details for end-consumers booking home services, vehicles, and shifting orders on the platform.

---

## 2. API Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/v1/customers/profile` | Retrieve customer profile for authenticated user | Yes |
| `POST` | `/api/v1/customers/profile` | Create or replace customer profile | Yes |
| `PATCH` | `/api/v1/customers/profile` | Partial update of customer profile fields | Yes |

---

## 3. Schema & Validation Specifications

| Field | Type | Required | Constraints |
|---|---|---|---|
| `firstName` | string | Yes | Min 2, max 50 characters, trimmed. |
| `lastName` | string | No | Max 50 characters, trimmed. |
| `dateOfBirth` | string | No | Format `YYYY-MM-DD`. Stored as `DATE` in PostgreSQL. |
| `gender` | string | No | Enum: `MALE`, `FEMALE`, `OTHER`. |
| `profileImageUrl` | string | No | URL reference or secure storage key. |

---

## 4. Automatic Provisioning

- Upon successful initial OTP verification for a new mobile number, a stub `customer_profiles` record is automatically initialized with the user's ID.
- The user can update their personal details at any time using `POST` or `PATCH /api/v1/customers/profile`.

