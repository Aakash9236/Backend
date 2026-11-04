# Partner Onboarding Module

## 1. Overview

The Partner Onboarding module allows service professionals, drivers, moving contractors, and trade workers to register on the platform, submit KYC verification documents, declare service skills, and specify operational coverage areas.

---

## 2. API Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/v1/partners/onboarding` | Submit partner application & assign PARTNER role | Yes |
| `GET` | `/api/v1/partners/profile` | View partner profile and current status | Yes |
| `PATCH` | `/api/v1/partners/profile` | Update permitted partner profile details | Yes |
| `POST` | `/api/v1/partners/documents` | Upload KYC document (multipart or storage key) | Yes |
| `GET` | `/api/v1/partners/documents` | List uploaded KYC documents & statuses | Yes |
| `POST` | `/api/v1/partners/skills` | Add service skill linked to service category | Yes |
| `GET` | `/api/v1/partners/skills` | List partner skills and verification states | Yes |
| `POST` | `/api/v1/partners/service-areas` | Add operational city/area coverage | Yes |
| `GET` | `/api/v1/partners/service-areas` | List registered service areas | Yes |

---

## 3. Business Decisions & Invariants

1. **Dual Role Retention**: When an existing user onboards as a partner, their `CUSTOMER` role is preserved, and the `PARTNER` role is added to `user_roles`. A user can simultaneously book services as a customer and provide services as a partner.
2. **Initial Status**: All new partner applications start in `PENDING` status. Partners cannot receive or accept bookings until reviewed and approved by an administrator.
3. **No Duplicate Partner Records**: One user has exactly one `partner_profiles` record. Different skills (`ELECTRICIAN`, `PLUMBER`, `AC_REPAIR`) are associated via the `partner_skills` relational table.
4. **Document Security**: Uploaded KYC documents are validated for MIME type (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`) and maximum size (5MB). Files are assigned cryptographically random storage keys in a non-public folder, and only the storage key is recorded in PostgreSQL.
5. **Coverage Model**:
   - `coverage_type = 'CITY'`: Covers an entire municipality (`area_id` is `NULL`).
   - `coverage_type = 'AREA'`: Covers a specific localized area (`area_id` is required).

