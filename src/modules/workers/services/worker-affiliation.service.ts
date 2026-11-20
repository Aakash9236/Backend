import { WorkerPartnerAffiliation } from '@prisma/client';
import { prisma } from '../../../config/db.config';
import { logger } from '../../../config/logger.config';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../../../common/errors';
import { WorkerPartnerAffiliationRepository } from '../repositories/worker-partner-affiliation.repository';
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import {
  WorkerAffiliationResponse,
  PaginationOptions,
  PaginatedResult,
} from '../workers.types';

// ============================================================================
// Worker Affiliation Service
// ============================================================================

export class WorkerAffiliationService {
  constructor(
    private affiliationRepo: WorkerPartnerAffiliationRepository = new WorkerPartnerAffiliationRepository(),
    private profileRepo: WorkerProfileRepository = new WorkerProfileRepository()
  ) {}

  /**
   * Serializes a WorkerPartnerAffiliation record into an API-safe response.
   * Strictly avoids leaking private KYC documents or internal storage keys.
   */
  private serializeAffiliation(affiliation: any): WorkerAffiliationResponse {
    return {
      id: affiliation.id.toString(),
      workerId: affiliation.workerId.toString(),
      workerName: affiliation.worker
        ? `${affiliation.worker.firstName} ${affiliation.worker.lastName || ''}`.trim()
        : undefined,
      workerMobile: affiliation.worker?.user?.mobileNumber,
      partnerId: affiliation.partnerId.toString(),
      partnerBusinessName: affiliation.partner?.businessName ?? affiliation.partner?.legalName,
      partnerMobile: affiliation.partner?.user?.mobileNumber,
      invitationId: affiliation.invitationId ? affiliation.invitationId.toString() : null,
      affiliationStatus: affiliation.affiliationStatus,
      consentGivenAt: affiliation.consentGivenAt.toISOString(),
      affiliatedAt: affiliation.affiliatedAt.toISOString(),
      terminatedAt: affiliation.terminatedAt ? affiliation.terminatedAt.toISOString() : null,
      terminationReason: affiliation.terminationReason,
    };
  }

  /**
   * Lists all active or historical affiliations for the authenticated worker.
   * Business Rules:
   * 1. A worker can have unlimited active partner affiliations (non-exclusive M:N).
   * 2. No arbitrary global affiliation cap.
   */
  public async listMyAffiliations(
    workerUserIdInput: bigint | string,
    options?: { status?: string }
  ): Promise<WorkerAffiliationResponse[]> {
    const workerUserId = BigInt(workerUserIdInput);
    const profile = await this.profileRepo.findByUserId(workerUserId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    if (options?.status === 'ACTIVE' || !options?.status) {
      const activeAffiliations = await this.affiliationRepo.listActiveByWorker(profile.id);
      return activeAffiliations.map((a: WorkerPartnerAffiliation) => this.serializeAffiliation(a));
    }

    // Historical listing
    const history = await this.affiliationRepo.listByWorker(profile.id, options?.status);
    return history.items.map((a: WorkerPartnerAffiliation) => this.serializeAffiliation(a));
  }

  /**
   * Retrieves an affiliation record by ID for the authenticated worker with IDOR protection.
   */
  public async getMyAffiliation(
    workerUserIdInput: bigint | string,
    affiliationIdInput: bigint | string
  ): Promise<WorkerAffiliationResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const affiliationId = BigInt(affiliationIdInput);

    const profile = await this.profileRepo.findByUserId(workerUserId);
    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    const affiliation = await this.affiliationRepo.findById(affiliationId);
    if (!affiliation) {
      throw new NotFoundError(`Affiliation with ID ${affiliationId.toString()} not found.`);
    }

    // Strict worker ownership enforcement
    if (affiliation.workerId !== profile.id) {
      logger.warn(
        `[Worker Affiliation Security] IDOR attempt: Worker User ${workerUserId.toString()} attempted to view affiliation ${affiliationId.toString()} owned by Worker ${affiliation.workerId.toString()}`
      );
      throw new ForbiddenError('You do not have permission to view this affiliation.');
    }

    return this.serializeAffiliation(affiliation);
  }

