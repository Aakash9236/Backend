import { Request, Response, NextFunction } from 'express';
import { BadRequestError } from '../../common/errors/app.error';
import {
  workerOnboardingService,
  WorkerOnboardingService,
} from './services/worker-onboarding.service';
import {
  workerInvitationService,
  WorkerInvitationService,
} from './services/worker-invitation.service';
import {
  workerAffiliationService,
  WorkerAffiliationService,
} from './services/worker-affiliation.service';
import {
  workerAvailabilityService,
  WorkerAvailabilityService,
} from './services/worker-availability.service';
import { ApiResponse } from '../../common/utils/api-response.util';

export class WorkerController {
  constructor(
    private onboardingService: WorkerOnboardingService = workerOnboardingService,
    private invitationService: WorkerInvitationService = workerInvitationService,
    private affiliationService: WorkerAffiliationService = workerAffiliationService,
    private availabilityService: WorkerAvailabilityService = workerAvailabilityService
  ) {}

  // ==========================================================================
  // 1. Worker Profile & Onboarding
  // ==========================================================================

  public getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const profile = await this.onboardingService.getOrCreateProfile(userId);
      ApiResponse.success(res, profile, 'Worker profile retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const updated = await this.onboardingService.updateMyProfile(userId, req.body);
      ApiResponse.success(res, updated, 'Worker profile updated successfully');
    } catch (err) {
      next(err);
    }
  };

  public submitOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const submitted = await this.onboardingService.submitOnboarding(userId);
      ApiResponse.success(res, submitted, 'Worker onboarding application submitted for review');
    } catch (err) {
      next(err);
    }
  };

  public resubmitOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const resubmitted = await this.onboardingService.resubmitOnboarding(userId);
      ApiResponse.success(res, resubmitted, 'Worker onboarding application resubmitted for review');
    } catch (err) {
      next(err);
    }
  };

  public getStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const status = await this.onboardingService.getOnboardingStatus(userId);
      ApiResponse.success(res, status, 'Worker onboarding status retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  // ==========================================================================
  // 2. KYC Document Management
  // ==========================================================================

  public uploadDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const file = req.file;
      if (!file) {
        throw new BadRequestError('Document file is required.');
      }
      const doc = await this.onboardingService.uploadDocument(userId, req.body, file);
      ApiResponse.created(res, doc, 'Worker document uploaded successfully');
    } catch (err) {
      next(err);
    }
  };

  public replaceDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const docId = req.params.id;
      const file = req.file;
      if (!file) {
        throw new BadRequestError('Replacement document file is required.');
      }
      const existingDoc = await this.onboardingService.getDocumentStatus(userId, docId);
      const doc = await this.onboardingService.replaceDocument(
        userId,
        {
          documentType: req.body?.documentType || existingDoc.documentType,
          expiryDate: req.body?.expiryDate || existingDoc.expiryDate,
          documentMetadata: req.body?.documentMetadata,
        },
        file
      );
      ApiResponse.success(res, doc, 'Worker document replaced successfully');
    } catch (err) {
      next(err);
    }
  };

  public getDocuments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const docs = await this.onboardingService.listMyDocuments(userId);
      ApiResponse.success(res, docs, 'Worker documents retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public getDocumentDetails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const docId = req.params.id;
      const doc = await this.onboardingService.getDocumentStatus(userId, docId);
      ApiResponse.success(res, doc, 'Worker document details retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public getDocumentFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const docId = req.params.id;
      const { buffer, mimeType } = await this.onboardingService.streamMyDocument(userId, docId);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="worker-document-${docId}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================================================
  // 3. Worker Skills Management
  // ==========================================================================

  public addSkill = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const skill = await this.onboardingService.addSkill(userId, req.body);
      ApiResponse.created(res, skill, 'Worker skill registered successfully');
    } catch (err) {
      next(err);
    }
  };

  public getSkills = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const skills = await this.onboardingService.listMySkills(userId);
      ApiResponse.success(res, skills, 'Worker skills retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public removeSkill = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const skillId = req.params.id;
      await this.onboardingService.removeSkill(userId, skillId);
      ApiResponse.success(res, null, 'Worker skill removed successfully');
    } catch (err) {
      next(err);
    }
  };

  // ==========================================================================
  // 4. Worker Invitations Management
  // ==========================================================================

  public getReceivedInvitations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await this.invitationService.listWorkerInvitations(userId, { page, limit });
      ApiResponse.success(res, result.items, 'Worker invitations retrieved successfully', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (err) {
      next(err);
    }
  };

  public getInvitationById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const invitationId = req.params.id;
      const invitation = await this.invitationService.getInvitationDetails(invitationId, userId);
      ApiResponse.success(res, invitation, 'Worker invitation details retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public acceptInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const invitationId = req.params.id;
      const result = await this.invitationService.acceptInvitation(invitationId, userId);
      ApiResponse.success(res, result, 'Worker invitation accepted successfully');
    } catch (err) {
      next(err);
    }
  };

  public rejectInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const invitationId = req.params.id;
      const reason = req.body?.reason;
      const result = await this.invitationService.rejectInvitation(invitationId, userId, reason);
      ApiResponse.success(res, result, 'Worker invitation declined successfully');
    } catch (err) {
      next(err);
    }
  };

  public lookupInvitationByToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.body?.token || req.params?.token;
      if (!token) {
        throw new BadRequestError('Invitation token is required.');
      }
      const invitation = await this.invitationService.getInvitationDetails(token);
      ApiResponse.success(res, invitation, 'Invitation details retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  // ==========================================================================
  // 5. Worker-Partner Affiliations
  // ==========================================================================

  public getAffiliations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const status = req.query.status as string | undefined;

      const result = await this.affiliationService.listMyAffiliations(userId, { status });
      ApiResponse.success(res, result, 'Worker affiliations retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public getAffiliationById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const affiliationId = req.params.id;
      const result = await this.affiliationService.getMyAffiliation(userId, affiliationId);
      ApiResponse.success(res, result, 'Worker affiliation details retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public terminateAffiliation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const affiliationId = req.params.id;
      const reason = req.body?.reason;
      const result = await this.affiliationService.terminateMyAffiliation(userId, affiliationId, reason);
      ApiResponse.success(res, result, 'Worker affiliation terminated successfully');
    } catch (err) {
      next(err);
    }
  };

  public getAffiliationHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const result = await this.affiliationService.getAffiliationHistory(userId, { page, limit });
      ApiResponse.success(res, result.items, 'Worker affiliation history retrieved successfully', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (err) {
      next(err);
    }
  };

  // ==========================================================================
  // 6. Availability & Heartbeat
  // ==========================================================================

  public getAvailability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const availability = await this.availabilityService.getMyAvailability(userId);
      ApiResponse.success(res, availability, 'Worker availability retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public updateDutyStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { isOnline, latitude, longitude } = req.body;

      const result = isOnline
        ? await this.availabilityService.goOnline(userId, { latitude, longitude })
        : await this.availabilityService.goOffline(userId);

      ApiResponse.success(
        res,
        result,
        isOnline ? 'Worker availability transitioned to ONLINE' : 'Worker availability transitioned to OFFLINE'
      );
    } catch (err) {
      next(err);
    }
  };

  public updateHeartbeat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { latitude, longitude } = req.body;
      const result = await this.availabilityService.updateHeartbeat(userId, { latitude, longitude });
      ApiResponse.success(res, result, 'Heartbeat recorded successfully');
    } catch (err) {
      next(err);
    }
  };
}

export const workerController = new WorkerController();
