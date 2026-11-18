import { Request, Response, NextFunction } from 'express';
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

export class DriverPartnerController {
  constructor(
    private invitationService: DriverInvitationService = driverInvitationService,
    private affiliationService: DriverAffiliationService = driverAffiliationService,
    private assignmentService: DriverAssignmentService = driverAssignmentService
  ) {}

  // --------------------------------------------------------------------------
  // Fleet Partner Driver Invitations
  // --------------------------------------------------------------------------

  public sendInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const result = await this.invitationService.createInvitation(partnerUserId, req.body);
      ApiResponse.created(
        res,
        {
          ...result.invitation,
          invitationToken: result.invitationToken,
        },
        'Driver invitation sent successfully'
      );
    } catch (err) {
      next(err);
    }
  };

  public listInvitations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const status = req.query.status as string | undefined;

      const result = await this.invitationService.listPartnerInvitations(
        partnerUserId,
        { status },
        { page, limit }
      );

      ApiResponse.success(res, result.items, 'Partner invitations retrieved successfully', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (err) {
      next(err);
    }
  };

  public getInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const invitationId = req.params.id;
      const result = await this.invitationService.getInvitationById(partnerUserId, invitationId);
      ApiResponse.success(res, result, 'Invitation details retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public revokeInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const invitationId = req.params.id;
      const reason = req.body?.reason;
      const result = await this.invitationService.revokeInvitation(
        partnerUserId,
        invitationId,
        reason
      );
      ApiResponse.success(res, result, 'Driver invitation revoked successfully');
    } catch (err) {
      next(err);
    }
  };

  // --------------------------------------------------------------------------
  // Fleet Partner Affiliations
  // --------------------------------------------------------------------------

  public listAffiliatedDrivers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const status = req.query.status as string | undefined;
      const result = await this.affiliationService.listPartnerAffiliations(partnerUserId, { status });
      ApiResponse.success(res, result, 'Affiliated drivers retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public terminateAffiliation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const affiliationId = req.params.id;
      const reason = req.body?.reason;
      const result = await this.affiliationService.terminateAffiliationByPartner(
        partnerUserId,
        affiliationId,
        reason
      );
      ApiResponse.success(res, result, 'Driver affiliation terminated successfully');
    } catch (err) {
      next(err);
    }
  };

  // --------------------------------------------------------------------------
  // Fleet Partner Vehicle Assignments & Shifts
  // --------------------------------------------------------------------------

  public scheduleAssignment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const result = await this.assignmentService.scheduleAssignment(partnerUserId, req.body);
      ApiResponse.created(res, result, 'Driver vehicle shift scheduled successfully');
    } catch (err) {
      next(err);
    }
  };

  public listAssignments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const status = req.query.status as any;

      const result = await this.assignmentService.listPartnerAssignments(
        partnerUserId,
        { status },
        { page, limit }
      );

      ApiResponse.success(res, result.items, 'Partner vehicle assignments retrieved successfully', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (err) {
      next(err);
    }
  };

  public getAssignment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const assignmentId = req.params.id;
      const result = await this.assignmentService.getPartnerAssignmentById(partnerUserId, assignmentId);
      ApiResponse.success(res, result, 'Assignment details retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public cancelAssignment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const assignmentId = req.params.id;
      const { reason } = req.body;
      const result = await this.assignmentService.cancelAssignment(
        assignmentId,
        partnerUserId,
        'PARTNER',
        reason
      );
      ApiResponse.success(res, result, 'Shift assignment cancelled successfully');
    } catch (err) {
      next(err);
    }
  };

  public approveCancellation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const partnerUserId = req.user!.userId;
      const assignmentId = req.params.id;
      const result = await this.assignmentService.approveDriverCancellation(
        assignmentId,
        partnerUserId,
        req.body
      );
      ApiResponse.success(res, result, 'Driver shift cancellation approved successfully');
    } catch (err) {
      next(err);
    }
  };
}

export const driverPartnerController = new DriverPartnerController();