  /**
   * Lists all workers affiliated with the authenticated partner fleet.
   * Enforces partner tenant isolation: partners see only their own affiliated workers.
   */
  public async listPartnerWorkers(
    partnerUserIdInput: bigint | string,
    options?: { status?: string },
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<WorkerAffiliationResponse>> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    if (options?.status === 'ACTIVE' || !options?.status) {
      const result = await this.affiliationRepo.listActiveByPartner(partner.id, pagination);
      return {
        ...result,
        items: result.items.map((a: WorkerPartnerAffiliation) => this.serializeAffiliation(a)),
      };
    }

    // Historical / status filtered listing
    const page = Math.max(1, pagination?.page || 1);
    const limit = Math.max(1, Math.min(100, pagination?.limit || 20));
    const skip = (page - 1) * limit;

    const where = {
      partnerId: partner.id,
      ...(options?.status ? { affiliationStatus: options.status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.workerPartnerAffiliation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { affiliatedAt: 'desc' },
        include: {
          worker: {
            include: {
              user: {
                select: {
                  id: true,
                  mobileNumber: true,
                  email: true,
                },
              },
            },
          },
          partner: true,
        },
      }),
      prisma.workerPartnerAffiliation.count({ where }),
    ]);

    return {
      items: items.map((a: any) => this.serializeAffiliation(a)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves affiliated worker details for a partner fleet with tenant isolation.
   * Partner does NOT receive private worker KYC documents or storage keys (Rule 6).
   */
  public async getPartnerWorkerDetails(
    partnerUserIdInput: bigint | string,
    affiliationIdInput: bigint | string
  ): Promise<WorkerAffiliationResponse> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const affiliationId = BigInt(affiliationIdInput);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });
    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const affiliation = await this.affiliationRepo.findById(affiliationId);
    if (!affiliation) {
      throw new NotFoundError(`Affiliation with ID ${affiliationId.toString()} not found.`);
    }

    if (affiliation.partnerId !== partner.id) {
      logger.warn(
        `[Worker Affiliation Security] Cross-partner attempt: Partner ${partner.id.toString()} attempted to view affiliation ${affiliationId.toString()} of Partner ${affiliation.partnerId.toString()}`
      );
      throw new ForbiddenError('You cannot view affiliated workers of another partner.');
    }

