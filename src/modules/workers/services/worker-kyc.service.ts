import { logger } from '../../../config/logger.config';
import { DateUtil } from '../../../common/utils/date.util';
import { WorkerDocumentRepository } from '../repositories/worker-document.repository';
import { WorkerSkillRepository } from '../repositories/worker-skill.repository';
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import { Prisma } from '@prisma/client';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface WorkerKycRule {
  /** Document types strictly required for worker approval/eligibility */
  requiredDocumentTypes: string[];
  /** Optional document types */
  optionalDocumentTypes?: string[];
  /** Required service category codes or IDs that must have verified skills */
  requiredSkillCategories?: (string | bigint)[];
  /** Legal applicability notes or jurisdictional requirements */
  legalApplicabilityNotes?: string;
  /** Custom metadata */
  metadata?: Record<string, any>;
}

export interface WorkerDocumentRecord {
  id?: bigint | string | number;
  workerId?: bigint | string | number;
  documentType: string;
  documentStorageKey?: string;
  expiryDate?: Date | string | null;
  verificationStatus: string;
  rejectionReason?: string | null;
  uploadedAt?: Date | string;
  reviewedBy?: bigint | string | null;
  reviewedAt?: Date | string | null;
}

export interface WorkerSkillRecord {
  id?: bigint | string | number;
  workerId?: bigint | string | number;
  serviceCategoryId: bigint | string | number;
  serviceCategoryCode?: string;
  serviceCategoryName?: string;
  experienceYears?: number;
  verificationStatus: string;
  rejectionReason?: string | null;
  isActive?: boolean;
}

export interface WorkerProfileForValidation {
  id?: bigint | string | number;
  workerType?: string | null;
  primaryCityId?: bigint | string | number | null;
  approvalStatus?: string | null;
  submissionStatus?: string | null;
  isSuspended?: boolean | null;
  suspendedAt?: Date | string | null;
  suspensionReason?: string | null;
  [key: string]: any;
}

export interface WorkerDocumentWarning {
  documentType: string;
  warning: 'DOCUMENT_EXPIRING_SOON' | 'DOCUMENT_EXPIRED';
  daysRemaining: number;
  expiryDate: string | null;
}

export interface WorkerKycValidationResult {
  isValid: boolean;
  missingDocuments: string[];
  unverifiedDocuments: string[];
  expiredDocuments: string[];
  expiringSoonDocuments: string[];
  missingSkills: string[];
  unverifiedSkills: string[];
  reasons: string[];
  documentWarnings: WorkerDocumentWarning[];
}

export interface WorkerKycPolicyParams {
  workerType?: string;
  serviceCategoryCode?: string;
  serviceCategoryId?: bigint | string;
  serviceCategoryCodes?: string[];
  serviceCategoryIds?: (bigint | string)[];
  jurisdiction?: string;
  cityId?: bigint | string | number;
  [key: string]: any;
}

export interface IWorkerKycPolicyProvider {
  /**
   * Retrieves KYC requirements for a worker based on worker type, service categories, jurisdiction, and legal context.
   * Fails closed by returning null, undefined, or throwing if policy configuration is missing or invalid.
   */
  getRulesForWorker(params: WorkerKycPolicyParams): Promise<WorkerKycRule | null | undefined>;
}

// ============================================================================
// Default Policy Provider
// ============================================================================

/**
 * Configurable Worker KYC Policy Provider.
 * Supports configuration by:
 * 1. Worker Type (HELPER, TECHNICIAN, SPECIALIST)
 * 2. Service Category (e.g. CLEANING, PLUMBING, ELECTRICAL)
 * 3. City / Jurisdiction (e.g. BANGALORE, MUMBAI, DELHI)
 * 4. Composite criteria (Jurisdiction + Worker Type + Category)
 * 5. Multi-dimension resolution with Most Restrictive Mandatory Requirement rule.
 *
 * Implements strict fail-closed behavior on missing or invalid configurations.
 */
export class DefaultWorkerKycPolicyProvider implements IWorkerKycPolicyProvider {
  private rulesByWorkerType: Map<string, WorkerKycRule> = new Map();
  private rulesByCategory: Map<string, WorkerKycRule> = new Map();
  private rulesByJurisdiction: Map<string, WorkerKycRule> = new Map();
  private rulesByCompositeKey: Map<string, WorkerKycRule> = new Map();
  private defaultRule: WorkerKycRule | null = null;

