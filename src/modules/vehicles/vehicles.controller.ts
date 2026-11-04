import { Request, Response, NextFunction } from 'express';
import { vehicleService, VehicleService } from './vehicles.service';
import { ApiResponse } from '../../common/utils/api-response.util';
import { BadRequestError } from '../../common/errors';

export class VehicleController {
  constructor(private service: VehicleService = vehicleService) {}

  public getVehicleTypes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const categoryId = req.query.serviceCategoryId as string | undefined;
      const types = await this.service.getVehicleTypes(categoryId);
      ApiResponse.success(res, types, 'Vehicle types retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public registerVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const vehicle = await this.service.registerVehicle(userId, req.body, clientInfo);
      ApiResponse.created(res, vehicle, 'Vehicle registered into fleet successfully');
    } catch (err) {
      next(err);
    }
  };

  public getPartnerVehicles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const vehicles = await this.service.getPartnerVehicles(userId);
      ApiResponse.success(
        res,
        vehicles,
        'Partner fleet retrieved successfully',
        200,
        { totalVehicles: vehicles.length }
      );
    } catch (err) {
      next(err);
    }
  };

  public getPartnerVehicleById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const vehicleId = req.params.id;
      const vehicle = await this.service.getPartnerVehicleById(userId, vehicleId);
      ApiResponse.success(res, vehicle, 'Vehicle retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public updateVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const vehicleId = req.params.id;
      const updated = await this.service.updateVehicle(userId, vehicleId, req.body);
      ApiResponse.success(res, updated, 'Vehicle updated successfully');
    } catch (err) {
      next(err);
    }
  };

  public setPrimaryVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const vehicleId = req.params.id;
      const result = await this.service.setPrimaryVehicle(userId, vehicleId);
      ApiResponse.success(res, result.vehicle, result.message);
    } catch (err) {
      next(err);
    }
  };

  public setVehicleActiveStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const vehicleId = req.params.id;
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        throw new BadRequestError('Field isActive (boolean) is required.');
      }

      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      };

      const updated = await this.service.setVehicleActiveStatus(
        userId,
        vehicleId,
        isActive,
        clientInfo
      );
      ApiResponse.success(
        res,
        updated,
        `Vehicle marked as ${isActive ? 'active' : 'inactive'} successfully`
      );
    } catch (err) {
      next(err);
    }
  };

  public uploadDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const vehicleId = req.params.id;
      const file = req.file;

      const doc = await this.service.uploadDocument(
        userId,
        vehicleId,
        {
          documentType: req.body.documentType,
          expiryDate: req.body.expiryDate,
          documentStorageKey: req.body.documentStorageKey,
        },
        file
      );

      ApiResponse.created(res, doc, 'Vehicle document uploaded successfully');
    } catch (err) {
      next(err);
    }
  };

  public getVehicleDocuments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const vehicleId = req.params.id;
      const docs = await this.service.getVehicleDocuments(userId, vehicleId);
      ApiResponse.success(res, docs, 'Vehicle documents retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public getDocumentFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const vehicleId = req.params.id;
      const docId = req.params.docId;

      const { buffer, mimeType, doc } = await this.service.getDocumentFile(
        userId,
        vehicleId,
        docId
      );

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${doc.documentType.toLowerCase()}.pdf"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  };
}

export const vehicleController = new VehicleController();
