# Authentication Security & Threat Analysis

## 1. Security Architecture Overview

This platform implements a **Zero-Trust, Defense-in-Depth** security posture specifically tailored to mobile OTP authentication, stateless JWT authorization, and long-lived session management.

---

## 2. Threat Modeling & Mitigation Matrix

| Threat Vector | Attack Scenario | Platform Countermeasure | Technical Implementation |
|---|---|---|---|
| **OTP Brute-Force** | Attacker iterates 000000-999999 to guess active OTP. | Max 5 verification attempts per OTP; atomic lock. | `attempts` column in `otp_verifications`; locked when `attempts >= 5`. |
| **SMS Flood / Cost Denial** | Script triggers repeated OTP requests to waste budget. | 60-second strict cooldown & single active OTP policy. | Cooldown check in `requestOtp`; invalidates prior pending OTPs. |
| **OTP Replay Attack** | Attacker intercepts and replays a previously verified OTP. | Atomic check-and-set verification. | `UPDATE ... WHERE id = ... AND status = 'PENDING'` ensures single-use. |
| **Token Theft / Replay** | Attacker steals Refresh Token from client storage. | Refresh Token Rotation (RTR) + Reuse Breach Detection. | Immediate revocation of all user sessions upon reuse of rotated token. |
| **Timing Attacks** | Attacker measures comparison latency to determine hashes. | Constant-time cryptographic comparison. | `crypto.timingSafeEqual` over fixed-length buffer digests. |
| **Database Compromise** | Attacker dumps database and steals tokens/OTPs. | Plaintext is never stored; only salted SHA-256 hashes. | `TokenUtil.hashToken()` and `OtpUtil.hashOtp()` with per-user salt. |
| **Privilege Escalation** | Customer attempts to invoke Partner or Admin endpoints. | Strict RBAC middleware guards (`requireCustomer`, `requireAdmin`). | Token payload carries signed `roles`; verified on every protected request. |
| **Session Orphanage** | User logs out, but token remains valid until expiry. | Active session check in `requireAuth`. | `requireAuth` queries `user_sessions.revoked_at` in PostgreSQL. |
| **User Enumeration** | Attacker checks if mobile number is registered. | Request OTP succeeds uniformly whether user exists or not. | Generic success response regardless of new or existing account status. |

---

## 3. Cryptographic Implementation Details

### 3.1. OTP Generation & Salting
- **Generator**: Uses Node.js native `crypto.randomInt(100000, 1000000)`, guaranteeing cryptographic entropy without PRNG predictability.
- **Salt Formulation**:
  $$\text{Salt} = \text{SHA256}(\text{normalizedMobileNumber} + \text{JWT\_SECRET})$$
- **Digest**:
  $$\text{OtpHash} = \text{SHA256}(\text{Salt} + \text{PlainOtp})$$
  This prevents rainbow table lookups even if two users receive the same 6-digit OTP code simultaneously.

### 3.2. Constant-Time Hash Comparison
```typescript
const hash1 = Buffer.from(computedHash, 'hex');
const hash2 = Buffer.from(storedHash, 'hex');
if (hash1.length !== hash2.length) return false;
return crypto.timingSafeEqual(hash1, hash2);
```
Standard string comparison `===` short-circuits on the first mismatched byte, creating side-channel timing leaks. Using `crypto.timingSafeEqual` neutralizes this vector completely.

---

## 4. Refresh Token Rotation (RTR) & Breach Mitigation

```
[Legitimate Client]                             [Database]                             [Attacker]
         │                                          │                                       │
         ├────── 1. Exchanges RT_1 ────────────────>│                                       │
         │<───── 2. Receives RT_2 ──────────────────┤ (RT_1 marked REVOKED)                 │
         │                                          │                                       │
         │                                          │<────── 3. Replays stolen RT_1 ────────┤
         │                                          │                                       │
         │                                          │ [BREACH DETECTED: RT_1 is REVOKED!]   │
         │                                          │ ──── Revokes ALL user sessions ────── │
         │                                          │                                       │
         │                                          ├─────── 4. Rejects with 401 ──────────>│
         │                                          │                                       │
         ├────── 5. Subsequent request with AT_2 ──>│                                       │
         │<───── 6. 401 Unauthorized ───────────────┤ (Legitimate user prompted to login)   │
```

- When `RT_1` is used legitimately, its session record transitions to `revokedAt = NOW()`, and a new session with `RT_2` is created.
- If an attacker attempts to exchange `RT_1` later, the backend locates the session, sees `revokedAt !== null`, triggers an immediate `SECURITY ALERT` log, and executes `revokeAllUserSessions(userId)`.
- Both the attacker and the compromised user are cut off immediately, preventing persistent unauthorized access.

---

## 5. Development Mode Security Controls

1. **Mock OTP Restriction**:
   - `MOCK_OTP_ENABLED=true` and `DEV_DEFAULT_OTP=123456` are strictly disabled if `NODE_ENV === 'production'`.
   - In production, attempting to pass `123456` without an actual matching hash fails verification immediately.
2. **Secret Key Safeguards**:
   - Zod environment validation checks that `JWT_SECRET` has minimum 32 characters in production.
   - Database credentials and secrets are excluded from logs, error payloads, and API responses.