    return this.serializeAffiliation(affiliation);
  }

  /**
   * Worker voluntarily terminates their own affiliation.
   *
   * Business Rules:
   * 1. Worker must own the affiliation.
   * 2. Preserves historical records (transitions status to TERMINATED).
   * 3. Idempotent / conflict-safe: cannot terminate if already TERMINATED.
   * 4. Writes atomic audit log.
   */
  public async terminateMyAffiliation(
    workerUserIdInput: bigint | string,
    affiliationIdInput: bigint | string,
    reason?: string
  ): Promise<WorkerAffiliationResponse> {
    const workerUserId = BigInt(workerUserIdInput);
    const affiliationId = BigInt(affiliationIdInput);

    const profile = await this.profileRepo.findByUserId(workerUserId);
    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    const affiliation = await this.affiliationRepo.findById(affiliationId);
    if (!affiliation) {
      throw new NotFoundError(`Affiliation with ID ${affiliationId.toString()} not found.`);
    }

    if (affiliation.workerId !== profile.id) {
      throw new ForbiddenError('You do not have permission to terminate an affiliation that is not yours.');
    }

    if (affiliation.affiliationStatus === 'TERMINATED') {
      throw new ConflictError('This affiliation has already been terminated.');
    }

    const terminated = await prisma.$transaction(async (tx) => {
      const result = await this.affiliationRepo.terminate(
        affiliationId,
        reason ? reason.trim() : 'Voluntarily disaffiliated by worker',
        new Date(),
        tx
      );

      await tx.auditLog.create({
        data: {
          actorUserId: workerUserId,
          action: 'WORKER_AFFILIATION_TERMINATED_BY_WORKER',
          entityName: 'WorkerPartnerAffiliation',
          entityId: affiliation.id,
          oldValues: { affiliationStatus: affiliation.affiliationStatus },
          newValues: {
            affiliationStatus: 'TERMINATED',
            terminationReason: reason ? reason.trim() : 'Voluntarily disaffiliated by worker',
          },
        },
      });

      return result;
    });

    logger.info(
      `[Worker Affiliation] Worker ${profile.id.toString()} voluntarily terminated affiliation ${affiliationId.toString()} with Partner ${affiliation.partnerId.toString()}`
    );

    return this.serializeAffiliation(terminated);
  }

  /**
   * Partner terminates an affiliation with a worker.
   *
   * Business Rules:
   * 1. Partner must own the affiliation.
   * 2. Recorded reason is required.
   * 3. Preserves historical record.
   * 4. Writes atomic audit log.
   */
  public async terminatePartnerAffiliation(
    partnerUserIdInput: bigint | string,
    affiliationIdInput: bigint | string,
    reason?: string
  ): Promise<WorkerAffiliationResponse> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const affiliationId = BigInt(affiliationIdInput);

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });
    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const affiliation = await this.affiliationRepo.findById(affiliationId);
    if (!affiliation) {
      throw new NotFoundError(`Affiliation with ID ${affiliationId.toString()} not found.`);
    }

    if (affiliation.partnerId !== partner.id) {
      throw new ForbiddenError('You cannot terminate an affiliation belonging to another partner fleet.');
    }

    if (affiliation.affiliationStatus === 'TERMINATED') {
      throw new ConflictError('This affiliation has already been terminated.');
    }

    const terminationReason = reason ? reason.trim() : 'Terminated by service partner';

    const terminated = await prisma.$transaction(async (tx) => {
      const result = await this.affiliationRepo.terminate(
        affiliationId,
        terminationReason,
        new Date(),
        tx
      );

      await tx.auditLog.create({
        data: {
          actorUserId: partnerUserId,
          action: 'WORKER_AFFILIATION_TERMINATED_BY_PARTNER',
          entityName: 'WorkerPartnerAffiliation',
          entityId: affiliation.id,
          oldValues: { affiliationStatus: affiliation.affiliationStatus },
          newValues: {
            affiliationStatus: 'TERMINATED',
            terminationReason,
          },
        },
      });

      return result;
    });

    logger.info(
      `[Worker Affiliation] Partner ${partner.id.toString()} terminated affiliation ${affiliationId.toString()} with Worker ${affiliation.workerId.toString()}`
    );

    return this.serializeAffiliation(terminated);
  }

  /**
   * Retrieves full affiliation history for a given affiliation record.
   * Accessible only to the affiliated worker or the affiliated partner owner.
   */
  public async getAffiliationHistory(
    userIdInput: bigint | string,
    affiliationIdInput: bigint | string
  ): Promise<WorkerAffiliationResponse> {
    const userId = BigInt(userIdInput);
    const affiliationId = BigInt(affiliationIdInput);

    const affiliation = await this.affiliationRepo.findById(affiliationId);
    if (!affiliation) {
      throw new NotFoundError(`Affiliation with ID ${affiliationId.toString()} not found.`);
    }

    const driverWorker = await this.profileRepo.findById(affiliation.workerId);
    const partner = await prisma.partnerProfile.findUnique({
      where: { id: affiliation.partnerId },
    });

    const isAffiliatedWorker = driverWorker?.userId === userId;
    const isAffiliatedPartner = partner?.userId === userId;

    if (!isAffiliatedWorker && !isAffiliatedPartner) {
      throw new ForbiddenError('You do not have permission to view this affiliation history.');
    }

    return this.serializeAffiliation(affiliation);
  }
}

// Default singleton export
export const workerAffiliationService = new WorkerAffiliationService();
