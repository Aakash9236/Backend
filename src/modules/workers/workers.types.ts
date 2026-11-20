import {
  WorkerProfile,
  WorkerDocument,
  WorkerSkill,
  WorkerInvitation,
  WorkerPartnerAffiliation,
  WorkerAvailability,
  Prisma,
} from '@prisma/client';

export type DbClient = Prisma.TransactionClient | typeof import('../../config/db.config').prisma;

export interface PaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// -------------------------------------------------------------------------
// 1. Worker Profile Types
// -------------------------------------------------------------------------
export interface CreateWorkerProfileData {
  userId: bigint;
  firstName: string;
  lastName?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  profileImageUrl?: string | null;
  bio?: string | null;
  workerType?: string;
  experienceYears?: number;
  primaryCityId?: bigint | null;
  approvalStatus?: string;
  submissionStatus?: string;
}

export interface UpdateWorkerProfileData {
  firstName?: string;
  lastName?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  profileImageUrl?: string | null;
  bio?: string | null;
  workerType?: string;
  experienceYears?: number;
  primaryCityId?: bigint | null;
  isActive?: boolean;
}

export interface WorkerProfileFilter {
  approvalStatus?: string;
  submissionStatus?: string;
  workerType?: string;
  primaryCityId?: bigint;
  isActive?: boolean;
  search?: string;
}

// -------------------------------------------------------------------------
// 2. Worker Document Types
// -------------------------------------------------------------------------
export interface CreateWorkerDocumentData {
  workerId: bigint;
  documentType: string;
  documentStorageKey: string;
  originalName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: bigint | null;
  expiryDate?: Date | null;
  verificationStatus?: string;
  rejectionReason?: string | null;
  documentMetadata?: Prisma.InputJsonValue | null;
  reviewedBy?: bigint | null;
  reviewedAt?: Date | null;
}

export interface UpdateWorkerDocumentVerificationData {
  verificationStatus: string;
  reviewedBy?: bigint | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
}

// -------------------------------------------------------------------------
// 3. Worker Skill Types
// -------------------------------------------------------------------------
export interface CreateWorkerSkillData {
  workerId: bigint;
  serviceCategoryId: bigint;
  experienceYears?: number;
  verificationStatus?: string;
  rejectionReason?: string | null;
  isActive?: boolean;
}

export interface UpdateWorkerSkillVerificationData {
  verificationStatus: string;
  reviewedBy?: bigint | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
}

// -------------------------------------------------------------------------
// 4. Worker Invitation Types
// -------------------------------------------------------------------------
export interface CreateWorkerInvitationData {
  partnerId: bigint;
  invitingUserId?: bigint | null;
  invitedMobile: string;
  workerName?: string | null;
  workerUserId?: bigint | null;
  invitationStatus?: string;
  invitationTokenHash: string;
  proposedRole?: string | null;
  notes?: string | null;
  expiresAt: Date;
}

export interface UpdateWorkerInvitationStatusMetadata {
  respondedAt?: Date | null;
  rejectionReason?: string | null;
  revokedAt?: Date | null;
  revokedBy?: bigint | null;
  workerUserId?: bigint | null;
}

// -------------------------------------------------------------------------
// 5. Worker Partner Affiliation Types
// -------------------------------------------------------------------------
export interface CreateWorkerAffiliationData {
  workerId: bigint;
  partnerId: bigint;
  invitationId?: bigint | null;
  affiliationStatus?: string;
  consentGivenAt?: Date;
  affiliatedAt?: Date;
}

export interface TerminateWorkerAffiliationData {
  terminationReason?: string | null;
  terminatedAt?: Date | null;
}

// -------------------------------------------------------------------------
// 6. Worker Availability Types
// -------------------------------------------------------------------------
export interface UpsertWorkerAvailabilityData {
  isOnline?: boolean;
  isBusy?: boolean;
  currentLatitude?: number | Prisma.Decimal | null;
  currentLongitude?: number | Prisma.Decimal | null;
  lastHeartbeatAt?: Date;
}

// -------------------------------------------------------------------------
// 7. Worker Service & DTO Types
// -------------------------------------------------------------------------
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface UploadWorkerDocumentInput {
  documentType: string;
  expiryDate?: Date | string | null;
  documentMetadata?: Record<string, any>;
}

