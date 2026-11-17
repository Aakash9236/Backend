import { logger } from '../../../config/logger.config';
import { DateUtil, CalendarExpiryEvaluation } from '../../../common/utils/date.util';
import { DriverDocumentRepository } from '../repositories/driver-document.repository';
import { DriverProfileRepository } from '../repositories/driver-profile.repository';
import { Prisma } from '@prisma/client';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface DriverKycRule {
  /** Document types strictly required for driver approval/eligibility */
  requiredDocumentTypes: string[];
  /** Optional document types (presence/rejection does not block approval unless explicitly made mandatory) */
  optionalDocumentTypes?: string[];
  /** Configurable allowed / acceptable licence classes for this vehicle class or service */
  allowedLicenceClasses?: string[];
  /** Whether a commercial badge or endorsement is required */
  requiresCommercialBadge?: boolean;
  /** Whether police verification certificate is required */
  requiresPoliceVerification?: boolean;
  /** Whether medical certificate / fitness is required */
  requiresMedicalCertificate?: boolean;
  /** Legal applicability notes or jurisdictional requirements */
  legalApplicabilityNotes?: string;
  /** Custom metadata */
  metadata?: Record<string, any>;
}

export interface DriverDocumentRecord {
  id?: bigint | string | number;
  driverId?: bigint | string | number;
  documentType: string;
  documentStorageKey?: string;
  expiryDate?: Date | string | null;
  verificationStatus: string;
  rejectionReason?: string | null;
  uploadedAt?: Date | string;
  reviewedBy?: bigint | string | null;
  reviewedAt?: Date | string | null;
}

export interface DriverProfileForValidation {
  id?: bigint | string | number;
  licenceNumber?: string | null;
  licenceClasses?: string[] | null;
  licenceExpiryDate?: Date | string | null;
  approvalStatus?: string | null;
  submissionStatus?: string | null;
  isSuspended?: boolean | null;
  [key: string]: any;
}

export interface DriverDocumentWarning {
  documentType: string;
  warning: 'DOCUMENT_EXPIRING_SOON' | 'DOCUMENT_EXPIRED';
  daysRemaining: number;
  expiryDate: string | null;
}

export interface DriverKycValidationResult {
  isValid: boolean;
  missingTypes: string[];
  unverifiedTypes: string[];
  expiredTypes: string[];
  expiringSoonTypes: string[];
  incompatibleLicenceClasses: string[];
  reasons: string[];
  documentWarnings: DriverDocumentWarning[];
}

export interface DriverKycPolicyParams {
  vehicleTypeCode?: string;
  serviceCategoryCode?: string;
  serviceCategoryId?: bigint | string;
  jurisdiction?: string;
  [key: string]: any;
}

export interface IDriverKycPolicyProvider {
  /**
   * Retrieves KYC requirements for a driver based on vehicle class, service type, and legal context.
   * Fails closed by returning null or throwing if policy configuration is missing or invalid.
   */
  getRulesForDriver(params: DriverKycPolicyParams): Promise<DriverKycRule | null | undefined>;
}

// ============================================================================
// Default Policy Provider
// ============================================================================

/**
 * Configurable Driver KYC Policy Provider.
 * Supports configuration by:
 * 1. Vehicle Class (e.g. TWO_WHEELER, TATA_ACE, CANTER_14FT)
 * 2. Service Type / Category (e.g. EXPRESS_CARGO, HAZMAT, INTERCITY)
 * 3. Composite criteria (Vehicle Class + Service Type)
 * 4. Legal applicability (Jurisdiction overrides)
 * 5. Document Type requirements (Required vs Optional)
 *
 * Implements fail-closed behavior: returns null when a required policy is missing.
 */
export class DefaultDriverKycPolicyProvider implements IDriverKycPolicyProvider {
  private rulesByVehicleTypeCode: Map<string, DriverKycRule> = new Map();
  private rulesByCompositeKey: Map<string, DriverKycRule> = new Map();
  private defaultRule: DriverKycRule | null = null;

