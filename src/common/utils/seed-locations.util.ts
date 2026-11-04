import { prisma } from '../../config/db.config';
import { logger } from '../../config/logger.config';

export async function ensureSeedLocations(): Promise<void> {
  try {
    const cityCount = await prisma.city.count();
    if (cityCount > 0) return;

    logger.info('[Seed] Seeding initial operational cities and areas...');

    const mumbai = await prisma.city.create({
      data: {
        countryCode: 'IN',
        stateName: 'Maharashtra',
        cityName: 'Mumbai',
        citySlug: 'mumbai',
        isActive: true,
        areas: {
          create: [
            {
              areaName: 'Andheri West',
              postalCode: '400058',
              latitude: 19.1363,
              longitude: 72.8277,
              isActive: true,
            },
            {
              areaName: 'Bandra West',
              postalCode: '400050',
              latitude: 19.0596,
              longitude: 72.8295,
              isActive: true,
            },
            {
              areaName: 'Powai',
              postalCode: '400076',
              latitude: 19.1176,
              longitude: 72.9060,
              isActive: true,
            },
          ],
        },
      },
    });

    const bengaluru = await prisma.city.create({
      data: {
        countryCode: 'IN',
        stateName: 'Karnataka',
        cityName: 'Bengaluru',
        citySlug: 'bengaluru',
        isActive: true,
        areas: {
          create: [
            {
              areaName: 'Koramangala',
              postalCode: '560034',
              latitude: 12.9352,
              longitude: 77.6245,
              isActive: true,
            },
            {
              areaName: 'Indiranagar',
              postalCode: '560038',
              latitude: 12.9784,
              longitude: 77.6408,
              isActive: true,
            },
            {
              areaName: 'Whitefield',
              postalCode: '560066',
              latitude: 12.9698,
              longitude: 77.7500,
              isActive: true,
            },
          ],
        },
      },
    });

    const delhi = await prisma.city.create({
      data: {
        countryCode: 'IN',
        stateName: 'Delhi',
        cityName: 'New Delhi',
        citySlug: 'new-delhi',
        isActive: true,
        areas: {
          create: [
            {
              areaName: 'Connaught Place',
              postalCode: '110001',
              latitude: 28.6315,
              longitude: 77.2167,
              isActive: true,
            },
            {
              areaName: 'Hauz Khas',
              postalCode: '110016',
              latitude: 28.5494,
              longitude: 77.2001,
              isActive: true,
            },
          ],
        },
      },
    });

    logger.info(
      `[Seed] Successfully seeded cities: Mumbai (${mumbai.id}), Bengaluru (${bengaluru.id}), New Delhi (${delhi.id})`
    );
  } catch (error) {
    logger.warn('[Seed] Location seed notice:', error);
  }
}

