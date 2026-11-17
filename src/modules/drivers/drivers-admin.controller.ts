import { Request, Response, NextFunction } from 'express';
import {
  driverAdminService,
  DriverAdminService,
  AdminClientInfo,
} from './services/driver-admin.service';
import { ApiResponse } from '../../common/utils/api-response.util';

export class DriverAdminController {
  constructor(private adminService: DriverAdminService = driverAdminService) {}

  private extractClientInfo(req: Request): AdminClientInfo {
    return {
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    };
  }

  // --------------------------------------------------------------------------
  // Admin Driver Review & Verification
  // --------------------------------------------------------------------------

  public getPendingDrivers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await this.adminService.getPendingDrivers({ page, limit });

      ApiResponse.success(res, result.items, 'Pending driver verifications retrieved successfully', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (err) {
      next(err);
    }
  };

  public getDriverDossier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driverId = req.params.id;
      const dossier = await this.adminService.getDriverDossier(driverId);
      ApiResponse.success(res, dossier, 'Driver dossier retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public verifyDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.user!.userId;
      const docId = req.params.docId;
      const clientInfo = this.extractClientInfo(req);

      const result = await this.adminService.verifyDriverDocument(docId, adminUserId, clientInfo);
      ApiResponse.success(res, result, 'Driver document verified successfully');
    } catch (err) {
      next(err);
    }
  };

  public rejectDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.user!.userId;
      const docId = req.params.docId;
      const { reason } = req.body;
      const clientInfo = this.extractClientInfo(req);

      const result = await this.adminService.rejectDriverDocument(
        docId,
        reason,
        adminUserId,
        clientInfo
      );
      ApiResponse.success(res, result, 'Driver document rejected successfully');
    } catch (err) {
      next(err);
    }
  };

  public getDocumentFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const docId = req.params.docId;
      const { buffer, mimeType } = await this.adminService.getDocumentFileForAdmin(docId);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="driver-doc-${docId}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  };

  public approveDriver = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.user!.userId;
      const driverId = req.params.id;
      const clientInfo = this.extractClientInfo(req);

      const result = await this.adminService.approveDriver(
        driverId,
        adminUserId,
        clientInfo,
        req.body
      );
      ApiResponse.success(res, result, 'Driver profile approved successfully');
    } catch (err) {
      next(err);
    }
  };

  public rejectDriver = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.user!.userId;
      const driverId = req.params.id;
      const { reason } = req.body;
      const clientInfo = this.extractClientInfo(req);

      const result = await this.adminService.rejectDriver(
        driverId,
        reason,
        adminUserId,
        clientInfo
      );
      ApiResponse.success(res, result, 'Driver profile rejected successfully');
    } catch (err) {
      next(err);
    }
  };

  public suspendDriver = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.user!.userId;
      const driverId = req.params.id;
      const { reason } = req.body;
      const clientInfo = this.extractClientInfo(req);

      const result = await this.adminService.suspendDriver(
        driverId,
        reason,
        adminUserId,
        clientInfo
      );
      ApiResponse.success(res, result, 'Driver profile suspended successfully');
    } catch (err) {
      next(err);
    }
  };

  public reactivateDriver = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.user!.userId;
      const driverId = req.params.id;
      const clientInfo = this.extractClientInfo(req);
      const callerRole = req.user!.activeRole;

      const result = await this.adminService.reactivateDriver(
        driverId,
        adminUserId,
        clientInfo,
        callerRole
      );
      ApiResponse.success(res, result, 'Driver profile reactivated successfully');
    } catch (err) {
      next(err);
    }
  };
}

export const driverAdminController = new DriverAdminController();
