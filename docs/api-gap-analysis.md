# API & Frontend Readiness Gap Analysis

**Audit Date**: November 4, 2026  
**Auditor**: Senior Backend Architect & API Designer  
**Scope**: Existing REST APIs, Swagger Documentation, Partner App & Admin Panel Readiness  
**Execution Mode**: READ-ONLY Architectural Audit

---

## 1. Existing API Inventory (41 Verified Endpoints)

| Module | Route Prefix | Endpoint Count | Active Capabilities |
|---|---|---|---|
| **Health** | `/api/v1/health` | 2 | Node.js system health & PostgreSQL live latency probe. |
| **Auth** | `/api/v1/auth` | 6 | Mobile OTP request, verify/register, refresh rotation, logout, logout-all, `/me`. |
| **Users & Addresses** | `/api/v1/users` | 10 | Profile viewing, email update, role inspection, safe deactivation, full Address CRUD with single default uniqueness. |
| **Customers** | `/api/v1/customers` | 3 | Customer profile retrieve, upsert, and partial update. |
| **Partners** | `/api/v1/partners` | 9 | Generic partner onboarding, profile, KYC doc upload, skills add/list, service areas add/list. |
| **Admin** | `/api/v1/admin` | 9 | Pending partner list, partner dossier view, approve, reject, suspend, document verify/reject, skill verify/reject. |
| **Locations** | `/api/v1/locations` | 2 | Active cities list, city areas list. |

---

## 2. Missing APIs Required for Final Business Architecture

### 2.1. Vehicle Owner & Fleet Management APIs (Missing)
- `POST /api/v1/partners/vehicles` — Register a vehicle (registration number, make, model, year, vehicle type).
- `GET /api/v1/partners/vehicles` — List vehicles owned by the authenticated vehicle partner.
- `GET /api/v1/partners/vehicles/:id` — Get single vehicle details and active assigned driver.
- `PATCH /api/v1/partners/vehicles/:id` — Update vehicle details.
- `POST /api/v1/partners/vehicles/:id/documents` — Upload vehicle-specific documents (RC, fitness, insurance, permit).
- `GET /api/v1/partners/vehicles/:id/documents` — List vehicle documents and expiration dates.

### 2.2. Driver Invitation & Assignment APIs (Missing)
- `POST /api/v1/partners/drivers/invite` — Vehicle owner sends invitation to driver mobile number.
- `GET /api/v1/partners/drivers/invitations` — Vehicle owner views sent invitations and their statuses.
- `DELETE /api/v1/partners/drivers/invitations/:id` — Vehicle owner cancels pending invitation.
- `GET /api/v1/drivers/invitations/pending` — Driver views invitations received on their mobile number.
- `POST /api/v1/drivers/invitations/:id/accept` — Driver explicitly accepts invitation.
- `POST /api/v1/drivers/invitations/:id/reject` — Driver rejects invitation.
- `POST /api/v1/partners/vehicles/:id/assign-driver` — Owner assigns verified driver to vehicle (enforces 1 active driver rule).
- `POST /api/v1/partners/vehicles/:id/unassign-driver` — Owner terminates active driver assignment.
- `GET /api/v1/partners/vehicles/:id/driver-history` — Historical log of driver assignments.

### 2.3. Driver Profile & KYC APIs (Missing)
- `POST /api/v1/drivers/profile` — Driver registers driving license number, license type, validity.
- `GET /api/v1/drivers/profile` — Driver views profile and approval status.
- `POST /api/v1/drivers/documents` — Driver uploads driving license and badge document.

### 2.4. Worker Onboarding & Affiliation APIs (Missing)
- `POST /api/v1/workers/profile` — Worker onboards, sets independent eligibility flag and max lifting capacity.
- `GET /api/v1/workers/profile` — Worker views profile and affiliation summary.
- `PATCH /api/v1/workers/availability` — Worker toggles independent dispatch availability.
- `POST /api/v1/workers/affiliations/request` — Partner sends affiliation invite to worker OR worker requests partner affiliation.
- `GET /api/v1/workers/affiliations` — List active and historical partner affiliations.
- `PATCH /api/v1/workers/affiliations/:id/accept` — Accept affiliation request.
- `PATCH /api/v1/workers/affiliations/:id/terminate` — Terminate affiliation.

### 2.5. Role Context & Role Switching APIs (Missing)
- `POST /api/v1/auth/switch-role` — Issue a new short-lived JWT scoped to a specific approved active role (`CUSTOMER`, `PARTNER`, `DRIVER`, `WORKER`).
- `GET /api/v1/auth/active-roles` — List user's roles along with their respective approval states.

### 2.6. Admin Verification Queue APIs (Missing)
- `GET /api/v1/admin/vehicles/pending` — Queue of pending vehicles requiring verification.
- `PATCH /api/v1/admin/vehicles/:id/approve` — Approve vehicle.
- `PATCH /api/v1/admin/vehicles/:id/reject` — Reject vehicle with mandatory reason.
- `GET /api/v1/admin/drivers/pending` — Queue of pending driver profiles.
- `PATCH /api/v1/admin/drivers/:id/approve` — Approve driver license.
- `PATCH /api/v1/admin/drivers/:id/reject` — Reject driver license.
- `GET /api/v1/admin/workers/pending` — Queue of pending worker profiles.
- `PATCH /api/v1/admin/workers/:id/approve` — Approve worker.
- `GET /api/v1/admin/partners/documents/:id/file` — Securely stream KYC file for visual verification.

---

## 3. Frontend & App Readiness Assessment

### 3.1. Partner App (Unified Single App Architecture)
The client requires a **single Partner App** for all service providers, drivers, and workers. The frontend must incorporate:
1. **Dynamic Role Dashboard**:
   - If user is approved as `VEHICLE_OWNER`: Displays "My Fleet", "My Drivers", "Fleet Earnings".
   - If user is approved as `DRIVER`: Displays "My Assigned Vehicle", "Shifting Trips", "Driver Duty Toggle".
   - If user is approved as `WORKER`: Displays "Independent Shifts", "Affiliated Partners", "Duty Toggle".
   - If user is approved as `TRADESMAN` (Electrician/Plumber): Displays "Service Requests", "Verified Skills", "Service Area".
2. **Driver Invitation Flow**:
   - Owner enters driver name and 10-digit mobile number.
   - Driver receives SMS notification with deep link to open Partner App.
   - Driver authenticates via mobile OTP and sees prominent banner: *"Transport Partner X has invited you to drive vehicle MH-02-AB-1234. [Accept] [Decline]"*.
3. **Multi-Role Switcher**:
   - Drawer toggle allowing a user who is both a Vehicle Owner and an Electrician to switch operating contexts cleanly.

### 3.2. Admin Panel Readiness
The Admin Panel requires:
1. **KYC Verification Workbench**:
   - Split-screen UI showing uploaded document image/PDF on left, and metadata/approval controls on right.
2. **Dedicated Verification Queues**:
   - Partner Business Dossiers Queue.
   - Vehicle Registration & Fitness Queue.
   - Driver Driving License Queue.
   - Worker ID Verification Queue.
3. **Audit Trail Explorer**:
   - Filterable timeline showing which administrator approved, rejected, or suspended any entity, with timestamps and IP records.