  constructor(initialRules?: {
    byVehicleType?: Record<string, DriverKycRule>;
    byComposite?: Record<string, DriverKycRule>;
    defaultRule?: DriverKycRule | null;
  }) {
    this.resetToDefault();

    if (initialRules?.byVehicleType) {
      for (const [key, rule] of Object.entries(initialRules.byVehicleType)) {
        this.rulesByVehicleTypeCode.set(key.toUpperCase(), rule);
      }
    }

    if (initialRules?.byComposite) {
      for (const [key, rule] of Object.entries(initialRules.byComposite)) {
        this.rulesByCompositeKey.set(key.toUpperCase(), rule);
      }
    }

    if (initialRules?.defaultRule !== undefined) {
      this.defaultRule = initialRules.defaultRule;
    }
  }

  /**
   * Configures a baseline rule for a specific vehicle type code.
   */
  public setRule(vehicleTypeCode: string, rule: DriverKycRule): void {
    if (!vehicleTypeCode || !rule) {
      throw new Error('Vehicle type code and rule are required');
    }
    this.rulesByVehicleTypeCode.set(vehicleTypeCode.toUpperCase(), rule);
  }

  /**
   * Configures a composite rule for vehicle type + service category / legal applicability.
   * Key format: `${vehicleTypeCode}:${serviceCategoryCode}`
   */
  public setCompositeRule(
    vehicleTypeCode: string,
    serviceCategoryCode: string,
    rule: DriverKycRule
  ): void {
    if (!vehicleTypeCode || !serviceCategoryCode || !rule) {
      throw new Error('Vehicle type code, service category code, and rule are required');
    }
    const compositeKey = `${vehicleTypeCode.toUpperCase()}:${serviceCategoryCode.toUpperCase()}`;
    this.rulesByCompositeKey.set(compositeKey, rule);
  }

  /**
   * Configures a jurisdictional rule.
   * Key format: `JURISDICTION:${jurisdiction}:${vehicleTypeCode}`
   */
  public setJurisdictionRule(
    jurisdiction: string,
    vehicleTypeCode: string,
    rule: DriverKycRule
  ): void {
    if (!jurisdiction || !vehicleTypeCode || !rule) {
      throw new Error('Jurisdiction, vehicle type code, and rule are required');
    }
    const compositeKey = `JURISDICTION:${jurisdiction.toUpperCase()}:${vehicleTypeCode.toUpperCase()}`;
    this.rulesByCompositeKey.set(compositeKey, rule);
  }

  /**
   * Configures the fallback default rule when no vehicle type or specific match is provided.
   * Set to null to enforce strict fail-closed matching without fallback.
   */
  public setDefaultRule(rule: DriverKycRule | null): void {
    this.defaultRule = rule;
  }

  /**
   * Removes a configured vehicle type rule.
   */
  public removeRule(vehicleTypeCode: string): void {
    this.rulesByVehicleTypeCode.delete(vehicleTypeCode.toUpperCase());
  }

  /**
   * Clears all configured rules and nullifies the default rule (enforces strict fail-closed).
   */
  public clearRules(): void {
    this.rulesByVehicleTypeCode.clear();
    this.rulesByCompositeKey.clear();
    this.defaultRule = null;
  }