  constructor(initialRules?: {
    byWorkerType?: Record<string, WorkerKycRule>;
    byCategory?: Record<string, WorkerKycRule>;
    byJurisdiction?: Record<string, WorkerKycRule>;
    byComposite?: Record<string, WorkerKycRule>;
    defaultRule?: WorkerKycRule | null;
  }) {
    this.resetToDefault();

    if (initialRules?.byWorkerType) {
      for (const [key, rule] of Object.entries(initialRules.byWorkerType)) {
        this.rulesByWorkerType.set(key.toUpperCase(), rule);
      }
    }

    if (initialRules?.byCategory) {
      for (const [key, rule] of Object.entries(initialRules.byCategory)) {
        this.rulesByCategory.set(key.toUpperCase(), rule);
      }
    }

    if (initialRules?.byJurisdiction) {
      for (const [key, rule] of Object.entries(initialRules.byJurisdiction)) {
        this.rulesByJurisdiction.set(key.toUpperCase(), rule);
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
   * Configures a baseline rule for a worker type (HELPER, TECHNICIAN, SPECIALIST).
   */
  public setWorkerTypeRule(workerType: string, rule: WorkerKycRule): void {
    if (!workerType || !rule) {
      throw new Error('Worker type and rule are required');
    }
    this.rulesByWorkerType.set(workerType.toUpperCase(), rule);
  }

  /**
   * Configures a rule for a service category code.
   */
  public setCategoryRule(serviceCategoryCode: string, rule: WorkerKycRule): void {
    if (!serviceCategoryCode || !rule) {
      throw new Error('Service category code and rule are required');
    }
    this.rulesByCategory.set(serviceCategoryCode.toUpperCase(), rule);
  }

  /**
   * Configures a rule for a jurisdiction / city.
   */
  public setJurisdictionRule(jurisdiction: string, rule: WorkerKycRule): void {
    if (!jurisdiction || !rule) {
      throw new Error('Jurisdiction and rule are required');
    }
    this.rulesByJurisdiction.set(jurisdiction.toUpperCase(), rule);
  }

  /**
   * Configures a composite rule for worker type + category or jurisdiction.
   */
  public setCompositeRule(workerType: string, serviceCategoryCode: string, rule: WorkerKycRule): void {
    if (!workerType || !serviceCategoryCode || !rule) {
      throw new Error('Worker type, service category code, and rule are required');
    }
    const compositeKey = `${workerType.toUpperCase()}:${serviceCategoryCode.toUpperCase()}`;
    this.rulesByCompositeKey.set(compositeKey, rule);
  }

  /**
   * Configures an arbitrary composite key rule.
   */
  public setRule(key: string, rule: WorkerKycRule): void {
    if (!key || !rule) {
      throw new Error('Key and rule are required');
    }
    this.rulesByCompositeKey.set(key.toUpperCase(), rule);
  }

  /**
   * Sets the fallback default rule. Set to null to enforce strict matching.
   */
  public setDefaultRule(rule: WorkerKycRule | null): void {
    this.defaultRule = rule;
  }

  /**
   * Removes a configured rule.
   */
  public removeRule(key: string): void {
    const k = key.toUpperCase();
    this.rulesByWorkerType.delete(k);
    this.rulesByCategory.delete(k);
    this.rulesByJurisdiction.delete(k);
    this.rulesByCompositeKey.delete(k);
  }

  /**
   * Clears all configured rules (enforcing fail-closed).
   */
  public clearRules(): void {
    this.rulesByWorkerType.clear();
    this.rulesByCategory.clear();
    this.rulesByJurisdiction.clear();
    this.rulesByCompositeKey.clear();
    this.defaultRule = null;
  }

  /**
   * Resets policy provider to marketplace default rules.
   */
  public resetToDefault(): void {
    this.rulesByWorkerType.clear();
    this.rulesByCategory.clear();
    this.rulesByJurisdiction.clear();
    this.rulesByCompositeKey.clear();

    // Default baseline for general worker registration
    this.defaultRule = {
      requiredDocumentTypes: ['IDENTITY_PROOF'],
      optionalDocumentTypes: ['POLICE_VERIFICATION', 'ADDRESS_PROOF', 'MEDICAL_FITNESS'],
      legalApplicabilityNotes: 'General baseline requirements for service worker onboarding.',
    };

    // 1. HELPER (e.g. moving helper, cleaning assistant)
    this.rulesByWorkerType.set('HELPER', {
      requiredDocumentTypes: ['IDENTITY_PROOF'],
      optionalDocumentTypes: ['POLICE_VERIFICATION', 'ADDRESS_PROOF', 'MEDICAL_FITNESS'],
      legalApplicabilityNotes: 'Helper requires identity verification. Police verification recommended.',
    });

    // 2. TECHNICIAN (e.g. electrician, plumber, AC repair)
    this.rulesByWorkerType.set('TECHNICIAN', {
      requiredDocumentTypes: ['IDENTITY_PROOF', 'SKILL_CERTIFICATE'],
      optionalDocumentTypes: ['POLICE_VERIFICATION', 'ADDRESS_PROOF', 'MEDICAL_FITNESS'],
      legalApplicabilityNotes: 'Technicians require identity proof and trade skill verification.',
    });

    // 3. SPECIALIST (e.g. hazardous electrical, solar installation, master carpentry)
    this.rulesByWorkerType.set('SPECIALIST', {
      requiredDocumentTypes: ['IDENTITY_PROOF', 'SKILL_CERTIFICATE', 'POLICE_VERIFICATION'],
      optionalDocumentTypes: ['MEDICAL_FITNESS', 'ADDRESS_PROOF'],
      legalApplicabilityNotes: 'Specialists require identity proof, trade certification, and verified police clearance.',
    });
  }

  /**
   * Retrieves KYC requirements based on worker evaluation context.
   *
   * Precedence & Conflict Resolution:
   * When multiple applicable policies conflict, applies the MOST RESTRICTIVE MANDATORY REQUIREMENT:
   * - requiredDocumentTypes: Set union of all required documents across applicable rules.
   * - requiredSkillCategories: Set union of all required skill categories.
   * - optionalDocumentTypes: Optional documents not already present in requiredDocumentTypes.
   *
   * Ambiguous or invalid policy configuration fails closed by returning null.
   */
  public async getRulesForWorker(
    params: WorkerKycPolicyParams
  ): Promise<WorkerKycRule | null | undefined> {
    if (!params) {
      return this.defaultRule;
    }

    const matchedRules: WorkerKycRule[] = [];

    const workerType = params.workerType ? params.workerType.trim().toUpperCase() : undefined;
    const jurisdiction = params.jurisdiction ? params.jurisdiction.trim().toUpperCase() : undefined;
    const cityIdStr = params.cityId !== undefined && params.cityId !== null ? String(params.cityId) : undefined;

    // Collect category codes
    const categoryCodes: string[] = [];
    if (params.serviceCategoryCode) {
      categoryCodes.push(params.serviceCategoryCode.trim().toUpperCase());
    }
    if (Array.isArray(params.serviceCategoryCodes)) {
      for (const cat of params.serviceCategoryCodes) {
        if (typeof cat === 'string' && cat.trim()) {
          categoryCodes.push(cat.trim().toUpperCase());
        }
      }
    }

    // 1. Check Composite Rules
    if (workerType) {
      for (const catCode of categoryCodes) {
        const compKey = `${workerType}:${catCode}`;
        if (this.rulesByCompositeKey.has(compKey)) {
          matchedRules.push(this.rulesByCompositeKey.get(compKey)!);
        }
      }
      if (jurisdiction) {
        const jurCompKey = `${jurisdiction}:${workerType}`;
        if (this.rulesByCompositeKey.has(jurCompKey)) {
          matchedRules.push(this.rulesByCompositeKey.get(jurCompKey)!);
        }
      }
    }

    // 2. Check Jurisdiction / City Rules
    if (jurisdiction && this.rulesByJurisdiction.has(jurisdiction)) {
      matchedRules.push(this.rulesByJurisdiction.get(jurisdiction)!);
    }
    if (cityIdStr && this.rulesByJurisdiction.has(cityIdStr)) {
      matchedRules.push(this.rulesByJurisdiction.get(cityIdStr)!);
    }

    // 3. Check Service Category Rules
    for (const catCode of categoryCodes) {
      if (this.rulesByCategory.has(catCode)) {
        matchedRules.push(this.rulesByCategory.get(catCode)!);
      }
    }

    // 4. Check Worker Type Rules
    if (workerType && this.rulesByWorkerType.has(workerType)) {
      matchedRules.push(this.rulesByWorkerType.get(workerType)!);
    }

    // If no specific rules matched, fall back to defaultRule
    if (matchedRules.length === 0) {
      return this.defaultRule;
    }

    // Single rule match
    if (matchedRules.length === 1) {
      const single = matchedRules[0];
      if (!single || !Array.isArray(single.requiredDocumentTypes)) {
        return null; // Invalid configuration fails closed
      }
      return single;
    }

    // Multi-rule conflict resolution: Apply the MOST RESTRICTIVE mandatory requirement
    const requiredDocsSet = new Set<string>();
    const optionalDocsSet = new Set<string>();
    const requiredSkillsSet = new Set<string | bigint>();
    const notesArr: string[] = [];

    for (const rule of matchedRules) {
      // Ambiguous or invalid rule configuration fails closed
      if (!rule || !Array.isArray(rule.requiredDocumentTypes)) {
        logger.error('[Worker KYC Policy] Malformed rule encountered in conflict resolution. Failing closed.');
        return null;
      }

      for (const doc of rule.requiredDocumentTypes) {
        if (typeof doc === 'string' && doc.trim()) {
          requiredDocsSet.add(doc.trim().toUpperCase());
        }
      }

      if (Array.isArray(rule.optionalDocumentTypes)) {
        for (const doc of rule.optionalDocumentTypes) {
          if (typeof doc === 'string' && doc.trim()) {
            optionalDocsSet.add(doc.trim().toUpperCase());
          }
        }
      }

      if (Array.isArray(rule.requiredSkillCategories)) {
        for (const skill of rule.requiredSkillCategories) {
          requiredSkillsSet.add(skill);
        }
      }

      if (rule.legalApplicabilityNotes) {
        notesArr.push(rule.legalApplicabilityNotes);
      }
    }

    // Remove required docs from optional set
    for (const reqDoc of requiredDocsSet) {
      optionalDocsSet.delete(reqDoc);
    }

    return {
      requiredDocumentTypes: Array.from(requiredDocsSet),
      optionalDocumentTypes: Array.from(optionalDocsSet),
      requiredSkillCategories: requiredSkillsSet.size > 0 ? Array.from(requiredSkillsSet) : undefined,
      legalApplicabilityNotes: notesArr.length > 0 ? notesArr.join('; ') : undefined,
    };
  }
}

// ============================================================================
// Worker KYC Validation Service
// ============================================================================

export class WorkerKycValidationService {
  constructor(
    private policyProvider: IWorkerKycPolicyProvider = new DefaultWorkerKycPolicyProvider(),
    private documentRepo?: WorkerDocumentRepository,
    private skillRepo?: WorkerSkillRepository,
    private profileRepo?: WorkerProfileRepository
  ) {}

  public getPolicyProvider(): IWorkerKycPolicyProvider {
    return this.policyProvider;
  }

  public setPolicyProvider(provider: IWorkerKycPolicyProvider): void {
    this.policyProvider = provider;
  }

  /**
   * Validates whether a worker meets all applicable KYC policy requirements.
   *
   * Core Security Invariants:
   * 1. Fail-closed: Fails immediately if policy provider is missing, invalid, unavailable, or throws.
   * 2. Anti-bypass evaluation: For each required document type, strictly evaluates ONLY the latest
   *    document (sorted deterministically by uploadedAt DESC, then id DESC).
   *    A PENDING, REJECTED, EXPIRED, or invalid replacement blocks KYC and NEVER falls back to an older verified document.
   * 3. Zero-grace-period calendar expiry: Evaluated strictly in Asia/Kolkata timezone via DateUtil.
   *    Documents expire at 00:00:00.000 IST following their expiry calendar date.
   * 4. 15-day warning: Flagged when a verified document is within 15 calendar days of expiry.
   * 5. Verified skill requirements: Evaluates mandatory trade skills where required by policy or worker type.
   * 6. Safe reporting: Never exposes physical file paths or storage keys in validation results.
   */
  public async validateForApproval(
    worker: WorkerProfileForValidation = {},
    documents: WorkerDocumentRecord[] = [],
    skills: WorkerSkillRecord[] = [],
    policyParams: WorkerKycPolicyParams = {},
    referenceDate: Date = new Date()
  ): Promise<WorkerKycValidationResult> {
    const missingDocuments: string[] = [];
    const unverifiedDocuments: string[] = [];
    const expiredDocuments: string[] = [];
    const expiringSoonDocuments: string[] = [];
    const missingSkills: string[] = [];
    const unverifiedSkills: string[] = [];
    const reasons: string[] = [];
    const documentWarnings: WorkerDocumentWarning[] = [];

    // -------------------------------------------------------------------------
    // 1. Mandatory Safeguard: Fail-closed if policy provider is missing or invalid
    // -------------------------------------------------------------------------
    if (!this.policyProvider || typeof this.policyProvider.getRulesForWorker !== 'function') {
      logger.error('[Worker KYC Validation] Policy provider missing or invalid. Failing closed.');
      return {
        isValid: false,
        missingDocuments: [],
        unverifiedDocuments: [],
        expiredDocuments: [],
        expiringSoonDocuments: [],
        missingSkills: [],
        unverifiedSkills: [],
        reasons: ['Worker KYC policy provider unavailable: Security gate fail-closed.'],
        documentWarnings: [],
      };
    }

    let policy: WorkerKycRule | null | undefined;
    try {
      const mergedParams: WorkerKycPolicyParams = {
        workerType: worker.workerType || policyParams.workerType,
        cityId: worker.primaryCityId || policyParams.cityId,
        ...policyParams,
      };
      policy = await this.policyProvider.getRulesForWorker(mergedParams);
    } catch (err: any) {
      logger.error('[Worker KYC Validation] Policy provider threw an error. Failing closed.', err);
      return {
        isValid: false,
        missingDocuments: [],
        unverifiedDocuments: [],
        expiredDocuments: [],
        expiringSoonDocuments: [],
        missingSkills: [],
        unverifiedSkills: [],
        reasons: ['Worker KYC policy retrieval failed: Security gate fail-closed.'],
        documentWarnings: [],
      };
    }

    if (!policy || !Array.isArray(policy.requiredDocumentTypes)) {
      logger.error('[Worker KYC Validation] Retrieved invalid or null policy. Failing closed.');
      return {
        isValid: false,
        missingDocuments: [],
        unverifiedDocuments: [],
        expiredDocuments: [],
        expiringSoonDocuments: [],
        missingSkills: [],
        unverifiedSkills: [],
        reasons: ['Invalid or missing worker KYC policy specification: Security gate fail-closed.'],
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
        missingDocuments.push(normalizedReqType);
        reasons.push(`Mandatory worker document missing: ${normalizedReqType}`);
        continue;
      }

      // Sort matching documents deterministically: uploadedAt DESC, then id DESC
      const sortedDocs = [...matchingDocs].sort((a, b) => {
        const timeA = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
        const timeB = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
        if (timeB !== timeA) {
          return timeB - timeA; // Descending by upload time
        }
        // Deterministic tie-breaker by ID
        const idA = a.id ? BigInt(a.id) : 0n;
        const idB = b.id ? BigInt(b.id) : 0n;
        return idB > idA ? 1 : idB < idA ? -1 : 0;
      });

      const latestDoc = sortedDocs[0];
      const status = (latestDoc.verificationStatus || '').trim().toUpperCase();

      // Anti-Bypass Rule: Evaluate ONLY the latest document.
      // If latest document is PENDING, REJECTED, or invalid, fail validation immediately.
      // NEVER fall back to older verified documents.
      if (status !== 'VERIFIED') {
        unverifiedDocuments.push(normalizedReqType);
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
        expiredDocuments.push(normalizedReqType);
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
          expiringSoonDocuments.push(normalizedReqType);
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
    // 3. Evaluate Required Skills (Trade / Category Verification)
    // -------------------------------------------------------------------------
    if (policy.requiredSkillCategories && policy.requiredSkillCategories.length > 0) {
      for (const reqSkill of policy.requiredSkillCategories) {
        const reqStr = String(reqSkill).trim().toUpperCase();

        // Match skill by category code or category ID
        const matchedSkill = skills.find((s) => {
          if (s.isActive === false) return false;
          const catIdStr = String(s.serviceCategoryId);
          const catCodeStr = s.serviceCategoryCode ? s.serviceCategoryCode.trim().toUpperCase() : '';
          return catIdStr === reqStr || catCodeStr === reqStr;
        });

        if (!matchedSkill) {
          missingSkills.push(reqStr);
          reasons.push(`Required skill category '${reqStr}' is missing.`);
          continue;
        }

        const skillStatus = (matchedSkill.verificationStatus || '').trim().toUpperCase();
        if (skillStatus !== 'VERIFIED') {
          unverifiedSkills.push(reqStr);
          reasons.push(
            `Required skill category '${reqStr}' is not verified (status: ${skillStatus || 'UNKNOWN'})`
          );
        }
      }
    }

    // -------------------------------------------------------------------------
    // 4. Overall Eligibility Outcome
    // -------------------------------------------------------------------------
    const isValid =
      missingDocuments.length === 0 &&
      unverifiedDocuments.length === 0 &&
      expiredDocuments.length === 0 &&
      missingSkills.length === 0 &&
      unverifiedSkills.length === 0;

    return {
      isValid,
      missingDocuments,
      unverifiedDocuments,
      expiredDocuments,
      expiringSoonDocuments,
      missingSkills,
      unverifiedSkills,
      reasons,
      documentWarnings,
    };
  }

  /**
   * Orchestration helper that fetches real database records using worker repositories
   * and evaluates eligibility. Database access remains isolated inside repositories.
   */
  public async validateWorkerWithRepository(
    workerId: bigint,
    policyParams: WorkerKycPolicyParams = {},
    tx?: Prisma.TransactionClient,
    referenceDate: Date = new Date()
  ): Promise<WorkerKycValidationResult> {
    if (!this.profileRepo || !this.documentRepo || !this.skillRepo) {
      throw new Error('Repositories must be provided to use validateWorkerWithRepository');
    }

    const profile = await this.profileRepo.findById(workerId, tx);
    if (!profile) {
      return {
        isValid: false,
        missingDocuments: [],
        unverifiedDocuments: [],
        expiredDocuments: [],
        expiringSoonDocuments: [],
        missingSkills: [],
        unverifiedSkills: [],
        reasons: [`Worker profile with ID ${workerId.toString()} not found`],
        documentWarnings: [],
      };
    }

    const [documents, skills] = await Promise.all([
      this.documentRepo.findByWorkerId(workerId, tx),
      this.skillRepo.findByWorkerId(workerId, tx),
    ]);

    const docRecords: WorkerDocumentRecord[] = documents.map((d) => ({
      id: d.id,
      workerId: d.workerId,
      documentType: d.documentType,
      documentStorageKey: d.documentStorageKey,
      expiryDate: d.expiryDate,
      verificationStatus: d.verificationStatus,
      rejectionReason: d.rejectionReason,
      uploadedAt: d.uploadedAt,
      reviewedBy: d.reviewedBy,
      reviewedAt: d.reviewedAt,
    }));

    const skillRecords: WorkerSkillRecord[] = skills.map((s: any) => ({
      id: s.id,
      workerId: s.workerId,
      serviceCategoryId: s.serviceCategoryId,
      serviceCategoryCode: s.serviceCategory?.categoryCode,
      serviceCategoryName: s.serviceCategory?.categoryName,
      experienceYears: s.experienceYears,
      verificationStatus: s.verificationStatus,
      rejectionReason: s.rejectionReason,
      isActive: s.isActive,
    }));

    return this.validateForApproval(
      {
        id: profile.id,
        workerType: profile.workerType,
        primaryCityId: profile.primaryCityId,
        approvalStatus: profile.approvalStatus,
        submissionStatus: profile.submissionStatus,
        isSuspended: !!profile.suspendedAt,
        suspendedAt: profile.suspendedAt,
        suspensionReason: profile.suspensionReason,
      },
      docRecords,
      skillRecords,
      policyParams,
      referenceDate
    );
  }
}

// Default singleton exports
export const defaultWorkerKycPolicyProvider = new DefaultWorkerKycPolicyProvider();
export const workerKycValidationService = new WorkerKycValidationService(
  defaultWorkerKycPolicyProvider,
  new WorkerDocumentRepository(),
  new WorkerSkillRepository(),
  new WorkerProfileRepository()
);
