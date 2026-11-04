import { Request, Response, NextFunction } from 'express';
import { customersService, CustomersService } from './customers.service';
import { ApiResponse } from '../../common/utils/api-response.util';

export class CustomersController {
  constructor(private service: CustomersService = customersService) {}

  public getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getProfile(req.user!.userId);
      ApiResponse.success(res, result, 'Customer profile retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public createProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.createOrUpdateProfile(req.user!.userId, req.body);
      ApiResponse.success(res, result, 'Customer profile saved successfully');
    } catch (err) {
      next(err);
    }
  };

  public updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.updateProfile(req.user!.userId, req.body);
      ApiResponse.success(res, result, 'Customer profile updated successfully');
    } catch (err) {
      next(err);
    }
  };
}

export const customersController = new CustomersController();