  /**
   * Resets policy provider to marketplace default rules.
   * NOTE: Policies do not hardcode universal assumptions; they represent the initial baseline
   * that can be dynamically updated per vehicle class, service type, and jurisdiction.
   */
  public resetToDefault(): void {
    this.rulesByVehicleTypeCode.clear();
    this.rulesByCompositeKey.clear();

    // Default baseline for general driver registration (no vehicle type specified yet)
    this.defaultRule = {
      requiredDocumentTypes: ['DRIVING_LICENCE', 'PROFILE_PHOTO'],
      optionalDocumentTypes: ['IDENTITY_PROOF', 'COMMERCIAL_BADGE', 'POLICE_VERIFICATION'],
      allowedLicenceClasses: ['MCWG', 'LMV', 'LMV-TR', 'TRANS', 'HMV', 'HGMV'],
      legalApplicabilityNotes: 'General baseline requirements for marketplace driver profile registration.',
    };

    // 1. Two-Wheeler (Delivery / Bike Courier)
    this.rulesByVehicleTypeCode.set('TWO_WHEELER', {
      requiredDocumentTypes: ['DRIVING_LICENCE', 'PROFILE_PHOTO'],
      optionalDocumentTypes: ['IDENTITY_PROOF'],
      allowedLicenceClasses: ['MCWG', 'LMV', 'TRANS'],
      legalApplicabilityNotes: 'Motorcycle with Gear endorsement or higher.',
    });

    // 2. Three-Wheeler (Auto Cargo / Passenger 3W)
    this.rulesByVehicleTypeCode.set('THREE_WHEELER', {
      requiredDocumentTypes: ['DRIVING_LICENCE', 'PROFILE_PHOTO', 'IDENTITY_PROOF'],
      optionalDocumentTypes: ['COMMERCIAL_BADGE'],
      allowedLicenceClasses: ['3W-CAB', 'LMV', 'LMV-TR', 'TRANS'],
      legalApplicabilityNotes: '3W endorsement, Light Motor Vehicle, or Transport endorsement.',
    });

    // 3. Tata Ace / Small Commercial Vehicle (SCV)
    this.rulesByVehicleTypeCode.set('TATA_ACE', {
      requiredDocumentTypes: ['DRIVING_LICENCE', 'PROFILE_PHOTO', 'IDENTITY_PROOF'],
      optionalDocumentTypes: ['POLICE_VERIFICATION', 'COMMERCIAL_BADGE'],
      allowedLicenceClasses: ['LMV', 'LMV-TR', 'TRANS'],
      legalApplicabilityNotes: 'Light Motor Vehicle (LMV) or Transport (TRANS) endorsement.',
    });

    // 4. Pickup 8ft / Light Commercial Vehicle (LCV)
    this.rulesByVehicleTypeCode.set('PICKUP_8FT', {
      requiredDocumentTypes: ['DRIVING_LICENCE', 'PROFILE_PHOTO', 'IDENTITY_PROOF'],
      optionalDocumentTypes: ['POLICE_VERIFICATION', 'COMMERCIAL_BADGE'],
      allowedLicenceClasses: ['LMV', 'LMV-TR', 'TRANS', 'HMV'],
      legalApplicabilityNotes: 'LMV/Transport or Heavy endorsement.',
    });

    // 5. Canter 14ft / Medium & Heavy Commercial Vehicle (MHCV)
    this.rulesByVehicleTypeCode.set('CANTER_14FT', {
      requiredDocumentTypes: ['DRIVING_LICENCE', 'PROFILE_PHOTO', 'IDENTITY_PROOF', 'POLICE_VERIFICATION'],
      optionalDocumentTypes: ['MEDICAL_FITNESS', 'COMMERCIAL_BADGE'],
      allowedLicenceClasses: ['TRANS', 'HMV', 'HGMV'],
      requiresCommercialBadge: true,
      requiresPoliceVerification: true,
      legalApplicabilityNotes: 'Heavy/Transport commercial endorsement and police verification mandatory.',
    });
  }

  /**
   * Retrieves KYC requirements based on driver evaluation context.
   * Fails closed by returning null if no rule applies and default rule is null/missing.
   */
  public async getRulesForDriver(
    params: DriverKycPolicyParams
  ): Promise<DriverKycRule | null | undefined> {
    if (!params) {
      return this.defaultRule;
    }

    const { vehicleTypeCode, serviceCategoryCode, jurisdiction } = params;

    // 1. Check Jurisdiction Override
    if (jurisdiction && vehicleTypeCode) {
      const jurKey = `JURISDICTION:${jurisdiction.toUpperCase()}:${vehicleTypeCode.toUpperCase()}`;
      if (this.rulesByCompositeKey.has(jurKey)) {
        return this.rulesByCompositeKey.get(jurKey);
      }
    }

    // 2. Check Composite Rule (Vehicle Type + Service Category)
    if (vehicleTypeCode && serviceCategoryCode) {
      const compKey = `${vehicleTypeCode.toUpperCase()}:${serviceCategoryCode.toUpperCase()}`;
      if (this.rulesByCompositeKey.has(compKey)) {
        return this.rulesByCompositeKey.get(compKey);
      }
    }

    // 3. Check Vehicle Type Code
    if (vehicleTypeCode) {
      const vKey = vehicleTypeCode.toUpperCase();
      if (this.rulesByVehicleTypeCode.has(vKey)) {
        return this.rulesByVehicleTypeCode.get(vKey);
      }
    }

    // 4. Fallback to Default Rule (fails closed if defaultRule is null)
    return this.defaultRule;
  }
}

