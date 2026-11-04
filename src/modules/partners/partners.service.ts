import { partnersRepository, PartnersRepository } from './partners.repository';
import {
  PartnerOnboardingInput,
  UpdatePartnerProfileInput,
  AddPartnerSkillInput,
  AddPartnerServiceAreaInput,
  UploadDocumentInput,
} from './partners.types';
import { storageService, IStorageService } from '../../common/services/storage.service';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { logger } from '../../config/logger.config';

export class PartnersService {
  constructor(
    private repo: PartnersRepository = partnersRepository,
    private storage: IStorageService = storageService
  ) {}

  /**
   * Onboard as a new partner (adds PARTNER role, keeps existing CUSTOMER role)
   */
  public async onboard(userIdStr: string, input: PartnerOnboardingInput) {
    const userId = BigInt(userIdStr);
    const existing = await this.repo.findByUserId(userId);

    if (existing) {
      throw new BadRequestError(
        'A partner application already exists for this account.'
      );
    }

    logger.info(`[Partner Onboarding] Registering partner profile for user ${userIdStr}`);
    const profile = await this.repo.createPartnerProfileWithRole(userId, input);
    return this.serializePartnerProfile(profile);
  }

  /**
   * Retrieve partner profile with skills, service areas, and documents
   */
  public async getProfile(userIdStr: string) {
    const userId = BigInt(userIdStr);
    const profile = await this.repo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Partner profile not found. Please complete onboarding.');
    }

