import { Request, Response, NextFunction } from 'express';
import { BadRequestError } from '../../common/errors/app.error';
import {
  driverOnboardingService,
  DriverOnboardingService,
} from './services/driver-onboarding.service';
import {
  driverInvitationService,
  DriverInvitationService,
} from './services/driver-invitation.service';
import {
  driverAffiliationService,
  DriverAffiliationService,
} from './services/driver-affiliation.service';
import {
  driverAssignmentService,
  DriverAssignmentService,
} from './services/driver-assignment.service';
import { ApiResponse } from '../../common/utils/api-response.util';

export class DriverController {
  constructor(
    private onboardingService: DriverOnboardingService = driverOnboardingService,
    private invitationService: DriverInvitationService = driverInvitationService,
    private affiliationService: DriverAffiliationService = driverAffiliationService,
    private assignmentService: DriverAssignmentService = driverAssignmentService
  ) {}

  // --------------------------------------------------------------------------
  // Profile & Onboarding
  // --------------------------------------------------------------------------

  public getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const profile = await this.onboardingService.getOrCreateProfile(userId);
      ApiResponse.success(res, profile, 'Driver profile retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const updated = await this.onboardingService.updateProfile(userId, req.body);
      ApiResponse.success(res, updated, 'Driver profile updated successfully');
    } catch (err) {
      next(err);
    }
  };

  public submitOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const submitted = await this.onboardingService.submitProfile(userId);
      ApiResponse.success(res, submitted, 'Driver onboarding application submitted for review');
    } catch (err) {
      next(err);
    }
  };

  public resubmitOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const resubmitted = await this.onboardingService.resubmitProfile(userId);
      ApiResponse.success(res, resubmitted, 'Driver onboarding application resubmitted for review');
    } catch (err) {
      next(err);
    }
  };

  public getStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const profile = await this.onboardingService.getProfile(userId);
      ApiResponse.success(
        res,
        {
          id: profile.id,
          submissionStatus: profile.submissionStatus,
          approvalStatus: profile.approvalStatus,
          rejectionReason: profile.rejectionReason,
          isSuspended: profile.isSuspended,
        },
        'Driver onboarding status retrieved successfully'
      );
    } catch (err) {
      next(err);
    }
  };

  public uploadDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const file = req.file;
      if (!file) {
        throw new BadRequestError('Document file is required.');
      }
      const doc = await this.onboardingService.uploadDocument(userId, req.body, file);
      ApiResponse.created(res, doc, 'Driver document uploaded successfully');
    } catch (err) {
      next(err);
    }
  };

  public getDocuments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const docs = await this.onboardingService.getDocuments(userId);
      ApiResponse.success(res, docs, 'Driver documents retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public getDocumentFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const docId = req.params.id;
      const { buffer, mimeType } = await this.onboardingService.streamDocument(userId, docId);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="driver-document-${docId}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  };

  // --------------------------------------------------------------------------
  // Invitations
  // --------------------------------------------------------------------------

  public getReceivedInvitations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await this.invitationService.listDriverReceivedInvitations(userId, { page, limit });
      ApiResponse.success(res, result.items, 'Received invitations retrieved successfully', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (err) {
      next(err);
    }
  };

  public getInvitationByToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.params.token;
      const invitation = await this.invitationService.getInvitationByToken(token);
      ApiResponse.success(res, invitation, 'Invitation details retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public acceptInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const invitationId = req.params.id;
      const result = await this.invitationService.acceptInvitation(invitationId, userId);
      ApiResponse.success(res, result, 'Driver invitation accepted successfully');
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
      ApiResponse.success(res, result, 'Driver invitation declined');
    } catch (err) {
      next(err);
    }
  };

  // --------------------------------------------------------------------------
  // Affiliations
  // --------------------------------------------------------------------------

  public getAffiliations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const status = req.query.status as string | undefined;

      const result = await this.affiliationService.listDriverAffiliations(userId, { status });
      ApiResponse.success(res, result, 'Driver affiliations retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public getAffiliationById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const affiliationId = req.params.id;
      const result = await this.affiliationService.getAffiliationById(userId, affiliationId);
      ApiResponse.success(res, result, 'Affiliation details retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public terminateAffiliation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const affiliationId = req.params.id;
      const reason = req.body.reason;
      const result = await this.affiliationService.terminateAffiliationByDriver(userId, affiliationId, reason);
      ApiResponse.success(res, result, 'Affiliation terminated successfully');
    } catch (err) {
      next(err);
    }
  };

  // --------------------------------------------------------------------------
  // Assignments & Shifts
  // --------------------------------------------------------------------------

  public getAssignments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const status = req.query.status as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await this.assignmentService.listDriverAssignments(userId, { status }, { page, limit });
      ApiResponse.success(res, result.items, 'Driver shift assignments retrieved successfully', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (err) {
      next(err);
    }
  };

  public getAssignmentById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const assignmentId = req.params.id;
      const result = await this.assignmentService.getDriverAssignmentById(userId, assignmentId);
      ApiResponse.success(res, result, 'Assignment details retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public startShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const assignmentId = req.params.id;
      const result = await this.assignmentService.startAssignment(assignmentId, userId, req.body);
      ApiResponse.success(res, result, 'Shift started successfully. Drive safely!');
    } catch (err) {
      next(err);
    }
  };

  public completeShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const assignmentId = req.params.id;
      const notes = req.body?.notes;
      const result = await this.assignmentService.completeAssignment(assignmentId, userId, notes);
      ApiResponse.success(res, result, 'Shift completed successfully');
    } catch (err) {
      next(err);
    }
  };

  public cancelShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const assignmentId = req.params.id;
      const reason = req.body.reason;
      const result = await this.assignmentService.cancelAssignment(assignmentId, userId, 'DRIVER', reason);
      ApiResponse.success(res, result, 'Shift assignment cancelled successfully');
    } catch (err) {
      next(err);
    }
  };

  public updateDutyStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { isOnline } = req.body;
      const result = await this.assignmentService.toggleOnlineStatus(userId, isOnline);
      ApiResponse.success(
        res,
        result,
        `Driver status updated: You are now ${isOnline ? 'ONLINE' : 'OFFLINE'}`
      );
    } catch (err) {
      next(err);
    }
  };

  public sendHeartbeat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const result = await this.assignmentService.updateHeartbeat(userId, req.body);
      ApiResponse.success(res, result, 'Heartbeat recorded successfully');
    } catch (err) {
      next(err);
    }
  };
}

export const driverController = new DriverController();
