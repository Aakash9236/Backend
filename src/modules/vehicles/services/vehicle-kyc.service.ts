import { logger } from '../../../config/logger.config';
import { DateUtil } from '../../../common/utils/date.util';

export interface VehicleKycRule {
  requiredDocumentTypes: string[];
  optionalDocumentTypes?: string[];
  requiresAuthorizationProof?: boolean;
  requiresPermit?: boolean;
}

export interface VehicleDocumentRecord {
  id?: bigint | string;
  documentType: string;
  documentStorageKey?: string;
  expiryDate?: Date | string | null;
  verificationStatus: string;
  rejectionReason?: string | null;
  uploadedAt?: Date;
}

export interface VehicleKycValidationResult {
  isValid: boolean;
  missingTypes: string[];
  unverifiedTypes: string[];
  expiredTypes: string[];
  reasons: string[];
}

export interface IVehicleKycPolicyProvider {
  /**
   * Retrieves KYC requirements for a vehicle based on its type, category, and ownership model.
   * Fails closed by returning null or throwing if policy configuration is missing or invalid.
   */
  getRulesForVehicle(params: {
    vehicleTypeId?: bigint;
    typeCode: string;
    serviceCategoryId?: bigint;
    ownershipType: string;
    [key: string]: any;
  }): Promise<VehicleKycRule | null | undefined>;
}

export class DefaultVehicleKycPolicyProvider implements IVehicleKycPolicyProvider {
  private rulesByTypeCode: Map<string, VehicleKycRule> = new Map();
  private defaultRule: VehicleKycRule = {
    requiredDocumentTypes: ['RC', 'INSURANCE', 'FITNESS', 'POLLUTION_PUC'],
    optionalDocumentTypes: ['COMMERCIAL_PERMIT'],
  };

  constructor(initialRules?: Record<string, VehicleKycRule>) {
    // Standard baseline commercial rules
    this.rulesByTypeCode.set('TWO_WHEELER', {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'POLLUTION_PUC'],
      optionalDocumentTypes: ['FITNESS'], // Fitness exempt for standard two-wheelers
    });
    this.rulesByTypeCode.set('THREE_WHEELER', {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'FITNESS', 'POLLUTION_PUC'],
      optionalDocumentTypes: ['COMMERCIAL_PERMIT'],
    });
    this.rulesByTypeCode.set('TATA_ACE', {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'FITNESS', 'POLLUTION_PUC'],
      optionalDocumentTypes: ['COMMERCIAL_PERMIT'],
    });
    this.rulesByTypeCode.set('PICKUP_8FT', {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'FITNESS', 'POLLUTION_PUC', 'COMMERCIAL_PERMIT'],
      optionalDocumentTypes: [],
    });
    this.rulesByTypeCode.set('CANTER_14FT', {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'FITNESS', 'POLLUTION_PUC', 'COMMERCIAL_PERMIT'],
      optionalDocumentTypes: [],
    });

    if (initialRules) {
      for (const [key, rule] of Object.entries(initialRules)) {
        this.rulesByTypeCode.set(key, rule);
      }
    }
  }

  public setRule(typeCode: string, rule: VehicleKycRule): void {
    this.rulesByTypeCode.set(typeCode.toUpperCase(), rule);
  }

  public setDefaultRule(rule: VehicleKycRule): void {
    this.defaultRule = rule;
  }

  public resetToDefault(): void {
    this.rulesByTypeCode.clear();
    this.defaultRule = {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'FITNESS', 'POLLUTION_PUC'],
      optionalDocumentTypes: ['COMMERCIAL_PERMIT'],
    };
    this.rulesByTypeCode.set('TWO_WHEELER', {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'POLLUTION_PUC'],
      optionalDocumentTypes: ['FITNESS'],
    });
    this.rulesByTypeCode.set('THREE_WHEELER', {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'FITNESS', 'POLLUTION_PUC'],
      optionalDocumentTypes: ['COMMERCIAL_PERMIT'],
    });
    this.rulesByTypeCode.set('TATA_ACE', {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'FITNESS', 'POLLUTION_PUC'],
      optionalDocumentTypes: ['COMMERCIAL_PERMIT'],
    });
    this.rulesByTypeCode.set('PICKUP_8FT', {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'FITNESS', 'POLLUTION_PUC', 'COMMERCIAL_PERMIT'],
      optionalDocumentTypes: [],
    });
    this.rulesByTypeCode.set('CANTER_14FT', {
      requiredDocumentTypes: ['RC', 'INSURANCE', 'FITNESS', 'POLLUTION_PUC', 'COMMERCIAL_PERMIT'],
      optionalDocumentTypes: [],
    });
  }

  public clearRules(): void {
    this.resetToDefault();
  }

  public async getRulesForVehicle(params: {
    typeCode: string;
    ownershipType: string;
  }): Promise<VehicleKycRule | null> {
    const baseRule =
      this.rulesByTypeCode.get(params.typeCode.toUpperCase()) || this.defaultRule;

    const finalRequired = [...baseRule.requiredDocumentTypes];

    // Conditional requirement: If partner is NOT the direct owner, authorization proof is strictly mandatory
    if (params.ownershipType !== 'OWNER') {
      if (!finalRequired.includes('OWNER_AUTHORIZATION') && !finalRequired.includes('LEASE_AGREEMENT')) {
        finalRequired.push('OWNER_AUTHORIZATION');
      }
    }

    return {
      requiredDocumentTypes: finalRequired,
      optionalDocumentTypes: baseRule.optionalDocumentTypes || [],
    };
  }
}

