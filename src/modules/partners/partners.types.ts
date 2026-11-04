export interface PartnerOnboardingInput {
  profileType?: 'INDIVIDUAL' | 'BUSINESS';
  legalName: string;
  businessName?: string | null;
  businessDescription?: string | null;
  experienceYears?: number;
}

export interface UpdatePartnerProfileInput {
  legalName?: string;
  businessName?: string | null;
  businessDescription?: string | null;
  experienceYears?: number;
}

export interface AddPartnerSkillInput {
  serviceCategoryId: string | number;
  experienceYears?: number;
}

export interface AddPartnerServiceAreaInput {
  cityId: string | number;
  areaId?: string | number | null;
  coverageType?: 'CITY' | 'AREA';
  serviceRadiusKm?: number | null;
}

export interface UploadDocumentInput {
  documentType: string;
  fileBuffer?: Buffer;
  originalName?: string;
  mimeType?: string;
  documentStorageKey?: string; // If already uploaded or mocked
}
