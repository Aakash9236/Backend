import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../../config/env.config';
import { JwtUserPayload } from '../../modules/auth/auth.types';
import { UnauthorizedError } from '../errors';

export class TokenUtil {
  /**
   * Generates a signed JWT Access Token
   */
  public static generateAccessToken(payload: JwtUserPayload): string {
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.ACCESS_TOKEN_EXPIRY as any,
    });
  }

  /**
   * Generates an opaque cryptographically secure 64-character hex refresh token
   */
  public static generateRefreshToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hashes a refresh token using SHA-256 before database storage
   */
  public static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Verifies a JWT access token and returns payload
   */
  public static verifyAccessToken(token: string): JwtUserPayload {
    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtUserPayload;
      return decoded;
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedError('Access token has expired', { code: 'TOKEN_EXPIRED' });
      }
      throw new UnauthorizedError('Invalid access token', { code: 'INVALID_TOKEN' });
    }
  }

  /**
   * Calculates expiration date from duration string (e.g., '7d', '15m', '24h')
   */
  public static calculateExpiryDate(durationStr: string): Date {
    const unit = durationStr.slice(-1);
    const value = parseInt(durationStr.slice(0, -1), 10);
    const now = new Date();

    switch (unit) {
      case 'm': // minutes
        return new Date(now.getTime() + value * 60 * 1000);
      case 'h': // hours
        return new Date(now.getTime() + value * 60 * 60 * 1000);
      case 'd': // days
        return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days default
    }
  }
}

