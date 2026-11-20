import crypto from 'crypto';
import { Prisma, WorkerInvitation, WorkerProfile, WorkerPartnerAffiliation } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import { logger } from '../../../config/logger.config';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../../../common/errors';
import { DateUtil } from '../../../common/utils/date.util';
import { WorkerInvitationRepository } from '../repositories/worker-invitation.repository';
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import { WorkerPartnerAffiliationRepository } from '../repositories/worker-partner-affiliation.repository';
import {
  CreateWorkerInvitationInput,
  WorkerInvitationResponse,
  WorkerInvitationPublicDetails,
  WorkerInvitationAcceptResponse,
  PaginationOptions,
  PaginatedResult,
} from '../workers.types';

// ============================================================================
// Worker Invitation Service
// ============================================================================

export class WorkerInvitationService {
  constructor(
    private invitationRepo: WorkerInvitationRepository = new WorkerInvitationRepository(),
    private profileRepo: WorkerProfileRepository = new WorkerProfileRepository(),
    private affiliationRepo: WorkerPartnerAffiliationRepository = new WorkerPartnerAffiliationRepository()
  ) {}

  /**
   * Normalizes Indian mobile number format (e.g. "9876543210" -> "+919876543210")
   */
  public normalizeMobileNumber(rawMobile: string): string {
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
   * Computes SHA-256 hash of a raw invitation token.
   * Only token hashes are stored in the database.
   */
  public hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Generates a cryptographically secure random token (32 bytes hex).
   */
  public generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Calculates invitation expiry timestamp representing 7 full calendar days in Asia/Kolkata timezone.
   */
  public calculate7DayExpiryIST(now: Date = new Date()): Date {
    const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return DateUtil.getEndOfKolkataDay(futureDate);
  }

  /**
   * Serializes a WorkerInvitation record into an API-safe response.
   * NEVER exposes raw tokens or token hashes.
   */
  private serializeInvitation(
    invitation: WorkerInvitation,
    partnerName?: string
  ): WorkerInvitationResponse {
    const isExpired =
      invitation.invitationStatus === 'PENDING' && new Date() > invitation.expiresAt;

    return {
      id: invitation.id.toString(),
      partnerId: invitation.partnerId.toString(),
      partnerName,
      invitedMobile: invitation.invitedMobile,
      workerName: invitation.workerName,
      workerUserId: invitation.workerUserId ? invitation.workerUserId.toString() : null,
      proposedRole: invitation.proposedRole,
      invitationStatus: isExpired ? 'EXPIRED' : invitation.invitationStatus,
      notes: invitation.notes,
      resendCount: invitation.resendCount,
      expiresAt: invitation.expiresAt.toISOString(),
      respondedAt: invitation.respondedAt ? invitation.respondedAt.toISOString() : null,
      rejectionReason: invitation.rejectionReason,
      revokedAt: invitation.revokedAt ? invitation.revokedAt.toISOString() : null,
      createdAt: invitation.createdAt.toISOString(),
      isExpired,
    };
  }

  /**
   * Creates a worker invitation sent by an authorized service partner.
   *
   * Business Rules:
   * 1. Partner must exist, have APPROVED profile, and not be suspended.
   * 2. Target mobile number must be normalized.
   * 3. Multiple partners may independently invite the same mobile number.
   * 4. Prevents duplicate active PENDING invitations for the same (partner, mobile) combination.
   * 5. Expiry set to 7 full calendar days in Asia/Kolkata.
   * 6. Generates secure random token and stores only the SHA-256 hash.
   * 7. Returns raw token securely and only once for dispatch.
   * 8. Creating an invitation NEVER creates an affiliation.
   */
  public async createInvitation(
    partnerUserIdInput: bigint | string,
    input: CreateWorkerInvitationInput
  ): Promise<{ invitation: WorkerInvitationResponse; invitationToken: string }> {
    const partnerUserId = BigInt(partnerUserIdInput);

    // 1. Verify partner authorization
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found. Only registered partners can invite workers.');
    }

    if (partner.approvalStatus !== 'APPROVED') {
      throw new ForbiddenError(
        `Cannot invite workers: Partner profile approval status is '${partner.approvalStatus}'. Approval required.`
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

    // 3. Generate token & hash & 7-day Asia/Kolkata expiry
    const rawToken = this.generateSecureToken();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = this.calculate7DayExpiryIST();

    // 4. Create invitation record in PostgreSQL (hash only, never log raw token)
    const invitation = await this.invitationRepo.create({
      partnerId: partner.id,
      invitingUserId: partnerUserId,
      invitedMobile: normalizedMobile,
      workerName: input.workerName ? input.workerName.trim() : null,
      proposedRole: input.proposedRole ? input.proposedRole.trim() : null,
      notes: input.notes ? input.notes.trim() : null,
      invitationTokenHash: tokenHash,
      expiresAt,
      invitationStatus: 'PENDING',
    });

    logger.info(
      `[Worker Invitation] Partner ${partner.id.toString()} invited worker mobile ${normalizedMobile} (Invitation ID: ${invitation.id.toString()})`
    );

    return {
      invitation: this.serializeInvitation(invitation, partner.businessName ?? partner.legalName),
      invitationToken: rawToken, // Returned only once at creation for delivery
    };
  }

  /**
   * Retrieves an invitation by ID or Token with authorization check.
   */
  public async getInvitationDetails(
    invitationIdentifier: bigint | string,
    authUserIdInput?: bigint | string
  ): Promise<WorkerInvitationResponse | WorkerInvitationPublicDetails> {
    // 1. If identifier is a 64-character raw hex token, lookup by SHA-256 hash (Public Details)
    if (typeof invitationIdentifier === 'string' && invitationIdentifier.length >= 32) {
      const tokenHash = this.hashToken(invitationIdentifier);
      const invitation = await this.invitationRepo.findByTokenHash(tokenHash);

      if (!invitation) {
        throw new NotFoundError('Worker invitation not found or invalid token.');
      }

      const isExpired =
        invitation.invitationStatus === 'PENDING' && new Date() > invitation.expiresAt;

      const partner = await prisma.partnerProfile.findUnique({
        where: { id: invitation.partnerId },
        select: { businessName: true, legalName: true },
      });

      return {
        id: invitation.id.toString(),
        partnerId: invitation.partnerId.toString(),
        partnerBusinessName: partner?.businessName ?? partner?.legalName ?? undefined,
        invitedMobile: invitation.invitedMobile,
        workerName: invitation.workerName,
        proposedRole: invitation.proposedRole,
        invitationStatus: isExpired ? 'EXPIRED' : invitation.invitationStatus,
        notes: invitation.notes,
        expiresAt: invitation.expiresAt.toISOString(),
        isExpired,
      };
    }

    // 2. Numeric ID lookup with authorization check
    const invitationId = BigInt(invitationIdentifier);
    const invitation = await this.invitationRepo.findById(invitationId);

    if (!invitation) {
      throw new NotFoundError(`Worker invitation with ID ${invitationId.toString()} not found.`);
    }

    if (authUserIdInput !== undefined) {
      const authUserId = BigInt(authUserIdInput);
      const partner = await prisma.partnerProfile.findUnique({
        where: { id: invitation.partnerId },
      });
      const user = await prisma.user.findUnique({
        where: { id: authUserId },
      });

      const isPartnerOwner = partner && partner.userId === authUserId;
      const isInvitedWorker = user && this.normalizeMobileNumber(user.mobileNumber) === invitation.invitedMobile;

      if (!isPartnerOwner && !isInvitedWorker) {
        throw new ForbiddenError('You do not have permission to view this invitation.');
      }
    }

    const partner = await prisma.partnerProfile.findUnique({
      where: { id: invitation.partnerId },
      select: { businessName: true, legalName: true },
    });

    return this.serializeInvitation(invitation, partner?.businessName ?? partner?.legalName ?? undefined);
  }

  /**
   * Lists invitations created by the authenticated partner fleet.
   */
  public async listPartnerInvitations(
    partnerUserIdInput: bigint | string,
    filterOrOptions?: { status?: string } | PaginationOptions,
    maybeOptions?: PaginationOptions
  ): Promise<PaginatedResult<WorkerInvitationResponse>> {
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
      items: result.items.map((inv) =>
        this.serializeInvitation(inv, partner.businessName ?? partner.legalName ?? undefined)
      ),
    };
  }

  /**
   * Lists invitations received by the authenticated worker user.
   */
  public async listWorkerInvitations(
    workerUserIdInput: bigint | string,
    options?: PaginationOptions
  ): Promise<PaginatedResult<WorkerInvitationResponse>> {
    const workerUserId = BigInt(workerUserIdInput);
    const user = await prisma.user.findUnique({
      where: { id: workerUserId },
    });
    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const normalizedMobile = this.normalizeMobileNumber(user.mobileNumber);
    const result = await this.invitationRepo.listReceivedForMobile(
      normalizedMobile,
      workerUserId,
      options
    );

    return {
      ...result,
      items: result.items.map((inv) => this.serializeInvitation(inv)),
    };
  }

  /**
   * Worker explicitly accepts an invitation.
   *
   * Business Rules:
   * 1. Worker must authenticate with the same mobile number targeted by the invitation.
   * 2. A worker must have an existing worker profile before accepting an invitation (Rule 16).
   * 3. Acceptance is atomic: transitions status from PENDING to ACCEPTED and creates affiliation.
   * 4. Replayed acceptance requests must not create duplicate affiliations (idempotent / conflict safe).
   * 5. Expired, revoked, rejected or already accepted invitations cannot be accepted.
   * 6. Preserves existing CUSTOMER, PARTNER, DRIVER and other roles.
   * 7. Does NOT automatically approve a worker through invitation acceptance (Rule 18).
   * 8. Records atomic audit log of the acceptance.
   */
  public async acceptInvitation(
    invitationIdentifier: bigint | string,
    workerUserIdInput: bigint | string
  ): Promise<WorkerInvitationAcceptResponse> {
    const workerUserId = BigInt(workerUserIdInput);

    const user = await prisma.user.findUnique({
      where: { id: workerUserId },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user) {
      throw new NotFoundError('Authenticated worker user not found.');
    }

    // Rule 16: Worker MUST have an existing worker profile before accepting an invitation
    const workerProfile = await this.profileRepo.findByUserId(workerUserId);
    if (!workerProfile) {
      throw new BadRequestError(
        'Worker profile not found. Please complete worker onboarding registration before accepting an invitation.'
      );
    }

    // Find invitation by ID or Token
    let invitation: WorkerInvitation | null = null;
    if (typeof invitationIdentifier === 'string' && invitationIdentifier.length >= 32) {
      const tokenHash = this.hashToken(invitationIdentifier);
      invitation = await this.invitationRepo.findByTokenHash(tokenHash);
    } else {
      invitation = await this.invitationRepo.findById(BigInt(invitationIdentifier));
    }

    if (!invitation) {
      throw new NotFoundError('Worker invitation not found.');
    }

    // 1. Strict Target Mobile Match: Prevent wrong-user acceptance
    const normalizedUserMobile = this.normalizeMobileNumber(user.mobileNumber);
    if (normalizedUserMobile !== invitation.invitedMobile) {
      logger.warn(
        `[Worker Invitation Security] Mobile mismatch: User ${workerUserId.toString()} with mobile ${normalizedUserMobile} attempted to accept invitation ${invitation.id.toString()} targeted to ${invitation.invitedMobile}`
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
          workerUserId,
        },
        tx
      );

      if (!updatedInvitation) {
        throw new ConflictError(
          'Failed to accept invitation: It was already accepted, revoked, or processed by another request.'
        );
      }

      // Ensure WORKER role exists for this user without removing existing roles
      const hasWorkerRole = user.userRoles.some((ur) => ur.role.roleName === 'WORKER');
      if (!hasWorkerRole) {
        const workerRole = await tx.role.findUnique({ where: { roleName: 'WORKER' } });
        if (workerRole) {
          await tx.userRole.create({
            data: { userId: workerUserId, roleId: workerRole.id },
          });
        }
      }

      // Check if active affiliation already exists (Concurrency safeguard)
      let affiliation = await this.affiliationRepo.findActive(
        workerProfile.id,
        invitation!.partnerId,
        tx
      );

      if (!affiliation) {
        affiliation = await this.affiliationRepo.create(
          {
            workerId: workerProfile.id,
            partnerId: invitation!.partnerId,
            invitationId: invitation!.id,
            affiliationStatus: 'ACTIVE',
            consentGivenAt: new Date(),
            affiliatedAt: new Date(),
          },
          tx
        );
      }

      // Atomic Audit Log
      await tx.auditLog.create({
        data: {
          actorUserId: workerUserId,
          action: 'WORKER_INVITATION_ACCEPTED',
          entityName: 'WorkerPartnerAffiliation',
          entityId: affiliation.id,
          newValues: {
            invitationId: invitation!.id.toString(),
            partnerId: invitation!.partnerId.toString(),
            workerId: workerProfile.id.toString(),
          },
        },
      });

      return {
        updatedInvitation,
        affiliation,
        workerProfile,
      };
    });

    logger.info(
      `[Worker Invitation] Worker User ${workerUserId.toString()} successfully accepted invitation ${invitation.id.toString()}. Created affiliation ${result.affiliation.id.toString()}`
    );

    return {
      invitation: this.serializeInvitation(result.updatedInvitation),
      affiliationId: result.affiliation.id.toString(),
      workerProfileId: result.workerProfile.id.toString(),
      message: 'Invitation accepted successfully. Partner affiliation is now active.',
    };
  }

