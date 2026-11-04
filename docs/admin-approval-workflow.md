# Admin Partner Approval & Verification Workflow

## 1. Overview

The Admin Partner Approval module provides privileged operations for operations teams and administrators to review partner dossiers, approve or reject applications, verify KYC documents, verify technical skills, and maintain a complete tamper-resistant audit trail.

---

## 2. API Endpoints (Admin Only)

All endpoints require `ADMIN` or `SUPER_ADMIN` role (`requireAdmin`).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/admin/partners/pending` | List all partner applications in `PENDING` status |
| `GET` | `/api/v1/admin/partners/:id` | Retrieve comprehensive partner dossier (documents, skills, areas) |
| `PATCH` | `/api/v1/admin/partners/:id/approve` | Approve partner application |
| `PATCH` | `/api/v1/admin/partners/:id/reject` | Reject partner application (mandatory reason) |
| `PATCH` | `/api/v1/admin/partners/:id/suspend` | Suspend partner account (mandatory reason) |
| `PATCH` | `/api/v1/admin/partners/documents/:id/verify` | Verify individual KYC document |
| `PATCH` | `/api/v1/admin/partners/documents/:id/reject` | Reject individual KYC document (mandatory reason) |
| `PATCH` | `/api/v1/admin/partners/skills/:id/verify` | Verify individual service skill |
| `PATCH` | `/api/v1/admin/partners/skills/:id/reject` | Reject individual service skill |

---

## 3. Security & Governance Invariants

1. **Self-Review Prevention**: An administrator who has also created a partner profile is strictly forbidden from reviewing, approving, rejecting, or suspending their own partner account (`partner.userId === adminUserId` returns `403 Forbidden`).
2. **Mandatory Justification**: Any rejection (`REJECTED`) or suspension (`SUSPENDED`) requires a non-empty `reason` (minimum 5 characters) to ensure accountability.
3. **Decoupled Verification**:
   - Partner profile approval (`approvalStatus = 'APPROVED'`) enables account activation.
   - Individual skill verification (`verificationStatus = 'VERIFIED'`) is managed separately. A partner can only receive booking assignments for skills that are verified.
4. **Audit Trail**: Every administrative status mutation writes an immutable record to the `audit_logs` table containing:
   - `actor_user_id`: ID of the reviewing administrator.
   - `action`: e.g. `PARTNER_APPROVED`, `PARTNER_REJECTED`, `PARTNER_DOCUMENT_VERIFIED`.
   - `entity_name`: Target table (`partner_profiles`, `partner_documents`, `partner_skills`).
   - `entity_id`: Primary key of the affected entity.
   - `old_values` & `new_values`: JSON snapshots of status before and after the action.
   - `ip_address` & `user_agent`: Network origin of the administrative request.

