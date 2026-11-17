import crypto from 'crypto';
import { Prisma, DriverInvitation, DriverProfile, DriverPartnerAffiliation } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import { logger } from '../../../config/logger.config';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from '../../../common/errors';
import { DateUtil } from '../../../common/utils/date.util';
import { DriverInvitationRepository } from '../repositories/driver-invitation.repository';
import { DriverProfileRepository } from '../repositories/driver-profile.repository';
import { DriverPartnerAffiliationRepository } from '../repositories/driver-partner-affiliation.repository';
import { PaginationOptions, PaginatedResult } from '../drivers.types';

// ============================================================================
// Types & DTOs
// ============================================================================

export interface CreateInvitationInput {
  invitedMobile: string;
  driverName?: string | null;
  notes?: string | null;
}

export interface DriverInvitationResponse {
  id: string;
  partnerId: string;
  partnerName?: string;
  invitedMobile: string;
  driverName: string | null;
  driverUserId: string | null;
  invitationStatus: string;
  notes: string | null;
  expiresAt: string;
  respondedAt: string | null;
  rejectionReason: string | null;
  revokedAt: string | null;
  createdAt: string;
  isExpired: boolean;
  // invitationToken is intentionally excluded for security in standard listing
}

export interface DriverInvitationPublicDetails {
  id: string;
  partnerId: string;
  partnerBusinessName?: string;
  invitedMobile: string;
  driverName: string | null;
  invitationStatus: string;
  notes: string | null;
  expiresAt: string;
  isExpired: boolean;
}

export interface DriverInvitationAcceptResponse {
  invitation: DriverInvitationResponse;
  affiliationId: string;
  driverProfileId: string;
  message: string;
}

// ============================================================================
// Driver Invitation Service
// ============================================================================

export class DriverInvitationService {
  constructor(
    private invitationRepo: DriverInvitationRepository = new DriverInvitationRepository(),
    private profileRepo: DriverProfileRepository = new DriverProfileRepository(),
    private affiliationRepo: DriverPartnerAffiliationRepository = new DriverPartnerAffiliationRepository()
  ) {}

  /**
   * Normalizes Indian mobile number format (e.g. "9876543210" -> "+919876543210")
   */
  private normalizeMobileNumber(rawMobile: string): string {
    if (!rawMobile) {
      throw new BadRequestError('Mobile number is required.');
    }
    const cleaned = rawMobile.trim().replace(/[\s\-()]/g, '');
    if (/^\+91\d{10}$/.test(cleaned)) {
      return cleaned;
    }
    if (/^91\d{10}$/.test(cleaned)) {
      return `+${cleaned}`;
    }
    if (/^\d{10}$/.test(cleaned)) {
      return `+91${cleaned}`;
    }
    throw new BadRequestError(
      `Invalid mobile number format: '${rawMobile}'. Must be a valid 10-digit Indian phone number.`
    );
  }

  /**
   * Serializes a DriverInvitation record into an API-safe response, avoiding token leakage.
   */
  private serializeInvitation(invitation: DriverInvitation, partnerName?: string): DriverInvitationResponse {
    const isExpired =
      invitation.invitationStatus === 'PENDING' && new Date() > invitation.expiresAt;

    return {
      id: invitation.id.toString(),
      partnerId: invitation.partnerId.toString(),
      partnerName,
      invitedMobile: invitation.invitedMobile,
      driverName: invitation.driverName,
      driverUserId: invitation.driverUserId ? invitation.driverUserId.toString() : null,
      invitationStatus: isExpired ? 'EXPIRED' : invitation.invitationStatus,
      notes: invitation.notes,
      expiresAt: invitation.expiresAt.toISOString(),
      respondedAt: invitation.respondedAt ? invitation.respondedAt.toISOString() : null,
      rejectionReason: invitation.rejectionReason,
      revokedAt: invitation.revokedAt ? invitation.revokedAt.toISOString() : null,
      createdAt: invitation.createdAt.toISOString(),
      isExpired,
    };
  }

  /**
   * Generates a cryptographically secure, unguessable token.
   */
  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Calculates invitation expiry timestamp representing exactly 7 full calendar days in Asia/Kolkata timezone.
   */
  private calculate7DayExpiryIST(now: Date = new Date()): Date {
    const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return DateUtil.getEndOfKolkataDay(futureDate);
  }

