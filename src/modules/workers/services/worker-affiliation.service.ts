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
import { PaginationOptions, PaginatedResult } from '../workers.types';

// ============================================================================
// Types & DTOs
// ============================================================================

export interface WorkerAffiliationResponse {
  id: string;
  workerId: string;
  workerFirstName?: string;
  workerLastName?: string | null;
  workerMobile?: string;
  workerType?: string;
  partnerId: string;
  partnerBusinessName?: string;
  partnerMobile?: string;
  invitationId: string | null;
  affiliationStatus: string;
  consentGivenAt: string;
  affiliatedAt: string;
  terminatedAt: string | null;
  terminationReason: string | null;
}

// ============================================================================
// Worker Affiliation Service
// ============================================================================

export class WorkerAffiliationService {
  constructor(
    private affiliationRepo: WorkerPartnerAffiliationRepository = new WorkerPartnerAffiliationRepository(),
    private profileRepo: WorkerProfileRepository = new WorkerProfileRepository()
  ) {}

  /**
   * Serializes a WorkerPartnerAffiliation record into an API-safe response,
   * strictly withholding private document keys or sensitive internal credentials.
   */
  private serializeAffiliation(affiliation: any): WorkerAffiliationResponse {
    const worker = affiliation.worker;
    const partner = affiliation.partner;

    return {
      id: affiliation.id.toString(),
      workerId: affiliation.workerId.toString(),
      workerFirstName: worker?.firstName,
      workerLastName: worker?.lastName,
      workerMobile: worker?.user?.mobileNumber,
      workerType: worker?.workerType,
      partnerId: affiliation.partnerId.toString(),
      partnerBusinessName: partner?.businessName || partner?.legalName,
      partnerMobile: partner?.user?.mobileNumber,
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
   * Workers can have multiple active partner affiliations without artificial cap.
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

    // Historical listing with status filter
    const history = await this.affiliationRepo.listByWorker(profile.id, options.status, { limit: 100 });
    return history.items.map((a: WorkerPartnerAffiliation) => this.serializeAffiliation(a));
  }

  /**
   * Retrieves an affiliation by ID for the authenticated worker with ownership verification.
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
      throw new NotFoundError(`Worker affiliation with ID ${affiliationId.toString()} not found.`);
    }

    if (affiliation.workerId !== profile.id) {
      throw new ForbiddenError('You do not have permission to view this affiliation.');
    }

    return this.serializeAffiliation(affiliation);
  }

  /**
   * Lists all workers affiliated with the authenticated partner's organization.
   * Enforces partner tenant isolation.
   */
  public async listPartnerWorkers(
    partnerUserIdInput: bigint | string,
    options?: PaginationOptions & { status?: string }
  ): Promise<PaginatedResult<WorkerAffiliationResponse>> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const result = await this.affiliationRepo.listByPartner(
      partner.id,
      options?.status,
      options
    );

    return {
      ...result,
      items: result.items.map((a: WorkerPartnerAffiliation) => this.serializeAffiliation(a)),
    };
  }

