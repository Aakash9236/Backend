import { prisma } from '../../config/db.config';
import {
  PartnerProfile,
  PartnerDocument,
  PartnerSkill,
  PartnerServiceArea,
} from '@prisma/client';
import {
  PartnerOnboardingInput,
  UpdatePartnerProfileInput,
  AddPartnerServiceAreaInput,
} from './partners.types';

export class PartnersRepository {
  /**
   * Find partner profile by User ID
   */
  public async findByUserId(userId: bigint) {
    return prisma.partnerProfile.findUnique({
      where: { userId },
      include: {
        documents: true,
        skills: {
          include: { category: true },
        },
        serviceAreas: {
          include: { city: true, area: true },
        },
      },
    });
  }

  /**
   * Find partner profile by Partner ID
   */
  public async findPartnerById(partnerId: bigint) {
    return prisma.partnerProfile.findUnique({
      where: { id: partnerId },
      include: {
        user: true,
        documents: true,
        skills: {
          include: { category: true },
        },
        serviceAreas: {
          include: { city: true, area: true },
        },
      },
    });
  }

  /**
   * Onboard partner: assigns PARTNER role and creates partner profile in single transaction
   */
  public async createPartnerProfileWithRole(
    userId: bigint,
    data: PartnerOnboardingInput
  ): Promise<PartnerProfile> {
    return prisma.$transaction(async (tx) => {
      // 1. Fetch PARTNER role
      const partnerRole = await tx.role.findUnique({
        where: { roleName: 'PARTNER' },
      });

      if (!partnerRole) {
        throw new Error('PARTNER role is not configured in the database.');
      }

      // 2. Assign PARTNER role to user (if not already assigned)
      const existingUserRole = await tx.userRole.findFirst({
        where: {
          userId,
          roleId: partnerRole.id,
        },
      });

      if (!existingUserRole) {
        await tx.userRole.create({
          data: {
            userId,
            roleId: partnerRole.id,
          },
        });
      }

      // 3. Create partner profile
      return tx.partnerProfile.create({
        data: {
          userId,
          profileType: data.profileType || 'INDIVIDUAL',
          legalName: data.legalName,
          businessName: data.businessName || null,
          businessDescription: data.businessDescription || null,
          experienceYears: data.experienceYears || 0,
          approvalStatus: 'PENDING',
        },
        include: {
          documents: true,
          skills: true,
          serviceAreas: true,
        },
      });
    });
  }

  /**
   * Update partner details
   */
  public async updatePartnerProfile(
    partnerId: bigint,
    data: UpdatePartnerProfileInput
  ): Promise<PartnerProfile> {
    return prisma.partnerProfile.update({
      where: { id: partnerId },
      data: {
        ...(data.legalName !== undefined ? { legalName: data.legalName } : {}),
        ...(data.businessName !== undefined ? { businessName: data.businessName } : {}),
        ...(data.businessDescription !== undefined
          ? { businessDescription: data.businessDescription }
          : {}),
        ...(data.experienceYears !== undefined
          ? { experienceYears: data.experienceYears }
          : {}),
        updatedAt: new Date(),
      },
      include: {
        documents: true,
        skills: true,
        serviceAreas: true,
      },
    });
  }

  /**
   * Check if category exists and is active
   */
  public async findCategoryById(categoryId: bigint) {
    return prisma.serviceCategory.findFirst({
      where: { id: categoryId, isActive: true },
    });
  }

  /**
   * Check if city exists and is active
   */
  public async findCityById(cityId: bigint) {
    return prisma.city.findFirst({
      where: { id: cityId, isActive: true },
    });
  }

  /**
   * Check if area exists and belongs to city
   */
  public async findAreaByIdAndCity(areaId: bigint, cityId: bigint) {
    return prisma.area.findFirst({
      where: { id: areaId, cityId, isActive: true },
    });
  }

  /**
   * Create document record
   */
  public async createDocument(
    partnerId: bigint,
    documentType: string,
    storageKey: string
  ): Promise<PartnerDocument> {
    return prisma.partnerDocument.create({
      data: {
        partnerId,
        documentType,
        documentStorageKey: storageKey,
        verificationStatus: 'PENDING',
      },
    });
  }

  /**
   * List documents for partner
   */
  public async findDocumentsByPartnerId(partnerId: bigint): Promise<PartnerDocument[]> {
    return prisma.partnerDocument.findMany({
      where: { partnerId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /**
   * Find specific skill by category for partner
   */
  public async findSkill(partnerId: bigint, serviceCategoryId: bigint) {
    return prisma.partnerSkill.findUnique({
      where: {
        partnerId_serviceCategoryId: {
          partnerId,
          serviceCategoryId,
        },
      },
    });
  }

  /**
   * Add a skill to partner profile
   */
  public async createSkill(
    partnerId: bigint,
    serviceCategoryId: bigint,
    experienceYears = 0
  ): Promise<PartnerSkill> {
    return prisma.partnerSkill.create({
      data: {
        partnerId,
        serviceCategoryId,
        experienceYears,
        verificationStatus: 'PENDING',
        isActive: true,
      },
      include: {
        category: true,
      },
    });
  }

  /**
   * List skills for partner
   */
  public async findSkillsByPartnerId(partnerId: bigint) {
    return prisma.partnerSkill.findMany({
      where: { partnerId },
      include: { category: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Add service area to partner profile
   */
  public async createServiceArea(
    partnerId: bigint,
    data: AddPartnerServiceAreaInput
  ) {
    return prisma.partnerServiceArea.create({
      data: {
        partnerId,
        cityId: BigInt(data.cityId),
        areaId: data.areaId ? BigInt(data.areaId) : null,
        coverageType: data.coverageType || 'CITY_WIDE',
        serviceRadiusKm: data.serviceRadiusKm ?? null,
        isActive: true,
      },
      include: {
        city: true,
        area: true,
      },
    });
  }

  /**
   * List service areas for partner
   */
  public async findServiceAreasByPartnerId(partnerId: bigint) {
    return prisma.partnerServiceArea.findMany({
      where: { partnerId, isActive: true },
      include: { city: true, area: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}

export const partnersRepository = new PartnersRepository();
