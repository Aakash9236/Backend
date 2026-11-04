import { Request, Response, NextFunction } from 'express';
import { usersService, UsersService } from './users.service';
import { ApiResponse } from '../../common/utils/api-response.util';

export class UsersController {
  constructor(private service: UsersService = usersService) {}

  public getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getMe(req.user!.userId, req.user?.activeRole);
      ApiResponse.success(res, result, 'User details retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.updateMe(req.user!.userId, req.body);
      ApiResponse.success(res, result, 'User updated successfully');
    } catch (err) {
      next(err);
    }
  };

  public getMyRoles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getMyRoles(req.user!.userId, req.user?.activeRole);
      ApiResponse.success(res, result, 'User roles retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public deactivateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.deactivateMe(req.user!.userId);
      ApiResponse.success(res, result, 'Account deactivated successfully');
    } catch (err) {
      next(err);
    }
  };

  public createAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.createAddress(req.user!.userId, req.body);
      ApiResponse.created(res, result, 'Address created successfully');
    } catch (err) {
      next(err);
    }
  };

  public getAddresses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getAddresses(req.user!.userId);
      ApiResponse.success(res, result, 'Addresses retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public getAddressById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getAddressById(req.user!.userId, req.params.id);
      ApiResponse.success(res, result, 'Address retrieved successfully');
    } catch (err) {
      next(err);
    }
  };

  public updateAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.updateAddress(
        req.user!.userId,
        req.params.id,
        req.body
      );
      ApiResponse.success(res, result, 'Address updated successfully');
    } catch (err) {
      next(err);
    }
  };

  public deleteAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.deleteAddress(req.user!.userId, req.params.id);
      ApiResponse.success(res, result, 'Address deleted successfully');
    } catch (err) {
      next(err);
    }
  };

  public setDefaultAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.setDefaultAddress(req.user!.userId, req.params.id);
      ApiResponse.success(res, result, 'Default address set successfully');
    } catch (err) {
      next(err);
    }
  };
}

export const usersController = new UsersController();