export class VehicleKycValidationService {
  constructor(
    private policyProvider: IVehicleKycPolicyProvider = new DefaultVehicleKycPolicyProvider()
  ) {}

  public getPolicyProvider(): IVehicleKycPolicyProvider {
    return this.policyProvider;
  }

  public setPolicyProvider(provider: IVehicleKycPolicyProvider): void {
    this.policyProvider = provider;
  }

  /**
   * Validates whether a vehicle satisfies all applicable KYC policy requirements for administrative approval.
   * Evaluates calendar-day expiry and fails closed if policy provider is unavailable or invalid.
   */
  public async validateForApproval(
    vehicle: {
      typeCode: string;
      ownershipType: string;
      [key: string]: any;
    },
    documents: VehicleDocumentRecord[] = []
  ): Promise<VehicleKycValidationResult> {
    const missingTypes: string[] = [];
    const unverifiedTypes: string[] = [];
    const expiredTypes: string[] = [];
    const reasons: string[] = [];

    // 1. Mandatory Safeguard: Fail-closed if policy provider is missing or invalid
    if (!this.policyProvider || typeof this.policyProvider.getRulesForVehicle !== 'function') {
      logger.error('[Vehicle KYC Validation] Policy provider missing or invalid. Failing closed.');
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        reasons: ['Vehicle KYC policy provider unavailable: Security gate fail-closed.'],
      };
    }

    let policy: VehicleKycRule | null | undefined;
    try {
      policy = await this.policyProvider.getRulesForVehicle({
        typeCode: vehicle.typeCode,
        ownershipType: vehicle.ownershipType,
      });
    } catch (err: any) {
      logger.error('[Vehicle KYC Validation] Policy provider threw an error. Failing closed.', err);
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        reasons: ['Vehicle KYC policy retrieval failed: Security gate fail-closed.'],
      };
    }

    if (!policy || !Array.isArray(policy.requiredDocumentTypes)) {
      logger.error('[Vehicle KYC Validation] Retrieved invalid vehicle policy. Failing closed.');
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        reasons: ['Invalid vehicle KYC policy specification: Security gate fail-closed.'],
      };
    }

    // 2. Evaluate each mandatory document type
    for (const reqType of policy.requiredDocumentTypes) {
      // Support alternative authorization types: 'OWNER_AUTHORIZATION' or 'LEASE_AGREEMENT'
      const matchingDocs = documents.filter((doc) => {
        if (reqType === 'OWNER_AUTHORIZATION') {
          return doc.documentType === 'OWNER_AUTHORIZATION' || doc.documentType === 'LEASE_AGREEMENT';
        }
        return doc.documentType === reqType;
      });

      if (matchingDocs.length === 0) {
        missingTypes.push(reqType);
        reasons.push(`Mandatory vehicle document missing: ${reqType}`);
        continue;
      }

      // Find VERIFIED documents for this type
      const verifiedDocs = matchingDocs.filter((doc) => doc.verificationStatus === 'VERIFIED');
      if (verifiedDocs.length === 0) {
        unverifiedTypes.push(reqType);
        const statuses = matchingDocs.map((d) => d.verificationStatus).join(', ');
        reasons.push(`Mandatory document '${reqType}' is not verified (status: ${statuses})`);
        continue;
      }

      // Check calendar expiry of verified documents
      let hasValidNonExpired = false;
      for (const vDoc of verifiedDocs) {
        const expiryEval = DateUtil.evaluateCalendarExpiry(vDoc.expiryDate);
        if (expiryEval.isExpired) {
          expiredTypes.push(reqType);
          reasons.push(
            `Mandatory document '${reqType}' has expired on ${expiryEval.formattedExpiry || 'unknown date'}`
          );
        } else {
          hasValidNonExpired = true;
          break; // Found at least one valid, non-expired verified document
        }
      }

      if (!hasValidNonExpired && !expiredTypes.includes(reqType)) {
        expiredTypes.push(reqType);
      }
    }

    const isValid =
      missingTypes.length === 0 &&
      unverifiedTypes.length === 0 &&
      expiredTypes.length === 0;

    return {
      isValid,
      missingTypes,
      unverifiedTypes,
      expiredTypes,
      reasons,
    };
  }
}

export const defaultVehicleKycPolicyProvider = new DefaultVehicleKycPolicyProvider();
export const vehicleKycValidationService = new VehicleKycValidationService(
  defaultVehicleKycPolicyProvider
);