  /**
   * Worker explicitly rejects an invitation.
   */
  public async rejectInvitation(
    invitationIdentifier: bigint | string,
    workerUserIdInput: bigint | string,
    reason?: string
  ): Promise<WorkerInvitationResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const user = await prisma.user.findUnique({ where: { id: workerUserId } });

    if (!user) {
      throw new NotFoundError('Authenticated worker user not found.');
    }

    let invitation: WorkerInvitation | null = null;
    if (typeof invitationIdentifier === 'string' && invitationIdentifier.length >= 32) {
      const tokenHash = this.hashToken(invitationIdentifier);
      invitation = await this.invitationRepo.findByTokenHash(tokenHash);
    } else {
      invitation = await this.invitationRepo.findById(BigInt(invitationIdentifier));
    }

    if (!invitation) {
      throw new NotFoundError('Worker invitation not found.');
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

    const updated = await prisma.$transaction(async (tx) => {
      const transitioned = await this.invitationRepo.atomicTransitionStatus(
        invitation!.id,
        'PENDING',
        'REJECTED',
        {
          respondedAt: new Date(),
          rejectionReason: reason ? reason.trim() : 'Declined by worker',
          workerUserId,
        },
        tx
      );

      if (!transitioned) {
        throw new ConflictError('Invitation status transition conflict: Already processed.');
      }

      await tx.auditLog.create({
        data: {
          actorUserId: workerUserId,
          action: 'WORKER_INVITATION_REJECTED',
          entityName: 'WorkerInvitation',
          entityId: invitation!.id,
          newValues: {
            rejectionReason: reason ? reason.trim() : 'Declined by worker',
          },
        },
      });

      return transitioned;
    });

    logger.info(
      `[Worker Invitation] Worker User ${workerUserId.toString()} rejected invitation ${invitation.id.toString()}`
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
  ): Promise<WorkerInvitationResponse> {
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

    const updated = await prisma.$transaction(async (tx) => {
      const transitioned = await this.invitationRepo.atomicTransitionStatus(
        invitation.id,
        'PENDING',
        'REVOKED',
        {
          revokedAt: new Date(),
          revokedBy: partnerUserId,
          rejectionReason: reason ? reason.trim() : 'Revoked by partner',
        },
        tx
      );

      if (!transitioned) {
        throw new ConflictError('Failed to revoke invitation: Status conflict.');
      }

      await tx.auditLog.create({
        data: {
          actorUserId: partnerUserId,
          action: 'WORKER_INVITATION_REVOKED',
          entityName: 'WorkerInvitation',
          entityId: invitation.id,
          newValues: {
            revokedBy: partnerUserId.toString(),
            reason: reason ? reason.trim() : 'Revoked by partner',
          },
        },
      });

      return transitioned;
    });

    logger.info(
      `[Worker Invitation] Partner ${partner.id.toString()} revoked invitation ${invitationId.toString()}`
    );

    return this.serializeInvitation(updated);
  }

  /**
   * Partner resends an invitation: rotates token, extends 7-day Asia/Kolkata expiry, increments resend count.
   */
  public async resendInvitation(
    partnerUserIdInput: bigint | string,
    invitationIdInput: bigint | string
  ): Promise<{ invitation: WorkerInvitationResponse; invitationToken: string }> {
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
      throw new ForbiddenError('Cannot resend invitations belonging to another partner.');
    }

    if (invitation.invitationStatus !== 'PENDING') {
      throw new ConflictError(
        `Cannot resend invitation: Current status is '${invitation.invitationStatus}'. Only PENDING invitations can be resent.`
      );
    }

    // Rotate token & extend expiry
    const newRawToken = this.generateSecureToken();
    const newTokenHash = this.hashToken(newRawToken);
    const newExpiresAt = this.calculate7DayExpiryIST();

    const updated = await prisma.$transaction(async (tx) => {
      const res = await this.invitationRepo.incrementResendCount(
        invitation.id,
        newExpiresAt,
        newTokenHash,
        tx
      );

      await tx.auditLog.create({
        data: {
          actorUserId: partnerUserId,
          action: 'WORKER_INVITATION_RESENT',
          entityName: 'WorkerInvitation',
          entityId: invitation.id,
          newValues: {
            resendCount: res.resendCount,
            expiresAt: newExpiresAt.toISOString(),
          },
        },
      });

      return res;
    });

    logger.info(
      `[Worker Invitation] Partner ${partner.id.toString()} resent invitation ${invitationId.toString()} (Resend count: ${updated.resendCount})`
    );

    return {
      invitation: this.serializeInvitation(updated, partner.businessName ?? partner.legalName),
      invitationToken: newRawToken,
    };
  }

  /**
   * Housekeeping utility to expire stale invitations older than expiresAt.
   */
  public async expireInvitations(now: Date = new Date()): Promise<number> {
    return await this.invitationRepo.expireEligibleInvitations(now);
  }
}

// Default singleton export
export const workerInvitationService = new WorkerInvitationService();