// ============================================================================
// Driver KYC Validation Service
// ============================================================================

export class DriverKycValidationService {
  constructor(
    private policyProvider: IDriverKycPolicyProvider = new DefaultDriverKycPolicyProvider(),
    private documentRepo?: DriverDocumentRepository,
    private profileRepo?: DriverProfileRepository
  ) {}

  public getPolicyProvider(): IDriverKycPolicyProvider {
    return this.policyProvider;
  }

  public setPolicyProvider(provider: IDriverKycPolicyProvider): void {
    this.policyProvider = provider;
  }

  /**
   * Validates whether a driver meets all applicable KYC policy requirements.
   *
   * Core Security Invariants:
   * 1. Fail-closed: Fails immediately if policy provider is missing or returns invalid/null policy.
   * 2. Anti-bypass evaluation: For each required document type, strictly evaluates ONLY the latest
   *    document (sorted by uploadedAt DESC / id DESC). A PENDING, REJECTED, or EXPIRED replacement
   *    does NOT fall back to an older verified document.
   * 3. Zero-grace-period calendar expiry: Evaluated strictly in Asia/Kolkata timezone via DateUtil.
   *    Documents expire at 00:00:00.000 IST following their expiry calendar date.
   * 4. 15-day warning: Flagged when a verified document is within 15 calendar days of expiry.
   * 5. Configurable licence compatibility: Matches driver's licence endorsements against the configured
   *    allowedLicenceClasses for the target vehicle class.
   */
  public async validateForApproval(
    driver: DriverProfileForValidation = {},
    documents: DriverDocumentRecord[] = [],
    policyParams: DriverKycPolicyParams = {},
    referenceDate: Date = new Date()
  ): Promise<DriverKycValidationResult> {
    const missingTypes: string[] = [];
    const unverifiedTypes: string[] = [];
    const expiredTypes: string[] = [];
    const expiringSoonTypes: string[] = [];
    const incompatibleLicenceClasses: string[] = [];
    const reasons: string[] = [];
    const documentWarnings: DriverDocumentWarning[] = [];

    // -------------------------------------------------------------------------
    // 1. Mandatory Safeguard: Fail-closed if policy provider is missing or invalid
    // -------------------------------------------------------------------------
    if (!this.policyProvider || typeof this.policyProvider.getRulesForDriver !== 'function') {
      logger.error('[Driver KYC Validation] Policy provider missing or invalid. Failing closed.');
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        expiringSoonTypes: [],
        incompatibleLicenceClasses: [],
        reasons: ['Driver KYC policy provider unavailable: Security gate fail-closed.'],
        documentWarnings: [],
      };
    }