    return this.serializePartnerProfile(profile);
  }

  /**
   * Update partner profile
   */
  public async updateProfile(userIdStr: string, input: UpdatePartnerProfileInput) {
    const userId = BigInt(userIdStr);
    const existing = await this.repo.findByUserId(userId);

    if (!existing) {
      throw new NotFoundError('Partner profile not found.');
    }

    const updated = await this.repo.updatePartnerProfile(existing.id, input);
    return this.serializePartnerProfile(updated);
  }

  /**
   * Upload and register KYC document
   */
  public async uploadDocument(userIdStr: string, input: UploadDocumentInput) {
    const userId = BigInt(userIdStr);
    const partner = await this.repo.findByUserId(userId);

    if (!partner) {
      throw new NotFoundError('Partner profile not found. Please complete onboarding.');
    }

    let storageKey = input.documentStorageKey;

    if (input.fileBuffer && input.originalName && input.mimeType) {
      const uploadResult = await this.storage.uploadFile(
        input.fileBuffer,
        input.originalName,
        input.mimeType,
        'documents'
      );
      storageKey = uploadResult.storageKey;
    }

    if (!storageKey) {
      throw new BadRequestError('Either file or valid documentStorageKey is required.');
    }

    const doc = await this.repo.createDocument(partner.id, input.documentType, storageKey);
    return {
      id: doc.id.toString(),
      partnerId: doc.partnerId.toString(),
      documentType: doc.documentType,
      documentStorageKey: doc.documentStorageKey,
      verificationStatus: doc.verificationStatus,
      uploadedAt: doc.uploadedAt.toISOString(),
    };
  }

  /**
   * List partner documents
   */
  public async getDocuments(userIdStr: string) {
    const userId = BigInt(userIdStr);
    const partner = await this.repo.findByUserId(userId);

    if (!partner) {
      throw new NotFoundError('Partner profile not found.');
    }

    const docs = await this.repo.findDocumentsByPartnerId(partner.id);
    return docs.map((doc) => ({
      id: doc.id.toString(),
      partnerId: doc.partnerId.toString(),
      documentType: doc.documentType,
      documentStorageKey: doc.documentStorageKey,
      verificationStatus: doc.verificationStatus,
      rejectionReason: doc.rejectionReason,
      reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
      uploadedAt: doc.uploadedAt.toISOString(),
    }));
  }

  /**
   * Add a skill to partner profile
   */
  public async addSkill(userIdStr: string, input: AddPartnerSkillInput) {
    const userId = BigInt(userIdStr);
    const partner = await this.repo.findByUserId(userId);

    if (!partner) {
      throw new NotFoundError('Partner profile not found.');
    }

    const categoryId = BigInt(input.serviceCategoryId);
    const category = await this.repo.findCategoryById(categoryId);

    if (!category) {
      throw new BadRequestError('Invalid or inactive service category.');
    }

    const existingSkill = await this.repo.findSkill(partner.id, categoryId);
    if (existingSkill) {
      throw new BadRequestError('This skill has already been added to your profile.');
    }

    const skill = await this.repo.createSkill(
      partner.id,
      categoryId,
      input.experienceYears || 0
    );

    return {
      id: skill.id.toString(),
      partnerId: skill.partnerId.toString(),
      serviceCategoryId: skill.serviceCategoryId.toString(),
      categoryName: (skill as any).category ? (skill as any).category.categoryName : undefined,
      experienceYears: skill.experienceYears,
      verificationStatus: skill.verificationStatus,
      isActive: skill.isActive,
      createdAt: skill.createdAt.toISOString(),
    };
  }

  /**
   * List partner skills
   */
  public async getSkills(userIdStr: string) {
    const userId = BigInt(userIdStr);
    const partner = await this.repo.findByUserId(userId);

    if (!partner) {
      throw new NotFoundError('Partner profile not found.');
    }

    const skills = await this.repo.findSkillsByPartnerId(partner.id);
    return skills.map((skill) => ({
      id: skill.id.toString(),
      partnerId: skill.partnerId.toString(),
      serviceCategoryId: skill.serviceCategoryId.toString(),
      categoryName: skill.category.categoryName,
      categoryCode: skill.category.categoryCode,
      experienceYears: skill.experienceYears,
      verificationStatus: skill.verificationStatus,
      isActive: skill.isActive,
      createdAt: skill.createdAt.toISOString(),
    }));
  }

  /**
   * Add service area
   */
  public async addServiceArea(userIdStr: string, input: AddPartnerServiceAreaInput) {
    const userId = BigInt(userIdStr);
    const partner = await this.repo.findByUserId(userId);

    if (!partner) {
      throw new NotFoundError('Partner profile not found.');
    }

    const cityId = BigInt(input.cityId);
    const city = await this.repo.findCityById(cityId);
    if (!city) {
      throw new BadRequestError('Invalid or inactive city.');
    }

    const coverageType = input.coverageType || (input.areaId ? 'AREA' : 'CITY');
    if (coverageType === 'AREA' && !input.areaId) {
      throw new BadRequestError('areaId is required when coverageType is AREA.');
    }
    if (coverageType === 'CITY' && input.areaId) {
      throw new BadRequestError('areaId must be null when coverageType is CITY.');
    }

    if (input.areaId) {
      const areaId = BigInt(input.areaId);
      const area = await this.repo.findAreaByIdAndCity(areaId, cityId);
      if (!area) {
        throw new BadRequestError('Specified area does not exist within the city.');
      }
    }

    const sa = await this.repo.createServiceArea(partner.id, {
      ...input,
      coverageType,
      areaId: coverageType === 'CITY' ? null : input.areaId,
    });
    return {
      id: sa.id.toString(),
      partnerId: sa.partnerId.toString(),
      cityId: sa.cityId.toString(),
      cityName: (sa as any).city ? (sa as any).city.cityName : undefined,
      areaId: sa.areaId ? sa.areaId.toString() : null,
      areaName: (sa as any).area ? (sa as any).area.areaName : undefined,
      coverageType: sa.coverageType,
      serviceRadiusKm: sa.serviceRadiusKm ? Number(sa.serviceRadiusKm) : null,
      isActive: sa.isActive,
      createdAt: sa.createdAt.toISOString(),
    };
  }

  /**
   * List partner service areas
   */
  public async getServiceAreas(userIdStr: string) {
    const userId = BigInt(userIdStr);
    const partner = await this.repo.findByUserId(userId);

    if (!partner) {
      throw new NotFoundError('Partner profile not found.');
    }

    const areas = await this.repo.findServiceAreasByPartnerId(partner.id);
    return areas.map((sa) => ({
      id: sa.id.toString(),
      partnerId: sa.partnerId.toString(),
      cityId: sa.cityId.toString(),
      cityName: sa.city.cityName,
      areaId: sa.areaId ? sa.areaId.toString() : null,
      areaName: sa.area ? sa.area.areaName : null,
      coverageType: sa.coverageType,
      serviceRadiusKm: sa.serviceRadiusKm ? Number(sa.serviceRadiusKm) : null,
      isActive: sa.isActive,
      createdAt: sa.createdAt.toISOString(),
    }));
  }

  private serializePartnerProfile(p: any) {
    return {
      id: p.id.toString(),
      userId: p.userId.toString(),
      profileType: p.profileType,
      legalName: p.legalName,
      businessName: p.businessName,
      businessDescription: p.businessDescription,
      experienceYears: p.experienceYears,
      approvalStatus: p.approvalStatus,
      rejectionReason: p.rejectionReason,
      reviewedBy: p.reviewedBy ? p.reviewedBy.toString() : null,
      reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
      documentsCount: p.documents ? p.documents.length : 0,
      skillsCount: p.skills ? p.skills.length : 0,
      serviceAreasCount: p.serviceAreas ? p.serviceAreas.length : 0,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}

export const partnersService = new PartnersService();
