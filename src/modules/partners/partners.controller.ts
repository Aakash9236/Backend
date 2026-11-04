import { Request, Response, NextFunction } from 'express';
import { partnersService, PartnersService } from './partners.service';
import { ApiResponse } from '../../common/utils/api-response.util';

export class PartnersController {
  constructor(private service: PartnersService = partnersService) {}

  public onboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.onboard(req.user!.userId, req.body);
      ApiResponse.created(res, result, 'Partner onboarding application submitted successfully');
    } catch (err) {
      next(err);
    }
  };

  public getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getProfile(req.user!.userId);
      ApiResponse.success(res, result, 'Partner profile retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.updateProfile(req.user!.userId, req.body);
      ApiResponse.success(res, result, 'Partner profile updated successfully');
    } catch (err) {
      next(err);
    }
  };

  public uploadDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const file = req.file;
      const documentType = req.body.documentType;
      const documentStorageKey = req.body.documentStorageKey;

      const result = await this.service.uploadDocument(req.user!.userId, {
        documentType,
        fileBuffer: file ? file.buffer : undefined,
        originalName: file ? file.originalname : undefined,
        mimeType: file ? file.mimetype : undefined,
        documentStorageKey,
      });

      ApiResponse.created(res, result, 'KYC document uploaded successfully');
    } catch (err) {
      next(err);
    }
  };

  public getDocuments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getDocuments(req.user!.userId);
      ApiResponse.success(res, result, 'Documents retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public addSkill = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.addSkill(req.user!.userId, req.body);
      ApiResponse.created(res, result, 'Skill added successfully');
    } catch (err) {
      next(err);
    }
  };

  public getSkills = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSkills(req.user!.userId);
      ApiResponse.success(res, result, 'Skills retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public addServiceArea = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.addServiceArea(req.user!.userId, req.body);
      ApiResponse.created(res, result, 'Service area added successfully');
    } catch (err) {
      next(err);
    }
  };

  public getServiceAreas = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getServiceAreas(req.user!.userId);
      ApiResponse.success(res, result, 'Service areas retrieved successfully');
    } catch (err) {
      next(err);
    }
  };
}

export const partnersController = new PartnersController();

