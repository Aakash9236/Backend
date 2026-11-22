import crypto from 'crypto';
import { Prisma, WorkerInvitation } from '@prisma/client';
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
import { PaginationOptions, PaginatedResult } from '../workers.types';

// ============================================================================
// Types & DTOs
// ============================================================================

export interface CreateWorkerInvitationInput {
  invitedMobile: string;
  workerName?: string | null;
  proposedRole?: string | null;
  notes?: string | null;
}

export interface WorkerInvitationResponse {
  id: string;
  partnerId: string;
  partnerBusinessName?: string;
  invitedMobile: string;
  workerName: string | null;
  workerUserId: string | null;
  invitationStatus: string;
  proposedRole: string | null;
  notes: string | null;
  expiresAt: string;
  respondedAt: string | null;
  rejectionReason: string | null;
  revokedAt: string | null;
  resendCount: number;
  createdAt: string;
  isExpired: boolean;
}

export interface WorkerInvitationPublicDetails {
  id: string;
  partnerId: string;
  partnerBusinessName?: string;
  invitedMobile: string;
  workerName: string | null;
  invitationStatus: string;
  proposedRole: string | null;
  notes: string | null;
  expiresAt: string;
  isExpired: boolean;
}

export interface WorkerInvitationAcceptResponse {
  invitation: WorkerInvitationResponse;
  affiliationId: string;
  workerProfileId: string;
  message: string;
}

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
   * Serializes a WorkerInvitation record into an API-safe response, avoiding token leakage.
   */
  private serializeInvitation(
    invitation: WorkerInvitation & { partner?: { businessName?: string | null; legalName?: string | null } | null },
    partnerName?: string
  ): WorkerInvitationResponse {
    const isExpired =
      invitation.invitationStatus === 'PENDING' && new Date() > invitation.expiresAt;

    const bName =
      partnerName || invitation.partner?.businessName || invitation.partner?.legalName || undefined;

    return {
      id: invitation.id.toString(),
      partnerId: invitation.partnerId.toString(),
      partnerBusinessName: bName,
      invitedMobile: invitation.invitedMobile,
      workerName: invitation.workerName,
      workerUserId: invitation.workerUserId ? invitation.workerUserId.toString() : null,
      invitationStatus: isExpired ? 'EXPIRED' : invitation.invitationStatus,
      proposedRole: invitation.proposedRole,
      notes: invitation.notes,
      expiresAt: invitation.expiresAt.toISOString(),
      respondedAt: invitation.respondedAt ? invitation.respondedAt.toISOString() : null,
      rejectionReason: invitation.rejectionReason,
      revokedAt: invitation.revokedAt ? invitation.revokedAt.toISOString() : null,
      resendCount: invitation.resendCount,
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
   * Calculates invitation expiry timestamp representing 7 full calendar days in Asia/Kolkata timezone.
   */
  private calculate7DayExpiryIST(now: Date = new Date()): Date {
    const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return DateUtil.getEndOfKolkataDay(futureDate);
  }

  /**
   * Creates a worker invitation sent by an authorized, active service partner.
   *
   * Business Rules:
   * 1. Partner must exist, have APPROVED profile, and not be suspended.
   * 2. Target mobile number must be normalized.
   * 3. Multiple partners may independently invite the same mobile number.
   * 4. Prevents duplicate active PENDING invitations for the same (partner, mobile) combination.
   * 5. Expiry set to 7 full calendar days in Asia/Kolkata.
   * 6. Does NOT create an affiliation upon invitation creation.
   * 7. Returns raw token securely once for delivery; stores only the SHA-256 hash in PostgreSQL.
   */
  public async createInvitation(
    partnerUserIdInput: bigint | string,
    input: CreateWorkerInvitationInput
  ): Promise<{ invitation: WorkerInvitationResponse; rawToken: string }> {
    const partnerUserId = BigInt(partnerUserIdInput);

    // 1. Verify partner authorization and operational standing
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
      include: { user: true },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found. Only registered partners can invite workers.');
    }

    if (partner.approvalStatus !== 'APPROVED') {
      throw new ForbiddenError(
        `Cannot invite workers: Partner profile approval status is '${partner.approvalStatus}'. Approval required.`
      );
    }

    if (partner.user && partner.user.accountStatus !== 'ACTIVE') {
      throw new ForbiddenError('Partner account is not active. Cannot invite workers.');
    }

    // 2. Normalize target mobile number
    const normalizedMobile = this.normalizeMobileNumber(input.invitedMobile);

    // 3. Prevent duplicate active PENDING invitations from the same partner
    const existingPending = await this.invitationRepo.findPendingByPartnerAndMobile(
      partner.id,
      normalizedMobile
    );

    if (existingPending) {
      // Check if it has expired
      if (new Date() > existingPending.expiresAt) {
        await this.invitationRepo.updateStatus(existingPending.id, 'EXPIRED');
      } else {
        throw new ConflictError(
          'A pending invitation already exists from this partner to this worker mobile number.'
        );
      }
    }

    // 4. Generate cryptographically secure token and SHA-256 hash
    const rawToken = this.generateSecureToken();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // 5. Calculate 7-day Asia/Kolkata expiry
    const expiresAt = this.calculate7DayExpiryIST();

    // 6. Create invitation record in database
    const createdInvitation = await this.invitationRepo.create({
      partnerId: partner.id,
      invitingUserId: partnerUserId,
      invitedMobile: normalizedMobile,
      workerName: input.workerName ? input.workerName.trim().slice(0, 150) : null,
      proposedRole: input.proposedRole ? input.proposedRole.trim().slice(0, 50) : null,
      notes: input.notes ? input.notes.trim().slice(0, 1000) : null,
      invitationTokenHash: tokenHash,
      expiresAt,
      invitationStatus: 'PENDING',
    });

    logger.info(
      `[Worker Invitation] Partner ${partner.id.toString()} invited worker mobile ${normalizedMobile} (Invitation ID: ${createdInvitation.id.toString()})`
    );

    return {
      invitation: this.serializeInvitation(createdInvitation, partner.businessName || partner.legalName),
      rawToken,
    };
  }

  /**
   * Public invitation inspection by raw token or ID for worker review prior to consent.
   * If authenticated workerUserId is provided, enforces mobile number match.
   */
  public async getInvitationDetails(
    invitationIdentifier: bigint | string,
    workerUserIdInput?: bigint | string
  ): Promise<WorkerInvitationPublicDetails> {
    let invitation: WorkerInvitation | null = null;

    if (typeof invitationIdentifier === 'string' && invitationIdentifier.length >= 32) {
      // Token lookup (hashes raw token with sha256)
      invitation = await this.invitationRepo.findByToken(invitationIdentifier);
    } else {
      invitation = await this.invitationRepo.findById(BigInt(invitationIdentifier));
    }

    if (!invitation) {
      throw new NotFoundError('Invitation not found or invalid token.');
    }

    if (workerUserIdInput) {
      const user = await prisma.user.findUnique({
        where: { id: BigInt(workerUserIdInput) },
      });
      if (user) {
        const userNormMobile = this.normalizeMobileNumber(user.mobileNumber);
        if (userNormMobile !== invitation.invitedMobile) {
          throw new ForbiddenError(
            'You do not have permission to view details of an invitation sent to another mobile number.'
          );
        }
      }
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
      partnerBusinessName: partner?.businessName || partner?.legalName || undefined,
      invitedMobile: invitation.invitedMobile,
      workerName: invitation.workerName,
      invitationStatus: isExpired ? 'EXPIRED' : invitation.invitationStatus,
      proposedRole: invitation.proposedRole,
      notes: invitation.notes,
      expiresAt: invitation.expiresAt.toISOString(),
      isExpired,
    };
  }

  /**
   * Lists invitations created by the authenticated partner.
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
        this.serializeInvitation(inv, partner.businessName || partner.legalName)
      ),
    };
  }

  /**
   * Lists invitations received for the authenticated worker user.
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
   * 1. Worker must authenticate with their own mobile number.
   * 2. Authenticated user's mobile MUST match the invitation's target mobile number.
   * 3. Invitation must be in PENDING status and not expired.
   * 4. Acceptance transition is atomic (concurrency-safe: atomicTransitionStatus).
   * 5. Atomically creates active affiliation in worker_partner_affiliations with consent timestamp.
   * 6. Preserves existing CUSTOMER, PARTNER, DRIVER, or ADMIN roles.
   * 7. Worker MUST have an existing worker profile before accepting.
   * 8. Does NOT automatically approve the worker profile.
   * 9. Replayed acceptance requests must not create duplicate affiliations.
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

    // Find invitation by ID or raw token
    let invitation: WorkerInvitation | null = null;
    if (typeof invitationIdentifier === 'string' && invitationIdentifier.length >= 32) {
      invitation = await this.invitationRepo.findByToken(invitationIdentifier);
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

    // 3. Worker must have an existing worker profile
    const profile = await this.profileRepo.findByUserId(workerUserId);
    if (!profile) {
      throw new NotFoundError(
        'Worker profile not found. Please complete worker onboarding before accepting an invitation.'
      );
    }

    // 4. Check if active affiliation already exists
    const existingAffiliation = await this.affiliationRepo.findActive(profile.id, invitation.partnerId);
    if (existingAffiliation) {
      throw new ConflictError('An active affiliation already exists between this worker and partner.');
    }

    // 5. Atomic acceptance & affiliation creation in single database transaction
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      // Concurrency check: Atomic conditional status transition
      const updatedInvitation = await this.invitationRepo.atomicTransitionStatus(
        invitation.id,
        'PENDING',
        'ACCEPTED',
        {
          respondedAt: now,
          workerUserId,
        },
        tx
      );

      if (!updatedInvitation) {
        throw new ConflictError(
          'Failed to accept invitation: Status changed concurrently. Please retry.'
        );
      }

      // Create active worker-partner affiliation
      const affiliation = await this.affiliationRepo.create(
        {
          workerId: profile.id,
          partnerId: invitation.partnerId,
          invitationId: invitation.id,
          affiliationStatus: 'ACTIVE',
          consentGivenAt: now,
          affiliatedAt: now,
        },
        tx
      );

      // Audit log creation
      await tx.auditLog.create({
        data: {
          actorUserId: workerUserId,
          action: 'WORKER_INVITATION_ACCEPTED',
          entityName: 'WorkerPartnerAffiliation',
          entityId: affiliation.id,
          newValues: {
            invitationId: invitation.id.toString(),
            workerId: profile.id.toString(),
            partnerId: invitation.partnerId.toString(),
            affiliatedAt: now.toISOString(),
          },
        },
      });

      return { updatedInvitation, affiliation };
    });

    logger.info(
      `[Worker Invitation] Worker ${profile.id.toString()} accepted invitation ${invitation.id.toString()} from partner ${invitation.partnerId.toString()}`
    );

    return {
      invitation: this.serializeInvitation(result.updatedInvitation),
      affiliationId: result.affiliation.id.toString(),
      workerProfileId: profile.id.toString(),
      message: 'Invitation accepted successfully and partner affiliation established.',
    };
  }

  /**
   * Worker explicitly rejects an invitation.
   */
  public async rejectInvitation(
    invitationIdentifier: bigint | string,
    workerUserIdInput: bigint | string,
    rejectionReason?: string
  ): Promise<WorkerInvitationResponse> {
    const workerUserId = BigInt(workerUserIdInput);

    const user = await prisma.user.findUnique({
      where: { id: workerUserId },
    });

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    let invitation: WorkerInvitation | null = null;
    if (typeof invitationIdentifier === 'string' && invitationIdentifier.length >= 32) {
      invitation = await this.invitationRepo.findByToken(invitationIdentifier);
    } else {
      invitation = await this.invitationRepo.findById(BigInt(invitationIdentifier));
    }

    if (!invitation) {
      throw new NotFoundError('Worker invitation not found.');
    }

    // Verify target mobile matches
    const normalizedUserMobile = this.normalizeMobileNumber(user.mobileNumber);
    if (normalizedUserMobile !== invitation.invitedMobile) {
      throw new ForbiddenError(
        'You cannot reject this invitation: Your registered mobile number does not match the invitation target.'
      );
    }

    if (invitation.invitationStatus !== 'PENDING') {
      throw new ConflictError(
        `Invitation is no longer pending (current status: '${invitation.invitationStatus}').`
      );
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await this.invitationRepo.atomicTransitionStatus(
        invitation.id,
        'PENDING',
        'REJECTED',
        {
          respondedAt: now,
          rejectionReason: rejectionReason ? rejectionReason.trim().slice(0, 500) : 'Worker rejected invitation',
          workerUserId,
        },
        tx
      );

      if (!result) {
        throw new ConflictError('Invitation status changed concurrently. Please retry.');
      }

      await tx.auditLog.create({
        data: {
          actorUserId: workerUserId,
          action: 'WORKER_INVITATION_REJECTED',
          entityName: 'WorkerInvitation',
          entityId: invitation.id,
          newValues: {
            status: 'REJECTED',
            rejectionReason: rejectionReason ?? 'Worker rejected invitation',
          },
        },
      });

      return result;
    });

    return this.serializeInvitation(updated);
  }

  /**
   * Partner revokes a pending invitation.
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
      throw new NotFoundError(`Worker invitation with ID ${invitationId.toString()} not found.`);
    }

    // Tenant check: partner can only revoke their own invitation
    if (invitation.partnerId !== partner.id) {
      throw new ForbiddenError('You do not have permission to revoke this invitation.');
    }

    if (invitation.invitationStatus !== 'PENDING') {
      throw new ConflictError(
        `Only pending invitations can be revoked (current status: '${invitation.invitationStatus}').`
      );
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await this.invitationRepo.atomicTransitionStatus(
        invitation.id,
        'PENDING',
        'REVOKED',
        {
          revokedAt: now,
          revokedBy: partnerUserId,
          rejectionReason: reason ? reason.trim().slice(0, 500) : 'Revoked by partner',
        },
        tx
      );

      if (!result) {
        throw new ConflictError('Invitation status changed concurrently. Please retry.');
      }

      await tx.auditLog.create({
        data: {
          actorUserId: partnerUserId,
          action: 'WORKER_INVITATION_REVOKED',
          entityName: 'WorkerInvitation',
          entityId: invitation.id,
          newValues: {
            status: 'REVOKED',
            reason: reason ?? 'Revoked by partner',
          },
        },
      });

      return result;
    });

    return this.serializeInvitation(updated);
  }

  /**
   * Resends an invitation with a rotated cryptographic token and refreshed expiry.
   */
  public async resendInvitation(
    partnerUserIdInput: bigint | string,
    invitationIdInput: bigint | string
  ): Promise<{ invitation: WorkerInvitationResponse; rawToken: string }> {
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
      throw new NotFoundError(`Worker invitation with ID ${invitationId.toString()} not found.`);
    }

    if (invitation.partnerId !== partner.id) {
      throw new ForbiddenError('You do not have permission to resend this invitation.');
    }

    if (invitation.invitationStatus !== 'PENDING') {
      throw new ConflictError('Only pending invitations can be resent.');
    }

    const rawToken = this.generateSecureToken();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const newExpiresAt = this.calculate7DayExpiryIST();

    const updated = await prisma.workerInvitation.update({
      where: { id: invitationId },
      data: {
        invitationTokenHash: tokenHash,
        expiresAt: newExpiresAt,
        resendCount: { increment: 1 },
      },
      include: {
        partner: true,
      },
    });

    return {
      invitation: this.serializeInvitation(updated),
      rawToken,
    };
  }

  /**
   * Batch expires all invitations past their expiration threshold.
   */
  public async expireInvitations(now: Date = new Date()): Promise<number> {
    return this.invitationRepo.expireEligibleInvitations(now);
  }
}

// Default singleton export
export const workerInvitationService = new WorkerInvitationService();
