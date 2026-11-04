import { logger } from '../../../config/logger.config';

export interface KycRule {
  /** Document types strictly required for approval */
  requiredTypes: string[];
  /** Optional document types (rejection does not block approval) */
  optionalTypes?: string[];
  /** Optional validity period in days from upload if no explicit expiry date */
  validityDays?: number;
}

export interface KycDocumentRecord {
  id?: bigint | string;
  documentType: string;
  documentStorageKey?: string;
  verificationStatus: string;
  rejectionReason?: string | null;
  uploadedAt?: Date;
  expiryDate?: Date | string | null;
}

export interface KycValidationResult {
  isValid: boolean;
  missingTypes: string[];
  unverifiedTypes: string[];
  expiredTypes: string[];
  reasons: string[];
}

export interface IKycPolicyProvider {
  /**
   * Retrieves KYC requirements for a partner.
   * Must return a valid KycRule or throw/return null to trigger fail-closed behavior.
   */
  getRulesForPartner(partner: {
    id: bigint;
    profileType: string;
    [key: string]: any;
  }): Promise<KycRule | null | undefined>;
}

/**
 * Configurable policy provider for Phase 6A.
 * NOTE: Dynamic, admin-managed database-backed policies will be integrated in Phase 6F.
 * Strictly avoids hardcoding Aadhaar, PAN, GST, or fixed INDIVIDUAL/BUSINESS requirements.
 */
export class DefaultKycPolicyProvider implements IKycPolicyProvider {
  private rulesByProfileType: Map<string, KycRule> = new Map();
  private partnerSpecificRules: Map<string, KycRule> = new Map();
  private defaultRule: KycRule = { requiredTypes: [], optionalTypes: [] };

  constructor(initialRules?: Record<string, KycRule>) {
    if (initialRules) {
      for (const [key, rule] of Object.entries(initialRules)) {
        this.rulesByProfileType.set(key, rule);
      }
    }
  }

  public setRule(profileType: string, rule: KycRule): void {
    this.rulesByProfileType.set(profileType, rule);
  }

  public setPartnerRule(partnerId: string | bigint, rule: KycRule): void {
    this.partnerSpecificRules.set(partnerId.toString(), rule);
  }

  public setDefaultRule(rule: KycRule): void {
    this.defaultRule = rule;
  }

  public clearRules(): void {
    this.rulesByProfileType.clear();
    this.partnerSpecificRules.clear();
    this.defaultRule = { requiredTypes: [], optionalTypes: [] };
  }

  public async getRulesForPartner(partner: {
    id: bigint;
    profileType: string;
  }): Promise<KycRule | null> {
    // 1. Partner-specific rule override
    if (this.partnerSpecificRules.has(partner.id.toString())) {
      return this.partnerSpecificRules.get(partner.id.toString())!;
    }
    // 2. ProfileType-specific rule
    if (this.rulesByProfileType.has(partner.profileType)) {
      return this.rulesByProfileType.get(partner.profileType)!;
    }
    // 3. Fallback default rule (empty requiredTypes unless configured)
    return this.defaultRule;
  }
}

/**
 * Reusable KYC Validation Service.
 * Evaluates whether partner documents satisfy policy requirements for approval.
 * Fails closed if policy provider is missing or returns invalid configuration.
 */
export class KycValidationService {
  constructor(private policyProvider: IKycPolicyProvider = new DefaultKycPolicyProvider()) {}

  public getPolicyProvider(): IKycPolicyProvider {
    return this.policyProvider;
  }

  public setPolicyProvider(provider: IKycPolicyProvider): void {
    this.policyProvider = provider;
  }

  public async validateForApproval(
    partner: { id: bigint; profileType: string; [key: string]: any },
    documents: KycDocumentRecord[] = []
  ): Promise<KycValidationResult> {
    const missingTypes: string[] = [];
    const unverifiedTypes: string[] = [];
    const expiredTypes: string[] = [];
    const reasons: string[] = [];

    // 1. Mandatory Safeguard: Fail-closed if policy provider is unavailable
    if (!this.policyProvider || typeof this.policyProvider.getRulesForPartner !== 'function') {
      logger.error('[KYC Validation Security] KYC policy provider is missing or invalid. Failing closed.');
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        reasons: ['KYC policy provider unavailable: Security gate fail-closed.'],
      };
    }

    let policy: KycRule | null | undefined;
    try {
      policy = await this.policyProvider.getRulesForPartner(partner);
    } catch (err: any) {
      logger.error('[KYC Validation Security] Policy provider threw an error. Failing closed.', err);
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        reasons: ['KYC policy retrieval failed: Security gate fail-closed.'],
      };
    }

    // Fail-closed if policy is null, undefined, or missing requiredTypes array
    if (!policy || !Array.isArray(policy.requiredTypes)) {
      logger.error('[KYC Validation Security] Retrieved invalid KYC policy specification. Failing closed.');
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        reasons: ['Invalid KYC policy specification: Security gate fail-closed.'],
      };
    }

    const nowUtc = Date.now();

    // 2. Evaluate mandatory documents
    for (const reqType of policy.requiredTypes) {
      // Find all uploaded documents matching this type
      const matchingDocs = documents.filter((doc) => doc.documentType === reqType);

      if (matchingDocs.length === 0) {
        missingTypes.push(reqType);
        reasons.push(`Mandatory document missing: ${reqType}`);
        continue;
      }

      // Check if there is at least one VERIFIED and non-expired document for this required type
      const verifiedDocs = matchingDocs.filter(
        (doc) => doc.verificationStatus === 'VERIFIED'
      );

      if (verifiedDocs.length === 0) {
        unverifiedTypes.push(reqType);
        const statuses = matchingDocs.map((d) => d.verificationStatus).join(', ');
        reasons.push(`Mandatory document '${reqType}' is not verified (status: ${statuses})`);
        continue;
      }

      // Check expiry dates for verified documents using UTC comparison
      let hasValidNonExpired = false;
      for (const vDoc of verifiedDocs) {
        let isExpired = false;

        if (vDoc.expiryDate) {
          const expiryTime = new Date(vDoc.expiryDate).getTime();
          if (!isNaN(expiryTime) && expiryTime <= nowUtc) {
            isExpired = true;
          }
        }

        if (isExpired) {
          expiredTypes.push(reqType);
          reasons.push(`Mandatory document '${reqType}' has expired`);
        } else {
          hasValidNonExpired = true;
          break;
        }
      }

      if (!hasValidNonExpired && !expiredTypes.includes(reqType)) {
        unverifiedTypes.push(reqType);
        reasons.push(`Mandatory document '${reqType}' has no valid unexpired verified copy`);
      }
    }

    // Optional documents: rejection does NOT block approval

    const isValid =
      missingTypes.length === 0 &&
      unverifiedTypes.length === 0 &&
      expiredTypes.length === 0 &&
      reasons.length === 0;

    return {
      isValid,
      missingTypes,
      unverifiedTypes,
      expiredTypes,
      reasons,
    };
  }
}

export const defaultKycPolicyProvider = new DefaultKycPolicyProvider();
export const kycValidationService = new KycValidationService(defaultKycPolicyProvider);
