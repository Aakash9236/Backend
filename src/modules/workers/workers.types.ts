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
