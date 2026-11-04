export interface JwtUserPayload {
  userId: string;
  mobileNumber: string;
  roles: string[];
  activeRole?: string;
  sessionId: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  tokenType: string;
}

export interface AuthSessionResponse {
  isNewUser: boolean;
  user: {
    id: string;
    mobileNumber: string;
    email: string | null;
    accountStatus: string;
    isMobileVerified: boolean;
    activeRole: string;
    roles: string[];
    createdAt: string;
  };
  tokens: TokenPair;
}

export interface OtpRequestResult {
  mobileNumber: string;
  expiresInSeconds: number;
  cooldownSeconds: number;
  message: string;
  devMockOtp?: string; // only populated in development if MOCK_OTP_ENABLED
}

export interface ClientDeviceInfo {
  deviceId?: string;
  deviceName?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RoleStatusInfo {
  role: string;
  approvalStatus?: string | null;
  isOperational: boolean;
}

export interface SwitchRoleResult {
  activeRole: string;
  availableRoles: string[];
  roleStatus: RoleStatusInfo;
  tokens: {
    accessToken: string;
    tokenType: string;
    expiresIn: string;
  };
}