  /**
   * Creates a driver invitation sent by an authorized vehicle owner/partner.
   *
   * Business Rules:
   * 1. Partner must exist, have APPROVED profile, and not be suspended.
   * 2. Target mobile number must be normalized.
   * 3. Prevents duplicate active PENDING invitations for the same (partner, mobile) combination.
   * 4. Expiry set to 7 full calendar days in Asia/Kolkata.
   * 5. Does NOT create or activate a driver profile merely because an invitation was sent.
   */
  public async createInvitation(
    partnerUserIdInput: bigint | string,
    input: CreateInvitationInput
  ): Promise<{ invitation: DriverInvitationResponse; invitationToken: string }> {
    const partnerUserId = BigInt(partnerUserIdInput);

    // 1. Verify partner authorization
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found. Only registered partners can invite drivers.');
    }

    if (partner.approvalStatus !== 'APPROVED') {
      throw new ForbiddenError(
        `Cannot invite drivers: Partner profile approval status is '${partner.approvalStatus}'. Approval required.`
      );
    }

    const normalizedMobile = this.normalizeMobileNumber(input.invitedMobile);

    // 2. Prevent duplicate active pending invitations for the same partner + mobile
    const existingPending = await this.invitationRepo.findPendingByPartnerAndMobile(
      partner.id,
      normalizedMobile
    );

    if (existingPending) {
      // Check if it has expired in wall-clock time
      if (new Date() <= existingPending.expiresAt) {
        throw new ConflictError(
          `An active pending invitation already exists for mobile number '${normalizedMobile}'.`
        );
      }
      // Stale pending invitation will be marked expired
      await this.invitationRepo.updateStatus(existingPending.id, 'EXPIRED');
    }

    // 3. Generate token & expiry
    const invitationToken = this.generateSecureToken();
    const expiresAt = this.calculate7DayExpiryIST();

    // 4. Create invitation record
    const invitation = await this.invitationRepo.create({
      partnerId: partner.id,
      invitedMobile: normalizedMobile,
      driverName: input.driverName ? input.driverName.trim() : null,
      invitationStatus: 'PENDING',
      invitationToken,
      notes: input.notes ? input.notes.trim() : null,
      expiresAt,
    });

    logger.info(
      `[Driver Invitation] Partner ${partner.id.toString()} invited driver mobile ${normalizedMobile} (Invitation ID: ${invitation.id.toString()})`
    );

