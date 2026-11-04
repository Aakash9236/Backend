import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/db.config';
import { ApiResponse } from '../../common/utils/api-response.util';
import { BadRequestError, NotFoundError } from '../../common/errors';

const router = Router();

/**
 * @openapi
 * /api/v1/locations/cities:
 *   get:
 *     summary: List Active Operational Cities
 *     tags:
 *       - Locations
 *     responses:
 *       200:
 *         description: List of active cities.
 */
router.get('/cities', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cities = await prisma.city.findMany({
      where: { isActive: true },
      orderBy: { cityName: 'asc' },
    });
    ApiResponse.success(res, cities, 'Active cities retrieved');
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/locations/cities/{cityId}/areas:
 *   get:
 *     summary: List Active Areas for a Specific City
 *     tags:
 *       - Locations
 *     parameters:
 *       - in: path
 *         name: cityId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of areas within the city.
 */
router.get('/cities/:cityId/areas', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cityId = BigInt(req.params.cityId);
    const city = await prisma.city.findUnique({
      where: { id: cityId },
      include: {
        areas: {
          where: { isActive: true },
          orderBy: { areaName: 'asc' },
        },
      },
    });

    if (!city) {
      throw new NotFoundError('City not found.');
    }

    ApiResponse.success(res, city.areas, 'Areas retrieved successfully');
  } catch (err) {
    next(err);
  }
});

export const locationRoutes = router;

