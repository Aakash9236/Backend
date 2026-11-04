import { Request, Response, NextFunction } from 'express';
import { adminService, AdminService } from './admin.service';
import { ApiResponse } from '../../common/utils/api-response.util';

export class AdminController {
  constructor(private service: AdminService = adminService) {}

  private getAuditContext(req: Request) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0] : req.socket.remoteAddress) || undefined;
    const userAgent = req.headers['user-agent'];
    return { ipAddress: ip ? ip.trim() : undefined, userAgent };
  }

  public getPendingPartners = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getPendingPartners();
      ApiResponse.success(res, result, 'Pending partner applications retrieved');
    } catch (err) {
      next(err);
    }
  };

  public getPartnerById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getPartnerById(req.params.id);
      ApiResponse.success(res, result, 'Partner details retrieved');
    } catch (err) {
      next(err);
    }
  };

  public approvePartner = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.approvePartner(
        req.user!.userId,
        req.params.id,
        this.getAuditContext(req)
      );
      ApiResponse.success(res, result, 'Partner application approved successfully');
    } catch (err) {
      next(err);
    }
  };

  public rejectPartner = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { reason } = req.body;
      const result = await this.service.rejectPartner(
        req.user!.userId,
        req.params.id,
        reason,
        this.getAuditContext(req)
      );
      ApiResponse.success(res, result, 'Partner application rejected');
    } catch (err) {
      next(err);
    }
  };

  public suspendPartner = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { reason } = req.body;
      const result = await this.service.suspendPartner(
        req.user!.userId,
        req.params.id,
        reason,
        this.getAuditContext(req)
      );
      ApiResponse.success(res, result, 'Partner suspended');
    } catch (err) {
      next(err);
    }
  };

  public verifyDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.verifyDocument(
        req.user!.userId,
        req.params.id,
        this.getAuditContext(req)
      );
      ApiResponse.success(res, result, 'Partner document verified');
    } catch (err) {
      next(err);
    }
  };

  public rejectDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { reason } = req.body;
      const result = await this.service.rejectDocument(
        req.user!.userId,
        req.params.id,
        reason,
        this.getAuditContext(req)
      );
      ApiResponse.success(res, result, 'Partner document rejected');
    } catch (err) {
      next(err);
    }
  };

  /**
   * Issue E: Stream KYC document file securely for admin visual inspection
   */
  public getDocumentFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const fileData = await this.service.getDocumentFile(
        req.user!.userId,
        req.params.id
      );

      res.setHeader('Content-Type', fileData.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${fileData.filename}"`);
      res.setHeader('Content-Length', fileData.sizeBytes);
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      res.end(fileData.buffer);
    } catch (err) {
      next(err);
    }
  };

  public verifySkill = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.verifySkill(
        req.user!.userId,
        req.params.id,
        this.getAuditContext(req)
      );
      ApiResponse.success(res, result, 'Partner skill verified');
    } catch (err) {
      next(err);
    }
  };

  public rejectSkill = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.rejectSkill(
        req.user!.userId,
        req.params.id,
        this.getAuditContext(req)
      );
      ApiResponse.success(res, result, 'Partner skill rejected');
    } catch (err) {
      next(err);
    }
  };

  /**
   * Phase 6B: Assign Role to User (Super Admin Only)
   * POST /api/v1/admin/users/:id/roles
   */
  public assignUserRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { role } = req.body;
      const result = await this.service.assignUserRole(
        req.user!.userId,
        req.params.id,
        role,
        this.getAuditContext(req)
      );
      ApiResponse.success(res, result, result.message, 200);
    } catch (err) {
      next(err);
    }
  };

  /**
   * Phase 6B: Revoke Role from User (Super Admin Only)
   * DELETE /api/v1/admin/users/:id/roles/:roleName
   */
  public revokeUserRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.revokeUserRole(
        req.user!.userId,
        req.params.id,
        req.params.roleName,
        this.getAuditContext(req)
      );
      ApiResponse.success(res, result, result.message, 200);
    } catch (err) {
      next(err);
    }
  };
}

export const adminController = new AdminController();