    return {
      invitation: this.serializeInvitation(invitation, partner.businessName ?? undefined),
      invitationToken, // Returned only once at creation for dispatch (e.g. SMS/link)
    };
  }

  /**
   * Retrieves an invitation by ID with partner ownership verification.
   */
  public async getInvitationById(
    partnerUserIdInput: bigint | string,
    invitationIdInput: bigint | string
  ): Promise<DriverInvitationResponse> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const invitationId = BigInt(invitationIdInput);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });
    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const invitation = await this.invitationRepo.findById(invitationId);
    if (!invitation) {
      throw new NotFoundError(`Invitation with ID ${invitationId.toString()} not found.`);
    }

    if (invitation.partnerId !== partner.id) {
      throw new ForbiddenError('You do not have permission to view invitations for another partner fleet.');
    }

    return this.serializeInvitation(invitation, partner.businessName ?? undefined);
  }

  /**
   * Public invitation details lookup by secure token.
   * Does NOT expose sensitive tokens or internal details.
   */
  public async getInvitationByToken(token: string): Promise<DriverInvitationPublicDetails> {
    if (!token || typeof token !== 'string') {
      throw new BadRequestError('Invitation token is required.');
    }

    const invitation = await this.invitationRepo.findByToken(token);
    if (!invitation) {
      throw new NotFoundError('Invitation not found or invalid token.');
    }

    const isExpired =
      invitation.invitationStatus === 'PENDING' && new Date() > invitation.expiresAt;

    const partner = await prisma.partnerProfile.findUnique({
      where: { id: invitation.partnerId },
      select: { businessName: true },
    });

    return {
      id: invitation.id.toString(),
      partnerId: invitation.partnerId.toString(),
      partnerBusinessName: partner?.businessName ?? undefined,
      invitedMobile: invitation.invitedMobile,
      driverName: invitation.driverName,
      invitationStatus: isExpired ? 'EXPIRED' : invitation.invitationStatus,
      notes: invitation.notes,
      expiresAt: invitation.expiresAt.toISOString(),
      isExpired,
    };
  }

  /**
   * Lists invitations created by the authenticated partner fleet.
   */
  public async listPartnerInvitations(
    partnerUserIdInput: bigint | string,
    filterOrOptions?: { status?: string } | PaginationOptions,
    maybeOptions?: PaginationOptions
  ): Promise<PaginatedResult<DriverInvitationResponse>> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });
    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    let status: string | undefined = undefined;
    let pagination: PaginationOptions | undefined = maybeOptions;

    if (filterOrOptions) {
      if ('status' in filterOrOptions) {
        status = filterOrOptions.status;
      } else {
        pagination = filterOrOptions as PaginationOptions;
      }
    }

    const result = await this.invitationRepo.listCreatedByPartner(partner.id, status, pagination);

    return {
      ...result,
      items: result.items.map((inv) => this.serializeInvitation(inv, partner.businessName ?? undefined)),
    };
  }

  /**
   * Lists invitations received by the authenticated driver.
   */
  public async listDriverReceivedInvitations(
    driverUserIdInput: bigint | string,
    options?: PaginationOptions
  ): Promise<PaginatedResult<DriverInvitationResponse>> {
    const driverUserId = BigInt(driverUserIdInput);
    const user = await prisma.user.findUnique({
      where: { id: driverUserId },
    });
    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const result = await this.invitationRepo.listReceivedForUser(user.mobileNumber, driverUserId, options);

    return {
      ...result,
      items: result.items.map((inv) => this.serializeInvitation(inv)),
    };
  }

  /**
   * Driver explicitly accepts an invitation.
   *
   * Business Rules:
   * 1. Driver must authenticate with their own mobile number.
   * 2. Authenticated user's mobile MUST match the invitation's target mobile number.
   * 3. Invitation must be in PENDING status and not expired.
   * 4. Acceptance transition is atomic (concurrency-safe: atomicTransitionStatus).
   * 5. Atomically creates active affiliation in driver_partner_affiliations.
   * 6. Preserves existing CUSTOMER, PARTNER, or ADMIN roles.
   * 7. Ensures DRIVER role and driver profile exist for the driver user.
   */
  public async acceptInvitation(
    invitationIdentifier: bigint | string, // Can be invitation ID or secure token
    driverUserIdInput: bigint | string
  ): Promise<DriverInvitationAcceptResponse> {
    const driverUserId = BigInt(driverUserIdInput);

    const user = await prisma.user.findUnique({
      where: { id: driverUserId },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user) {
      throw new NotFoundError('Authenticated driver user not found.');
    }

    // Find invitation by ID or Token
    let invitation: DriverInvitation | null = null;
    if (typeof invitationIdentifier === 'string' && invitationIdentifier.length >= 32) {
      invitation = await this.invitationRepo.findByToken(invitationIdentifier);
    } else {
      invitation = await this.invitationRepo.findById(BigInt(invitationIdentifier));
    }

    if (!invitation) {
      throw new NotFoundError('Driver invitation not found.');
    }

    // 1. Strict Target Mobile Match: Prevent wrong-user acceptance
    const normalizedUserMobile = this.normalizeMobileNumber(user.mobileNumber);
    if (normalizedUserMobile !== invitation.invitedMobile) {
      logger.warn(
        `[Driver Invitation Security] Mobile mismatch: User ${driverUserId.toString()} with mobile ${normalizedUserMobile} attempted to accept invitation ${invitation.id.toString()} targeted to ${invitation.invitedMobile}`
      );
      throw new ForbiddenError(
        'You cannot accept this invitation: Your registered mobile number does not match the invitation target.'
      );
    }

    // 2. Status & Expiry Check
    if (invitation.invitationStatus !== 'PENDING') {
      throw new ConflictError(
        `Invitation is no longer pending (current status: '${invitation.invitationStatus}').`
      );
    }

    if (new Date() > invitation.expiresAt) {
      await this.invitationRepo.updateStatus(invitation.id, 'EXPIRED');
      throw new BadRequestError('This invitation has expired.');
    }

    // 3. Atomic acceptance & affiliation creation in single transaction
    const result = await prisma.$transaction(async (tx) => {
      // Concurrency check: Atomic conditional update
      const updatedInvitation = await this.invitationRepo.atomicTransitionStatus(
        invitation!.id,
        'PENDING',
        'ACCEPTED',
        {
          respondedAt: new Date(),
          driverUserId,
        },
        tx
      );

      if (!updatedInvitation) {
        throw new ConflictError(
          'Failed to accept invitation: It was already accepted, revoked, or processed by another request.'
        );
      }

      // Ensure DRIVER role exists for this user without removing any existing roles
      const hasDriverRole = user.userRoles.some((ur) => ur.role.roleName === 'DRIVER');
      if (!hasDriverRole) {
        const driverRole = await tx.role.findUnique({ where: { roleName: 'DRIVER' } });
        if (driverRole) {
          await tx.userRole.create({
            data: { userId: driverUserId, roleId: driverRole.id },
          });
        }
      }

      // Ensure driver profile exists
      let driverProfile = await this.profileRepo.findByUserId(driverUserId, tx);
      if (!driverProfile) {
        driverProfile = await this.profileRepo.create(
          {
            userId: driverUserId,
            firstName: invitation!.driverName || 'Driver',
            submissionStatus: 'DRAFT',
            approvalStatus: 'PENDING',
          },
          tx
        );
      }

      // Check if active affiliation already exists
      let affiliation = await this.affiliationRepo.findActive(
        driverProfile.id,
        invitation!.partnerId,
        tx
      );

      if (!affiliation) {
        affiliation = await this.affiliationRepo.create(
          {
            driverId: driverProfile.id,
            partnerId: invitation!.partnerId,
            invitationId: invitation!.id,
            affiliationStatus: 'ACTIVE',
          },
          tx
        );
      }

      return {
        updatedInvitation,
        affiliation,
        driverProfile,
      };
    });

    logger.info(
      `[Driver Invitation] Driver User ${driverUserId.toString()} successfully accepted invitation ${invitation.id.toString()}. Created affiliation ${result.affiliation.id.toString()}`
    );

    return {
      invitation: this.serializeInvitation(result.updatedInvitation),
      affiliationId: result.affiliation.id.toString(),
      driverProfileId: result.driverProfile.id.toString(),
      message: 'Invitation accepted successfully. Fleet affiliation is now active.',
    };
  }

  /**
   * Driver explicitly rejects an invitation.
   */
  public async rejectInvitation(
    invitationIdentifier: bigint | string,
    driverUserIdInput: bigint | string,
    reason?: string
  ): Promise<DriverInvitationResponse> {
    const driverUserId = BigInt(driverUserIdInput);
    const user = await prisma.user.findUnique({ where: { id: driverUserId } });

    if (!user) {
      throw new NotFoundError('Authenticated driver user not found.');
    }

    let invitation: DriverInvitation | null = null;
    if (typeof invitationIdentifier === 'string' && invitationIdentifier.length >= 32) {
      invitation = await this.invitationRepo.findByToken(invitationIdentifier);
    } else {
      invitation = await this.invitationRepo.findById(BigInt(invitationIdentifier));
    }

    if (!invitation) {
      throw new NotFoundError('Driver invitation not found.');
    }

    const normalizedUserMobile = this.normalizeMobileNumber(user.mobileNumber);
    if (normalizedUserMobile !== invitation.invitedMobile) {
      throw new ForbiddenError(
        'You cannot reject this invitation: Registered mobile number does not match target.'
      );
    }

    if (invitation.invitationStatus !== 'PENDING') {
      throw new ConflictError(
        `Invitation is not pending (current status: '${invitation.invitationStatus}').`
      );
    }

    const updated = await this.invitationRepo.atomicTransitionStatus(
      invitation.id,
      'PENDING',
      'REJECTED',
      {
        respondedAt: new Date(),
        rejectionReason: reason ? reason.trim() : 'Declined by driver',
        driverUserId,
      }
    );

    if (!updated) {
      throw new ConflictError('Invitation status transition conflict: Already processed.');
    }

    logger.info(
      `[Driver Invitation] Driver User ${driverUserId.toString()} rejected invitation ${invitation.id.toString()}`
    );

    return this.serializeInvitation(updated);
  }

  /**
   * Partner revokes an outstanding pending invitation.
   */
  public async revokeInvitation(
    partnerUserIdInput: bigint | string,
    invitationIdInput: bigint | string,
    reason?: string
  ): Promise<DriverInvitationResponse> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const invitationId = BigInt(invitationIdInput);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });
    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const invitation = await this.invitationRepo.findById(invitationId);
    if (!invitation) {
      throw new NotFoundError(`Invitation with ID ${invitationId.toString()} not found.`);
    }

    if (invitation.partnerId !== partner.id) {
      throw new ForbiddenError('Cannot revoke invitations belonging to another partner.');
    }

    if (invitation.invitationStatus !== 'PENDING') {
      throw new ConflictError(
        `Cannot revoke invitation: Current status is '${invitation.invitationStatus}'. Only PENDING invitations can be revoked.`
      );
    }

    const updated = await this.invitationRepo.atomicTransitionStatus(
      invitation.id,
      'PENDING',
      'REVOKED',
      {
        revokedAt: new Date(),
        revokedBy: partnerUserId,
        rejectionReason: reason ? reason.trim() : 'Revoked by fleet owner',
      }
    );

    if (!updated) {
      throw new ConflictError('Failed to revoke invitation: Status conflict.');
    }

    logger.info(
      `[Driver Invitation] Partner ${partner.id.toString()} revoked invitation ${invitationId.toString()}`
    );

    return this.serializeInvitation(updated);
  }

  /**
   * Housekeeping utility to expire stale invitations older than expiresAt.
   */
  public async expireStaleInvitations(): Promise<number> {
    return await this.invitationRepo.expireEligibleInvitations();
  }
}

export const driverInvitationService = new DriverInvitationService();