export interface UpdateWorkerProfileInput {
  firstName?: string;
  lastName?: string | null;
  dateOfBirth?: Date | string | null;
  gender?: string | null;
  profileImageUrl?: string | null;
  bio?: string | null;
  workerType?: string;
  experienceYears?: number;
  primaryCityId?: bigint | string | null;
}

export interface AddWorkerSkillInput {
  serviceCategoryId: bigint | string;
  experienceYears?: number;
}

export interface WorkerDocumentResponse {
  id: string;
  workerId: string;
  documentType: string;
  originalName: string | null;
  mimeType: string | null;
  fileSizeBytes: string | null;
  verificationStatus: string;
  rejectionReason: string | null;
  expiryDate: string | null;
  uploadedAt: string;
  isLatest?: boolean;
  isExpired?: boolean;
  isExpiringSoon?: boolean;
  daysRemaining?: number;
  hasFile: boolean;
}

export interface WorkerSkillResponse {
  id: string;
  workerId: string;
  serviceCategoryId: string;
  categoryName?: string;
  categoryCode?: string;
  experienceYears: number;
  verificationStatus: string;
  rejectionReason: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerProfileResponse {
  id: string;
  userId: string;
  firstName: string;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  profileImageUrl: string | null;
  bio: string | null;
  workerType: string;
  experienceYears: number;
  primaryCityId: string | null;
  primaryCityName?: string | null;
  submissionStatus: string;
  approvalStatus: string;
  isSuspended: boolean;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  roles?: string[];
  skills?: WorkerSkillResponse[];
  documents?: WorkerDocumentResponse[];
  kycCompliance?: any;
}

export interface WorkerOnboardingStatusResponse {
  id: string;
  submissionStatus: string;
  approvalStatus: string;
  rejectionReason: string | null;
  isSuspended: boolean;
  submittedAt: string | null;
  isOperational: boolean;
}

// -------------------------------------------------------------------------
// 8. Worker Invitation & Affiliation DTO Types
// -------------------------------------------------------------------------
export interface CreateWorkerInvitationInput {
  invitedMobile: string;
  workerName?: string | null;
  proposedRole?: string | null;
  notes?: string | null;
}

export interface WorkerInvitationResponse {
  id: string;
  partnerId: string;
  partnerName?: string;
  invitedMobile: string;
  workerName: string | null;
  workerUserId: string | null;
  proposedRole: string | null;
  invitationStatus: string;
  notes: string | null;
  resendCount: number;
  expiresAt: string;
  respondedAt: string | null;
  rejectionReason: string | null;
  revokedAt: string | null;
  createdAt: string;
  isExpired: boolean;
}

export interface WorkerInvitationPublicDetails {
  id: string;
  partnerId: string;
  partnerBusinessName?: string;
  invitedMobile: string;
  workerName: string | null;
  proposedRole: string | null;
  invitationStatus: string;
  notes: string | null;
  expiresAt: string;
  isExpired: boolean;
}

export interface WorkerInvitationAcceptResponse {
  invitation: WorkerInvitationResponse;
  affiliationId: string;
  workerProfileId: string;
  message: string;
}

export interface WorkerAffiliationResponse {
  id: string;
  workerId: string;
  workerName?: string;
  workerMobile?: string;
  partnerId: string;
  partnerBusinessName?: string;
  partnerMobile?: string;
  invitationId: string | null;
  affiliationStatus: string;
  consentGivenAt: string;
  affiliatedAt: string;
  terminatedAt: string | null;
  terminationReason: string | null;
}

// -------------------------------------------------------------------------
// 9. Worker Availability & Dispatch Lock DTO Types
// -------------------------------------------------------------------------
export interface WorkerAvailabilityResponse {
  workerId: string;
  isOnline: boolean;
  isBusy: boolean;
  currentLatitude: number | null;
  currentLongitude: number | null;
  lastHeartbeatAt: string;
  isStale: boolean;
}

export interface DispatchLockContext {
  lockId?: string;
  dispatchJobId?: string;
  requesterId?: string;
  ttlSeconds?: number;
}

export interface DispatchLockResponse {
  acquired: boolean;
  lockId?: string;
  workerId: string;
  expiresAt?: string;
  reason?: string;
}


