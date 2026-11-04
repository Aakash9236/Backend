import { Response } from 'express';

export interface ApiResponsePayload<T = any> {
  success: boolean;
  message: string;
  data?: T;
  meta?: Record<string, any>;
  timestamp: string;
}

export class ApiResponse {
  public static success<T>(
    res: Response,
    data?: T,
    message = 'Operation successful',
    statusCode = 200,
    meta?: Record<string, any>
  ): Response {
    const payload: ApiResponsePayload<T> = {
      success: true,
      message,
      data,
      meta,
      timestamp: new Date().toISOString(),
    };
    return res.status(statusCode).json(payload);
  }

  public static created<T>(
    res: Response,
    data?: T,
    message = 'Resource created successfully',
    meta?: Record<string, any>
  ): Response {
    return this.success(res, data, message, 201, meta);
  }

  public static error(
    res: Response,
    message = 'Internal server error',
    statusCode = 500,
    errors?: any
  ): Response {
    const payload: ApiResponsePayload = {
      success: false,
      message,
      data: errors,
      timestamp: new Date().toISOString(),
    };
    return res.status(statusCode).json(payload);
  }
}

