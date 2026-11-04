# Authentication & Session Architecture

## 1. Executive Summary

This document describes the architectural foundation for the **Mobile Number & OTP Authentication System** designed for the Multi-Service On-Demand Platform. The architecture adheres to a clean **Modular Monolith** pattern with clear layer isolation:

```
[HTTP Request / Controller] ──> [Validation Middleware (Zod)]
                                        │
                                        ▼
                                [Auth Service]
                                 ├── Token Util (JWT & SHA-256)
                                 ├── OTP Util (Crypto & Normalization)
                                 └── Logger (Winston)
                                        │
                                        ▼
                                [Auth Repository]
                                        │
                                        ▼
                           [PostgreSQL 18 via Prisma ORM]
                         (users, roles, user_roles, 
                          otp_verifications, user_sessions)
```

---

## 2. Architecture & Design Principles

1. **Passwordless Mobile First**: Authentication strictly relies on normalized Indian mobile numbers (`+91XXXXXXXXXX`) verified via cryptographic one-time passwords (OTP).
2. **Stateless Access with Stateful Session Invalidation**: Access Tokens are stateless RS256/HS256 JWTs (15-minute lifetime), while Refresh Tokens are opaque cryptographic 256-bit random strings stored as SHA-256 hashes in `user_sessions`.
3. **Refresh Token Rotation (RTR)**: Every time a refresh token is exchanged, a new refresh token is issued, and the prior session record is transitioned to revoked.
4. **Token Reuse Breach Detection**: If an already-rotated or revoked refresh token is presented, the system immediately recognizes a potential security breach, revoking all active sessions across all devices for that user.
5. **Zero Token/Password Persistence**: Plaintext tokens and plaintext OTPs are never stored in the database or written to logs. Only cryptographically salted SHA-256 hashes are persisted.
6. **Atomic Verification**: OTP verification utilizes atomic check-and-set updates in PostgreSQL to guarantee that concurrent verification attempts cannot cause race conditions or duplicate account creation.

---

## 3. End-to-End Authentication Workflows

### 3.1. OTP Request & Generation Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as Customer / Partner App
    participant Controller as AuthController
    participant Service as AuthService
    participant Repo as AuthRepository
    participant DB as PostgreSQL 18

    Client->>Controller: POST /api/v1/auth/otp/request { mobileNumber: "9876543210" }
    Controller->>Service: requestOtp(normalizedMobile, purpose)
    Service->>Repo: getLatestActiveOtp(normalizedMobile)
    Repo->>DB: SELECT * FROM otp_verifications WHERE mobile_number = ...
    DB-->>Repo: Latest OTP Record

    alt Cooldown Active (< 60s since last request)
        Service-->>Controller: Throw 400 (Cooldown active)
        Controller-->>Client: 400 Bad Request
    else Cooldown Expired
        Service->>Repo: invalidatePendingOtps(normalizedMobile)
        Repo->>DB: UPDATE otp_verifications SET status = 'EXPIRED' WHERE ...
        Service->>Service: Generate 6-digit randomInt & SHA-256 Hash
        Service->>Repo: createOtpVerification(...)
        Repo->>DB: INSERT INTO otp_verifications (mobile_number, otp_hash, expires_at, ...)
        Service-->>Controller: OtpRequestResult (cooldown: 60s, expiry: 300s)
        Controller-->>Client: 200 OK { success: true, message: "OTP has been sent successfully." }
    end
```

---

### 3.2. OTP Verification & Session Issuance Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as Customer / Partner App
    participant Controller as AuthController
    participant Service as AuthService
    participant Repo as AuthRepository
    participant DB as PostgreSQL 18

    Client->>Controller: POST /api/v1/auth/otp/verify { mobileNumber, otp, deviceId, deviceName }
    Controller->>Service: verifyOtp(mobileNumber, otp, deviceInfo)
    Service->>Repo: getLatestActiveOtp(mobileNumber)
    Repo->>DB: Query PENDING OTP
    DB-->>Repo: OTP Record

    alt Invalid OTP
        Service->>Repo: incrementOtpAttempts(otpId)
        Repo->>DB: UPDATE otp_verifications SET attempts = attempts + 1
        alt Attempts >= MaxAttempts (5)
            Service->>Repo: lockOtp(otpId)
            Repo->>DB: UPDATE otp_verifications SET status = 'LOCKED'
            Service-->>Controller: Throw 400 (Max attempts exceeded)
        else Attempts < MaxAttempts
            Service-->>Controller: Throw 400 (Invalid OTP, X attempts remaining)
        end
        Controller-->>Client: 400 Bad Request
    else Valid OTP
        Service->>Repo: markOtpVerifiedAtomic(otpId)
        Repo->>DB: UPDATE otp_verifications SET status = 'VERIFIED' WHERE status = 'PENDING'
        DB-->>Repo: rows_updated = 1
        
        alt User Does Not Exist (New Registration)
            Service->>Repo: createUserWithCustomerRole(mobileNumber)
            Repo->>DB: Transaction: INSERT users + user_roles (CUSTOMER) + customer_profiles
        else User Exists
            Service->>Repo: findUserById(userId)
            Service->>Service: Verify accountStatus === 'ACTIVE'
        end

        Service->>Service: Generate Access Token (JWT) & Refresh Token (Crypto random)
        Service->>Repo: createSession(userId, refreshTokenHash, deviceInfo, expiresAt)
        Repo->>DB: INSERT INTO user_sessions (...)
        Service-->>Controller: { user, tokens, isNewUser }
        Controller-->>Client: 200 OK with Bearer Token & User Profile
    end
```

