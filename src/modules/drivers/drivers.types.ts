import {
  DriverProfile,
  DriverDocument,
  DriverInvitation,
  DriverPartnerAffiliation,
  DriverVehicleAssignment,
  DriverAvailability,
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
// 1. Driver Profile Types
// -------------------------------------------------------------------------
export interface CreateDriverProfileData {
  userId: bigint;
  firstName: string;
  lastName?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  profileImageUrl?: string | null;
  bio?: string | null;
  experienceYears?: number;
  licenceNumber?: string | null;
  licenceClasses?: string[];
  licenceExpiryDate?: Date | null;
  issuingAuthority?: string | null;
  approvalStatus?: string;
  submissionStatus?: string;
}

export interface UpdateDriverProfileData {
  firstName?: string;
  lastName?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  profileImageUrl?: string | null;
  bio?: string | null;
  experienceYears?: number;
  licenceNumber?: string | null;
  licenceClasses?: string[];
  licenceExpiryDate?: Date | null;
  issuingAuthority?: string | null;
  isActive?: boolean;
}

export interface DriverProfileFilter {
  approvalStatus?: string;
  submissionStatus?: string;
  isActive?: boolean;
  licenceNumber?: string;
  search?: string;
}

// -------------------------------------------------------------------------
// 2. Driver Document Types
// -------------------------------------------------------------------------
export interface CreateDriverDocumentData {
  driverId: bigint;
  documentType: string;
  documentStorageKey: string;
  expiryDate?: Date | null;
  verificationStatus?: string;
  rejectionReason?: string | null;
  documentMetadata?: Prisma.InputJsonValue | null;
  reviewedBy?: bigint | null;
  reviewedAt?: Date | null;
}

export interface UpdateDriverDocumentVerificationData {
  verificationStatus: string;
  reviewedBy?: bigint | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
}

// -------------------------------------------------------------------------
// 3. Driver Invitation Types
// -------------------------------------------------------------------------
export interface CreateDriverInvitationData {
  partnerId: bigint;
  invitedMobile: string;
  driverName?: string | null;
  driverUserId?: bigint | null;
  invitationStatus?: string;
  invitationToken: string;
  notes?: string | null;
  expiresAt: Date;
}

export interface UpdateInvitationStatusMetadata {
  respondedAt?: Date | null;
  rejectionReason?: string | null;
  revokedAt?: Date | null;
  revokedBy?: bigint | null;
  driverUserId?: bigint | null;
}

// -------------------------------------------------------------------------
// 4. Driver Partner Affiliation Types
// -------------------------------------------------------------------------
export interface CreateAffiliationData {
  driverId: bigint;
  partnerId: bigint;
  invitationId?: bigint | null;
  affiliationStatus?: string;
}

export interface TerminateAffiliationData {
  terminationReason?: string | null;
  terminatedAt?: Date | null;
}

// -------------------------------------------------------------------------
// 5. Driver Vehicle Assignment Types
// -------------------------------------------------------------------------
export interface CreateAssignmentData {
  driverId: bigint;
  vehicleId: bigint;
  partnerId: bigint;
  assignmentStatus?: string;
  startTime: Date;
  endTime?: Date | null;
  actualStartTime?: Date | null;
  actualEndTime?: Date | null;
  notes?: string | null;
}

export interface AssignmentFilter {
  driverId?: bigint;
  vehicleId?: bigint;
  partnerId?: bigint;
  assignmentStatus?: string | string[];
  fromStartTime?: Date;
  toStartTime?: Date;
}

// -------------------------------------------------------------------------
// 6. Driver Availability Types
// -------------------------------------------------------------------------
export interface UpsertAvailabilityData {
  isOnline?: boolean;
  isBusy?: boolean;
  currentAssignmentId?: bigint | null;
}

