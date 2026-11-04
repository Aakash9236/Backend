import { Request, Response, NextFunction } from 'express';
import { adminVehicleService, AdminVehicleService } from './services/admin-vehicle.service';
import { ApiResponse } from '../../common/utils/api-response.util';

export class AdminVehicleController {
  constructor(private service: AdminVehicleService = adminVehicleService) {}

  public getPendingVehicles = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const list = await this.service.getPendingVehicles();
      ApiResponse.success(res, list, 'Pending vehicles queue retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public getVehicleDossier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vehicleId = req.params.id;
      const dossier = await this.service.getVehicleDossier(vehicleId);
      ApiResponse.success(res, dossier, 'Vehicle dossier retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public verifyVehicleDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const docId = req.params.docId;
      const adminUserId = req.user!.userId;
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const updated = await this.service.verifyVehicleDocument(docId, adminUserId, clientInfo);
      ApiResponse.success(res, updated, 'Vehicle document verified successfully');
    } catch (err) {
      next(err);
    }
  };

  public rejectVehicleDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const docId = req.params.docId;
      const adminUserId = req.user!.userId;
      const { reason } = req.body;
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const updated = await this.service.rejectVehicleDocument(
        docId,
        reason,
        adminUserId,
        clientInfo
      );
      ApiResponse.success(res, updated, 'Vehicle document rejected successfully');
    } catch (err) {
      next(err);
    }
  };

  public getDocumentFileForAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const docId = req.params.docId;
      const { buffer, mimeType } = await this.service.getDocumentFileForAdmin(docId);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', 'attachment; filename="vehicle-document.pdf"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  };

  public approveVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vehicleId = req.params.id;
      const adminUserId = req.user!.userId;
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const updated = await this.service.approveVehicle(vehicleId, adminUserId, clientInfo);
      ApiResponse.success(res, updated, 'Vehicle approved and verified successfully');
    } catch (err) {
      next(err);
    }
  };

  public rejectVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vehicleId = req.params.id;
      const adminUserId = req.user!.userId;
      const { reason } = req.body;
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const updated = await this.service.rejectVehicle(vehicleId, reason, adminUserId, clientInfo);
      ApiResponse.success(res, updated, 'Vehicle rejected successfully');
    } catch (err) {
      next(err);
    }
  };

  public suspendVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vehicleId = req.params.id;
      const adminUserId = req.user!.userId;
      const { reason } = req.body;
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const updated = await this.service.suspendVehicle(vehicleId, reason, adminUserId, clientInfo);
      ApiResponse.success(res, updated, 'Vehicle suspended successfully');
    } catch (err) {
      next(err);
    }
  };

  public reactivateVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vehicleId = req.params.id;
      const adminUserId = req.user!.userId;
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const updated = await this.service.reactivateVehicle(vehicleId, adminUserId, clientInfo);
      ApiResponse.success(res, updated, 'Vehicle reactivated successfully');
    } catch (err) {
      next(err);
    }
  };

  public transferVehicleOwnership = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vehicleId = req.params.id;
      const superAdminUserId = req.user!.userId;
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const result = await this.service.transferVehicleOwnership(
        vehicleId,
        req.body,
        superAdminUserId,
        clientInfo
      );
      ApiResponse.success(res, result, result.message);
    } catch (err) {
      next(err);
    }
  };
}

export const adminVehicleController = new AdminVehicleController();
