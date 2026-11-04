import { z } from 'zod';

export const requestOtpBodySchema = z.object({
  mobileNumber: z
    .string({ required_error: 'Mobile number is required' })
    .trim()
    .regex(
      /^(?:\+91|91)?[6-9]\d{9}$/,
      'Please provide a valid 10-digit Indian mobile number (e.g., 9876543210 or +919876543210)'
    ),
  purpose: z
    .enum(['AUTHENTICATION', 'CHANGE_MOBILE', 'PASSWORD_RESET'])
    .default('AUTHENTICATION'),
});

export const requestOtpSchema = {
  body: requestOtpBodySchema,
};

export const verifyOtpBodySchema = z.object({
  mobileNumber: z
    .string({ required_error: 'Mobile number is required' })
    .trim()
    .regex(
      /^(?:\+91|91)?[6-9]\d{9}$/,
      'Please provide a valid 10-digit Indian mobile number'
    ),
  otp: z
    .string({ required_error: 'OTP is required' })
    .trim()
    .length(6, 'OTP must be exactly 6 digits')
    .regex(/^\d{6}$/, 'OTP must contain numbers only'),
  deviceId: z.string().trim().max(100).optional(),
  deviceName: z.string().trim().max(100).optional(),
});

export const verifyOtpSchema = {
  body: verifyOtpBodySchema,
};

export const refreshTokenBodySchema = z.object({
  refreshToken: z
    .string({ required_error: 'Refresh token is required' })
    .trim()
    .min(32, 'Invalid refresh token format'),
  activeRole: z.string().trim().optional(),
});

export const refreshTokenSchema = {
  body: refreshTokenBodySchema,
};

export const switchRoleBodySchema = z.object({
  role: z
    .string({ required_error: 'Role is required' })
    .trim()
    .min(1, 'Role cannot be empty'),
});

export const switchRoleSchema = {
  body: switchRoleBodySchema,
};
