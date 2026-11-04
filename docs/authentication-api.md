# Authentication API Specification

Base URL: `http://localhost:5000/api/v1/auth`  
Interactive Swagger Documentation: `http://localhost:5000/api-docs`

---

## 1. Request OTP

Generate and deliver a cryptographic 6-digit OTP to an Indian mobile number.

- **Method**: `POST`
- **Path**: `/otp/request`
- **Authentication**: None (Public)
- **Rate Limit / Cooldown**: 60 seconds per mobile number

### Request Headers
```http
Content-Type: application/json
```

### Request Body
```json
{
  "mobileNumber": "9876543210",
  "purpose": "AUTHENTICATION"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `mobileNumber` | string | Yes | 10-digit Indian mobile number (`9876543210`, `+919876543210`, or `919876543210`). |
| `purpose` | string | No | Purpose of OTP: `AUTHENTICATION`, `CHANGE_MOBILE`, or `PASSWORD_RESET`. Default: `AUTHENTICATION`. |

### Success Response (200 OK)
```json
{
  "success": true,
  "message": "OTP has been sent successfully.",
  "data": {
    "mobileNumber": "+919876543210",
    "expiresInSeconds": 300,
    "cooldownSeconds": 60,
    "devMockOtp": "123456"
  },
  "timestamp": "2026-11-04T06:10:00.000Z"
}
```

### Error Responses

#### 400 Bad Request (Cooldown Active)
```json
{
  "success": false,
  "message": "Please wait 45 seconds before requesting a new OTP.",
  "timestamp": "2026-11-04T06:10:15.000Z"
}
```

#### 422 Unprocessable Entity (Invalid Mobile Number)
```json
{
  "success": false,
  "message": "Request validation failed",
  "data": [
    {
      "field": "body.mobileNumber",
      "message": "Please provide a valid 10-digit Indian mobile number (e.g., 9876543210 or +919876543210)"
    }
  ],
  "timestamp": "2026-11-04T06:10:00.000Z"
}
```

---

## 2. Verify OTP & Login / Register

Verifies the 6-digit OTP against the stored cryptographic hash. If the user does not exist, registers a new user with the default `CUSTOMER` role and creates their profile. Returns a JWT access token, a refresh token, and user details.

- **Method**: `POST`
- **Path**: `/otp/verify`
- **Authentication**: None (Public)

### Request Body
```json
{
  "mobileNumber": "9876543210",
  "otp": "123456",
  "deviceId": "samsung-galaxy-s24-uuid-9921",
  "deviceName": "Samsung Galaxy S24 Ultra"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `mobileNumber` | string | Yes | Mobile number to which the OTP was sent. |
| `otp` | string | Yes | 6-digit numeric OTP. |
| `deviceId` | string | No | Client device identifier for session auditing. |
| `deviceName` | string | No | User-friendly device name. |

### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Authentication successful",
  "data": {
    "isNewUser": false,
    "user": {
      "id": "1",
      "mobileNumber": "+919876543210",
      "email": null,
      "accountStatus": "ACTIVE",
      "isMobileVerified": true,
      "roles": [
        "CUSTOMER"
      ],
      "createdAt": "2026-11-04T05:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "c9284fa981e4210a9b...",
      "expiresIn": "15m",
      "tokenType": "Bearer"
    }
  },
  "timestamp": "2026-11-04T06:10:30.000Z"
}
```

### Error Responses

#### 400 Bad Request (Wrong OTP)
```json
{
  "success": false,
  "message": "Invalid OTP entered. 4 attempts remaining.",
  "timestamp": "2026-11-04T06:10:30.000Z"
}
```

#### 400 Bad Request (Attempts Exceeded / Locked)
```json
{
  "success": false,
  "message": "Maximum verification attempts exceeded. This OTP is locked. Please request a new OTP.",
  "timestamp": "2026-11-04T06:10:45.000Z"
}
```

#### 403 Forbidden (Blocked User)
```json
{
  "success": false,
  "message": "Account is blocked. Access denied. Please contact platform support.",
  "timestamp": "2026-11-04T06:10:30.000Z"
}
```

---

## 3. Refresh Access Token

Exchanges a valid Refresh Token for a brand new Access Token and a brand new Refresh Token (Token Rotation). Detects compromised token reuse.

- **Method**: `POST`
- **Path**: `/refresh`
- **Authentication**: None (Requires valid refresh token in body)

### Request Body
```json
{
  "refreshToken": "c9284fa981e4210a9b34bc..."
}
```

### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Tokens refreshed successfully",
  "data": {
    "isNewUser": false,
    "user": {
      "id": "1",
      "mobileNumber": "+919876543210",
      "email": null,
      "accountStatus": "ACTIVE",
      "isMobileVerified": true,
      "roles": [
        "CUSTOMER"
      ],
      "createdAt": "2026-11-04T05:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "72f10b7849e0129bc88a...",
      "expiresIn": "15m",
      "tokenType": "Bearer"
    }
  },
  "timestamp": "2026-11-04T06:25:00.000Z"
}
```

### Error Responses

#### 401 Unauthorized (Token Reuse Security Breach)
```json
{
  "success": false,
  "message": "Security breach detected: Refresh token reuse attempt. All active sessions have been terminated. Please log in again.",
  "timestamp": "2026-11-04T06:25:30.000Z"
}
```

---

## 4. Single-Device Logout

Revokes the active session associated with the caller's JWT bearer token.

- **Method**: `POST`
- **Path**: `/logout`
- **Authentication**: Bearer Token required (`Authorization: Bearer <accessToken>`)

### Request Headers
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Logged out successfully",
  "data": null,
  "timestamp": "2026-11-04T06:30:00.000Z"
}
```

---

## 5. Global Logout (All Devices)

Revokes all active sessions across all devices for the authenticated user.

- **Method**: `POST`
- **Path**: `/logout-all`
- **Authentication**: Bearer Token required (`Authorization: Bearer <accessToken>`)

### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Logged out from all devices successfully",
  "data": null,
  "timestamp": "2026-11-04T06:30:00.000Z"
}
```

---

## 6. Get Current Profile (`/me`)

Retrieves the currently authenticated user's profile, role assignments, and session information.

- **Method**: `GET`
- **Path**: `/me`
- **Authentication**: Bearer Token required (`Authorization: Bearer <accessToken>`)

### Request Headers
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Profile retrieved successfully",
  "data": {
    "id": "1",
    "mobileNumber": "+919876543210",
    "email": null,
    "accountStatus": "ACTIVE",
    "isMobileVerified": true,
    "roles": [
      "CUSTOMER"
    ],
    "customerProfile": {
      "firstName": "",
      "lastName": null,
      "dateOfBirth": null,
      "gender": null,
      "profileImageUrl": null
    },
    "partnerProfile": null,
    "createdAt": "2026-11-04T05:00:00.000Z",
    "updatedAt": "2026-11-04T05:00:00.000Z"
  },
  "timestamp": "2026-11-04T06:31:00.000Z"
}
```

### Error Responses

#### 401 Unauthorized (Missing or Invalid Token)
```json
{
  "success": false,
  "message": "Authentication token missing or invalid format (Bearer token required).",
  "timestamp": "2026-11-04T06:31:00.000Z"
}
```