    let policy: DriverKycRule | null | undefined;
    try {
      policy = await this.policyProvider.getRulesForDriver(policyParams);
    } catch (err: any) {
      logger.error('[Driver KYC Validation] Policy provider threw an error. Failing closed.', err);
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        expiringSoonTypes: [],
        incompatibleLicenceClasses: [],
        reasons: ['Driver KYC policy retrieval failed: Security gate fail-closed.'],
        documentWarnings: [],
      };
    }

    if (!policy || !Array.isArray(policy.requiredDocumentTypes)) {
      logger.error('[Driver KYC Validation] Retrieved invalid or null policy. Failing closed.');
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        expiringSoonTypes: [],
        incompatibleLicenceClasses: [],
        reasons: ['Invalid or missing driver KYC policy specification: Security gate fail-closed.'],
        documentWarnings: [],
      };
    }

    // -------------------------------------------------------------------------
    // 2. Evaluate Mandatory Document Requirements (Anti-Bypass Gate)
    // -------------------------------------------------------------------------
    for (const reqType of policy.requiredDocumentTypes) {
      const normalizedReqType = reqType.trim().toUpperCase();

      // Find all matching documents for this type (with alias support for identity proofs)
      const matchingDocs = documents.filter((doc) => {
        if (!doc.documentType) return false;
        const dt = doc.documentType.trim().toUpperCase();
        if (normalizedReqType === 'IDENTITY_PROOF') {
          return dt === 'IDENTITY_PROOF' || dt === 'AADHAAR' || dt === 'PAN';
        }
        if (normalizedReqType === 'AADHAAR') {
          return dt === 'AADHAAR' || dt === 'IDENTITY_PROOF';
        }
        return dt === normalizedReqType;
      });

      if (matchingDocs.length === 0) {
        missingTypes.push(normalizedReqType);
        reasons.push(`Mandatory driver document missing: ${normalizedReqType}`);
        continue;
      }

      // Sort matching documents to find strictly the LATEST document
      const sortedDocs = [...matchingDocs].sort((a, b) => {
        const timeA = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
        const timeB = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
        if (timeB !== timeA) {
          return timeB - timeA; // Descending by upload time
        }
        // Tie-breaker by ID if present
        const idA = a.id ? BigInt(a.id) : 0n;
        const idB = b.id ? BigInt(b.id) : 0n;
        return idB > idA ? 1 : idB < idA ? -1 : 0;
      });

      const latestDoc = sortedDocs[0];
      const status = (latestDoc.verificationStatus || '').trim().toUpperCase();

      // Anti-Bypass Rule: Evaluate ONLY the latest document.
      // If latest document is PENDING or REJECTED, fail validation immediately.
      // NEVER fall back to older verified documents.
      if (status !== 'VERIFIED') {
        unverifiedTypes.push(normalizedReqType);
        if (status === 'PENDING') {
          reasons.push(
            `Mandatory document '${normalizedReqType}' verification is pending${
              sortedDocs.length > 1 ? ' (replacement under review)' : ''
            }`
          );
        } else if (status === 'REJECTED') {
          const reasonText = latestDoc.rejectionReason ? `: ${latestDoc.rejectionReason}` : '';
          reasons.push(`Mandatory document '${normalizedReqType}' was rejected${reasonText}`);
        } else {
          reasons.push(
            `Mandatory document '${normalizedReqType}' is not verified (status: ${status || 'UNKNOWN'})`
          );
        }
        continue;
      }

      // Latest document is VERIFIED — now evaluate Asia/Kolkata calendar expiry
      const expiryEval = DateUtil.evaluateCalendarExpiry(latestDoc.expiryDate, referenceDate);

      if (expiryEval.isExpired) {
        expiredTypes.push(normalizedReqType);
        reasons.push(
          `Mandatory document '${normalizedReqType}' expired on ${
            expiryEval.formattedExpiry || 'unknown date'
          } (Asia/Kolkata calendar midnight)`
        );
        documentWarnings.push({
          documentType: normalizedReqType,
          warning: 'DOCUMENT_EXPIRED',
          daysRemaining: 0,
          expiryDate: expiryEval.formattedExpiry,
        });
      } else {
        if (expiryEval.isExpiringSoon) {
          expiringSoonTypes.push(normalizedReqType);
          documentWarnings.push({
            documentType: normalizedReqType,
            warning: 'DOCUMENT_EXPIRING_SOON',
            daysRemaining: expiryEval.daysRemaining,
            expiryDate: expiryEval.formattedExpiry,
          });
        }
      }
    }

    // -------------------------------------------------------------------------
    // 3. Licence Class Eligibility Validation
    // -------------------------------------------------------------------------
    if (policy.allowedLicenceClasses && policy.allowedLicenceClasses.length > 0) {
      const allowedClasses = policy.allowedLicenceClasses.map((c) => c.trim().toUpperCase());
      const driverClasses = Array.isArray(driver.licenceClasses)
        ? driver.licenceClasses.map((c) => c.trim().toUpperCase())
        : [];

      const hasMatchingClass = driverClasses.some((dc) => allowedClasses.includes(dc));

      if (!hasMatchingClass) {
        const vehicleLabel = policyParams.vehicleTypeCode || 'requested vehicle category';
        incompatibleLicenceClasses.push(...allowedClasses);
        reasons.push(
          `Driver licence classes [${driverClasses.join(', ')}] are not authorized for vehicle class '${vehicleLabel}'. Required at least one of: [${allowedClasses.join(', ')}]`
        );
      }
    }

    // -------------------------------------------------------------------------
    // 4. Overall Eligibility Outcome
    // -------------------------------------------------------------------------
    const isValid =
      missingTypes.length === 0 &&
      unverifiedTypes.length === 0 &&
      expiredTypes.length === 0 &&
      incompatibleLicenceClasses.length === 0;

    return {
      isValid,
      missingTypes,
      unverifiedTypes,
      expiredTypes,
      expiringSoonTypes,
      incompatibleLicenceClasses,
      reasons,
      documentWarnings,
    };
  }

  /**
   * Helper method to evaluate licence class compatibility directly.
   */
  public async isLicenceEligibleForVehicleClass(
    driverLicenceClasses: string[] | null | undefined,
    vehicleTypeCode: string,
    serviceCategoryCode?: string
  ): Promise<{
    isEligible: boolean;
    allowedClasses: string[];
    reason?: string;
  }> {
    if (!this.policyProvider) {
      return {
        isEligible: false,
        allowedClasses: [],
        reason: 'Policy provider unavailable: Security gate fail-closed.',
      };
    }

    const policy = await this.policyProvider.getRulesForDriver({
      vehicleTypeCode,
      serviceCategoryCode,
    });

    if (!policy) {
      return {
        isEligible: false,
        allowedClasses: [],
        reason: `No KYC policy found for vehicle type '${vehicleTypeCode}': Security gate fail-closed.`,
      };
    }

    if (!policy.allowedLicenceClasses || policy.allowedLicenceClasses.length === 0) {
      // No specific licence restrictions configured for this vehicle class
      return {
        isEligible: true,
        allowedClasses: [],
      };
    }

    const allowed = policy.allowedLicenceClasses.map((c) => c.trim().toUpperCase());
    const driver = Array.isArray(driverLicenceClasses)
      ? driverLicenceClasses.map((c) => c.trim().toUpperCase())
      : [];

    const isMatch = driver.some((dc) => allowed.includes(dc));

    if (!isMatch) {
      return {
        isEligible: false,
        allowedClasses: allowed,
        reason: `Driver licence classes [${driver.join(', ')}] do not satisfy required [${allowed.join(', ')}] for vehicle type '${vehicleTypeCode}'.`,
      };
    }

    return {
      isEligible: true,
      allowedClasses: allowed,
    };
  }

  /**
   * Orchestration helper that fetches real database records using driver repositories
   * and evaluates eligibility. Database access remains isolated inside repositories.
   */
  public async validateDriverWithRepository(
    driverId: bigint,
    policyParams: DriverKycPolicyParams = {},
    tx?: Prisma.TransactionClient,
    referenceDate: Date = new Date()
  ): Promise<DriverKycValidationResult> {
    if (!this.profileRepo || !this.documentRepo) {
      throw new Error('Repositories must be provided to use validateDriverWithRepository');
    }

    const profile = await this.profileRepo.findById(driverId, tx);
    if (!profile) {
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        expiringSoonTypes: [],
        incompatibleLicenceClasses: [],
        reasons: [`Driver profile with ID ${driverId.toString()} not found`],
        documentWarnings: [],
      };
    }

    const documents = await this.documentRepo.findByDriverId(driverId, tx);

    const docRecords: DriverDocumentRecord[] = documents.map((d) => ({
      id: d.id,
      driverId: d.driverId,
      documentType: d.documentType,
      documentStorageKey: d.documentStorageKey,
      expiryDate: d.expiryDate,
      verificationStatus: d.verificationStatus,
      rejectionReason: d.rejectionReason,
      uploadedAt: d.uploadedAt,
      reviewedBy: d.reviewedBy,
      reviewedAt: d.reviewedAt,
    }));

    return this.validateForApproval(
      {
        id: profile.id,
        licenceNumber: profile.licenceNumber,
        licenceClasses: profile.licenceClasses,
        licenceExpiryDate: profile.licenceExpiryDate,
        approvalStatus: profile.approvalStatus,
        submissionStatus: profile.submissionStatus,
        isSuspended: !!profile.suspendedAt,
        suspendedAt: profile.suspendedAt,
        suspensionReason: profile.suspensionReason,
      },
      docRecords,
      policyParams,
      referenceDate
    );
  }
}

// Default singleton exports
export const defaultDriverKycPolicyProvider = new DefaultDriverKycPolicyProvider();
export const driverKycValidationService = new DriverKycValidationService(
  defaultDriverKycPolicyProvider,
  new DriverDocumentRepository(),
  new DriverProfileRepository()
);
