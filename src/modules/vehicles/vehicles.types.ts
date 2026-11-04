import { CalendarExpiryEvaluation } from '../../common/utils/date.util';

export type VehicleOwnershipType = 'OWNER' | 'LEASED' | 'AUTHORIZED_REPRESENTATIVE';
export type VehicleOwnershipStatus = 'ACTIVE' | 'TRANSFERRED' | 'TERMINATED';
export type VehicleVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';

export type VehicleDocumentType =
  | 'RC'
  | 'INSURANCE'
  | 'FITNESS'
  | 'POLLUTION_PUC'
  | 'COMMERCIAL_PERMIT'
  | 'OWNER_AUTHORIZATION'
  | 'LEASE_AGREEMENT'
  | 'OTHER';

export type VehicleDocumentVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface VehicleAuditLogData {
  actorUserId: bigint;
  action: string;
  entityName: string;
  entityId?: bigint;
  oldValues?: any;
  newValues?: any;
  ipAddress?: string;
  userAgent?: string;
}

export interface RegisterVehicleInput {
  vehicleTypeId: string;
  registrationNumber: string;
  make?: string;
  model?: string;
  manufacturingYear?: number;
  rcNumber?: string;
  ownershipType: VehicleOwnershipType;
  ownerName?: string;
}

export interface UpdateVehicleInput {
  make?: string;
  model?: string;
  manufacturingYear?: number;
  rcNumber?: string;
}

export interface UploadVehicleDocumentInput {
  documentType: VehicleDocumentType;
  expiryDate?: string; // YYYY-MM-DD
  documentStorageKey?: string;
}

export interface TransferVehicleInput {
  targetPartnerId: string;
  transferReason: string;
  newOwnershipType?: VehicleOwnershipType;
  newOwnerName?: string;
}

export interface VehicleOperationalEligibility {
  isOperational: boolean;
  canAcceptBookings: boolean;
  reasons: string[];
}

export interface VehicleDocumentResponse {
  id: string;
  vehicleId: string;
  documentType: string;
  documentStorageKey: string;
  expiryDate: string | null;
  verificationStatus: string;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  uploadedAt: string;
  expiryEvaluation: CalendarExpiryEvaluation;
  isExpired?: boolean;
  isExpiringSoon?: boolean;
  daysRemaining?: number;
}

export interface VehicleResponse {
  id: string;
  vehicleTypeId: string;
  vehicleType: {
    typeCode: string;
    typeName: string;
    displayName?: string;
    capacityKg: number;
    volumeCuft: number | null;
    serviceCategoryId: string;
  };
  registrationNumber: string;
  make: string | null;
  model: string | null;
  manufacturingYear: number | null;
  rcNumber: string | null;
  verificationStatus: string;
  rejectionReason: string | null;
  isActive: boolean;
  isPrimary: boolean;
  operationalStatus?: boolean;
  hasExpiredDocuments?: boolean;
  ownership: {
    ownershipType: string;
    ownerName: string | null;
    ownershipStatus: string;
    isPrimary?: boolean;
    assignedAt: string;
    unassignedAt: string | null;
  };
  operationalEligibility: VehicleOperationalEligibility;
  documents?: VehicleDocumentResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface VehicleTypeResponse {
  id: string;
  typeCode: string;
  typeName: string;
  displayName?: string;
  serviceCategoryId: string;
  capacityKg: number;
  volumeCuft: number | null;
  baseFare: number;
  perKmRate: number;
  perMinuteRate: number;
  isActive: boolean;
}