---

### 3.3. Refresh Token Rotation & Breach Detection Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client App
    actor Attacker as Malicious Actor
    participant Service as AuthService
    participant Repo as AuthRepository
    participant DB as PostgreSQL 18

    Note over Client, DB: Legitimate Rotation
    Client->>Service: POST /api/v1/auth/refresh { refreshToken: RT_1 }
    Service->>Repo: findSessionByTokenHash(hash(RT_1))
    Repo->>DB: Query session by hash
    DB-->>Repo: Session Record (revoked_at is NULL)
    Service->>Repo: rotateSession(sessionId, hash(RT_2), newExpiry)
    Repo->>DB: Transaction: Mark Session 1 revoked_at = NOW(), Insert Session 2 (RT_2)
    Service-->>Client: 200 OK { tokens: { RT_2, AT_2 } }

    Note over Attacker, DB: Compromised Token Reuse Attack
    Attacker->>Service: POST /api/v1/auth/refresh { refreshToken: RT_1 } (Replayed old token)
    Service->>Repo: findSessionByTokenHash(hash(RT_1))
    Repo->>DB: Query session by hash
    DB-->>Repo: Session 1 Record (revoked_at is NOT NULL!)
    Service->>Service: BREACH DETECTED!
    Service->>Repo: revokeAllUserSessions(userId)
    Repo->>DB: UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ...
    Service-->>Attacker: 401 Unauthorized (Security breach detected)
    
    Note over Client: Subsequent Client Request Fails Safely
    Client->>Service: GET /api/v1/auth/me (using AT_2)
    Service->>DB: Check session status (now revoked)
    DB-->>Service: Session revoked
    Service-->>Client: 401 Unauthorized (User prompted to re-authenticate)
```

---

## 4. Session State Machine

Every session in `user_sessions` follows this strict finite state machine:

```mermaid
stateDiagram-v2
    [*] --> Active: verifyOtp (Login / Register)
    Active --> Rotated_Revoked: POST /refresh (Legitimate Rotation)
    Active --> Revoked: POST /logout (Single Logout)
    Active --> Revoked: POST /logout-all (Global Logout)
    Active --> Revoked: Breach Detected (All sessions revoked)
    Active --> Expired: Expiration Time Passed (> 30 Days)
    Rotated_Revoked --> BreachTriggered: If Replayed in POST /refresh
    Revoked --> [*]
    Expired --> [*]
```

---

## 5. Role-Based Access Control (RBAC) Architecture

- Role definitions are seeded in the `roles` table:
  - `CUSTOMER`: End consumer requesting services or shifting.
  - `PARTNER`: Professional service provider or shifting vendor.
  - `DRIVER`: Vehicle operator.
  - `WORKER`: Loading and unloading specialist.
  - `ADMIN`: Operations manager.
  - `SUPER_ADMIN`: Root platform administrator.
- A user can hold **multiple roles simultaneously** via `user_roles`.
- Every generated JWT Access Token contains `roles: string[]` in its cryptographically signed payload.
- Middleware guards enforce strict least-privilege checks:
  - `requireAuth`: Verifies JWT signature and checks `user_sessions.revoked_at` in the database.
  - `requireRole(...roles)`: Verifies if the authenticated user has at least one of the permitted roles.
  - `requireCustomer`: Enforces `CUSTOMER` role.
  - `requirePartner`: Enforces `PARTNER` role.
  - `requireAdmin`: Enforces `ADMIN` or `SUPER_ADMIN` role.