  /**
   * Retrieves details of an affiliated worker for the authenticated partner.
   * Strictly prevents partner from accessing private worker documents.
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
      throw new NotFoundError(`Worker affiliation with ID ${affiliationId.toString()} not found.`);
    }

    if (affiliation.partnerId !== partner.id) {
      throw new ForbiddenError('You do not have permission to view this affiliation.');
    }

    return this.serializeAffiliation(affiliation);
  }

  /**
   * Worker voluntarily terminates their own partner affiliation.
   *
   * Business Rules:
   * 1. Preserves historical record.
   * 2. Cannot terminate an already terminated affiliation.
   * 3. Writes atomic audit log.
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
      throw new NotFoundError(`Worker affiliation with ID ${affiliationId.toString()} not found.`);
    }

    if (affiliation.workerId !== profile.id) {
      throw new ForbiddenError('You do not have permission to terminate this affiliation.');
    }

    if (affiliation.affiliationStatus === 'TERMINATED') {
      throw new ConflictError('Affiliation is already terminated.');
    }

    const now = new Date();
    const terminationReason = reason ? reason.trim().slice(0, 500) : 'Worker voluntary termination';

    const updated = await prisma.$transaction(async (tx) => {
      const termAffiliation = await this.affiliationRepo.terminate(
        affiliationId,
        terminationReason,
        now,
        tx
      );

      await tx.auditLog.create({
        data: {
          actorUserId: workerUserId,
          action: 'WORKER_AFFILIATION_TERMINATED_BY_WORKER',
          entityName: 'WorkerPartnerAffiliation',
          entityId: affiliationId,
          oldValues: {
            affiliationStatus: affiliation.affiliationStatus,
          },
          newValues: {
            affiliationStatus: 'TERMINATED',
            terminatedAt: now.toISOString(),
            terminationReason,
          },
        },
      });

      return termAffiliation;
    });

    logger.info(
      `[Worker Affiliation] Worker ${profile.id.toString()} terminated affiliation ${affiliationId.toString()} with partner ${affiliation.partnerId.toString()}`
    );

    return this.serializeAffiliation(updated);
  }

  /**
   * Partner terminates affiliation with a worker.
   *
   * Business Rules:
   * 1. Partner must own the affiliation.
   * 2. Mandatory termination reason required.
   * 3. Preserves historical record.
   * 4. Writes atomic audit log.
   */
  public async terminatePartnerAffiliation(
    partnerUserIdInput: bigint | string,
    affiliationIdInput: bigint | string,
    reason: string
  ): Promise<WorkerAffiliationResponse> {
    const partnerUserId = BigInt(partnerUserIdInput);
    const affiliationId = BigInt(affiliationIdInput);

    if (!reason || !reason.trim()) {
      throw new BadRequestError('Termination reason is mandatory when partner terminates affiliation.');
    }

    const partner = await prisma.partnerProfile.findUnique({
      where: { userId: partnerUserId },
    });

    if (!partner) {
      throw new ForbiddenError('Partner profile not found.');
    }

    const affiliation = await this.affiliationRepo.findById(affiliationId);
    if (!affiliation) {
      throw new NotFoundError(`Worker affiliation with ID ${affiliationId.toString()} not found.`);
    }

    if (affiliation.partnerId !== partner.id) {
      throw new ForbiddenError('You do not have permission to terminate this affiliation.');
    }

    if (affiliation.affiliationStatus === 'TERMINATED') {
      throw new ConflictError('Affiliation is already terminated.');
    }

    const now = new Date();
    const terminationReason = reason.trim().slice(0, 500);

    const updated = await prisma.$transaction(async (tx) => {
      const termAffiliation = await this.affiliationRepo.terminate(
        affiliationId,
        terminationReason,
        now,
        tx
      );

      await tx.auditLog.create({
        data: {
          actorUserId: partnerUserId,
          action: 'WORKER_AFFILIATION_TERMINATED_BY_PARTNER',
          entityName: 'WorkerPartnerAffiliation',
          entityId: affiliationId,
          oldValues: {
            affiliationStatus: affiliation.affiliationStatus,
          },
          newValues: {
            affiliationStatus: 'TERMINATED',
            terminatedAt: now.toISOString(),
            terminationReason,
          },
        },
      });

      return termAffiliation;
    });

    logger.info(
      `[Worker Affiliation] Partner ${partner.id.toString()} terminated affiliation ${affiliationId.toString()} with worker ${affiliation.workerId.toString()}`
    );

    return this.serializeAffiliation(updated);
  }

  /**
   * Retrieves complete affiliation history for the authenticated worker with pagination.
   */
  public async getAffiliationHistory(
    workerUserIdInput: bigint | string,
    options?: PaginationOptions
  ): Promise<PaginatedResult<WorkerAffiliationResponse>> {
    const workerUserId = BigInt(workerUserIdInput);
    const profile = await this.profileRepo.findByUserId(workerUserId);

    if (!profile) {
      throw new NotFoundError('Worker profile not found.');
    }

    const result = await this.affiliationRepo.listByWorker(profile.id, undefined, options);

    return {
      ...result,
      items: result.items.map((a: WorkerPartnerAffiliation) => this.serializeAffiliation(a)),
    };
  }
}

// Default singleton export
export const workerAffiliationService = new WorkerAffiliationService();
