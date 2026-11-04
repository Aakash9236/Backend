import crypto from 'crypto';
import { env } from '../../config/env.config';

export class OtpUtil {
  private static readonly SALT = env.JWT_ACCESS_SECRET.slice(0, 16);

  /**
   * Normalizes mobile number to E.164 international standard (+91XXXXXXXXXX for India)
   */
  public static normalizeMobileNumber(raw: string): string {
    const cleaned = raw.replace(/\D/g, ''); // strip non-digits

    // If 10-digit Indian mobile number
    if (cleaned.length === 10) {
      return `+91${cleaned}`;
    }

    // If starts with 91 and has 12 digits
    if (cleaned.length === 12 && cleaned.startsWith('91')) {
      return `+${cleaned}`;
    }

    // If already prefixed with country code
    if (raw.startsWith('+')) {
      return `+${cleaned}`;
    }

    return `+${cleaned}`;
  }

  /**
   * Generates a cryptographically secure 6-digit OTP string
   */
  public static generateSecureOtp(): string {
    // Generates a number between 100000 and 999999
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Hashes the OTP using SHA-256 with an internal salt before storing in database
   */
  public static hashOtp(otp: string, mobileNumber: string): string {
    return crypto
      .createHash('sha256')
      .update(`${mobileNumber}:${otp}:${this.SALT}`)
      .digest('hex');
  }

  /**
   * Timing-safe comparison of provided OTP hash against stored OTP hash
   */
  public static compareOtp(plainOtp: string, mobileNumber: string, storedHash: string): boolean {
    const computedHash = this.hashOtp(plainOtp, mobileNumber);

    const bufferComputed = Buffer.from(computedHash, 'utf8');
    const bufferStored = Buffer.from(storedHash, 'utf8');

    if (bufferComputed.length !== bufferStored.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufferComputed, bufferStored);
  }

  /**
   * Checks whether mock OTP applies in development mode
   */
  public static isMockOtp(plainOtp: string): boolean {
    if (env.NODE_ENV !== 'production' && env.MOCK_OTP_ENABLED) {
      return plainOtp === env.DEV_DEFAULT_OTP;
    }
    return false;
  }
}

