import { logger } from '../../../config/logger.config';
import { DateUtil, CalendarExpiryEvaluation } from '../../../common/utils/date.util';
import { WorkerDocumentRepository } from '../repositories/worker-document.repository';
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import { WorkerSkillRepository } from '../repositories/worker-skill.repository';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface WorkerKycRule {
  /** Document types strictly required for worker approval/eligibility */
  requiredDocumentTypes: string[];
  /** Optional document types (presence/rejection does not block approval unless made mandatory) */
  optionalDocumentTypes?: string[];
  /** Required verified skills (category codes or service category IDs) */
  requiredVerifiedSkillCategories?: (string | bigint)[];
  /** Minimum required years of experience */
  minExperienceYears?: number;
  /** Whether police verification certificate is required */
  requiresPoliceVerification?: boolean;
  /** Whether skill / trade certificate is required */
  requiresSkillCertificate?: boolean;
  /** Whether medical certificate / fitness is required */
  requiresMedicalFitness?: boolean;
  /** Worker type this rule targets */
  workerType?: string;
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
  serviceCategory?: {
    id?: bigint | string | number;
    categoryCode?: string;
    categoryName?: string;
  } | null;
  experienceYears?: number;
  verificationStatus: string;
  rejectionReason?: string | null;
  isActive?: boolean;
}

export interface WorkerProfileForValidation {
  id?: bigint | string | number;
  workerType?: string | null;
  experienceYears?: number | null;
  primaryCityId?: bigint | string | number | null;
  approvalStatus?: string | null;
  submissionStatus?: string | null;
  isSuspended?: boolean | null;
  suspendedAt?: Date | string | null;
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
  missingTypes: string[];
  unverifiedTypes: string[];
  expiredTypes: string[];
  expiringSoonTypes: string[];
  missingSkills: string[];
  unverifiedSkills: string[];
  experienceShortfall?: number;
  reasons: string[];
  documentWarnings: WorkerDocumentWarning[];
}

export interface WorkerKycPolicyParams {
  workerType?: string;
  serviceCategoryCode?: string;
  serviceCategoryId?: bigint | string;
  jurisdiction?: string;
  [key: string]: any;
}

export interface IWorkerKycPolicyProvider {
  /**
   * Retrieves KYC requirements for a worker based on worker type, service category, and legal context.
   * Fails closed by returning null or throwing if policy configuration is missing or invalid.
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
 * 2. Service Category (e.g. ELECTRICAL, PLUMBING, APPLIANCE_REPAIR)
 * 3. Jurisdiction / City (e.g. BENGALURU, MUMBAI, DELHI)
 * 4. Composite criteria (Worker Type + Service Category or Jurisdiction)
 * 5. Document Type requirements (Required vs Optional)
 *
 * Conflict Resolution:
 * When multiple policies match (e.g. workerType + serviceCategory + jurisdiction),
 * they are merged by applying the MOST RESTRICTIVE MANDATORY REQUIREMENTS:
 * - Union of all required document types
 * - Union of all required verified skills
 * - Maximum of minExperienceYears
 * - Union of boolean requirement flags (police verification, skill certificate, medical fitness)
 */
export class DefaultWorkerKycPolicyProvider implements IWorkerKycPolicyProvider {
  private rulesByWorkerType = new Map<string, WorkerKycRule>();
  private rulesByServiceCategory = new Map<string, WorkerKycRule>();
  private rulesByJurisdiction = new Map<string, WorkerKycRule>();
  private rulesByCompositeKey = new Map<string, WorkerKycRule>();
  private defaultRule: WorkerKycRule | null = null;

  constructor() {
    this.resetToDefault();
  }

  public setWorkerTypeRule(workerType: string, rule: WorkerKycRule): void {
    this.rulesByWorkerType.set(workerType.trim().toUpperCase(), rule);
  }

  public setServiceCategoryRule(category: string, rule: WorkerKycRule): void {
    this.rulesByServiceCategory.set(category.trim().toUpperCase(), rule);
  }

  public setJurisdictionRule(jurisdiction: string, rule: WorkerKycRule): void {
    this.rulesByJurisdiction.set(jurisdiction.trim().toUpperCase(), rule);
  }

  public setCompositeRule(compositeKey: string, rule: WorkerKycRule): void {
    this.rulesByCompositeKey.set(compositeKey.trim().toUpperCase(), rule);
  }

  public setDefaultRule(rule: WorkerKycRule | null): void {
    this.defaultRule = rule;
  }

  public removeRule(
    type: 'workerType' | 'serviceCategory' | 'jurisdiction' | 'composite',
    key: string
  ): void {
    const k = key.trim().toUpperCase();
    switch (type) {
      case 'workerType':
        this.rulesByWorkerType.delete(k);
        break;
      case 'serviceCategory':
        this.rulesByServiceCategory.delete(k);
        break;
      case 'jurisdiction':
        this.rulesByJurisdiction.delete(k);
        break;
      case 'composite':
        this.rulesByCompositeKey.delete(k);
        break;
    }
  }

  public clearRules(): void {
    this.rulesByWorkerType.clear();
    this.rulesByServiceCategory.clear();
    this.rulesByJurisdiction.clear();
    this.rulesByCompositeKey.clear();
    this.defaultRule = null;
  }

  /**
   * Resets the policy registry to standard production baselines.
   */
  public resetToDefault(): void {
    this.rulesByWorkerType.clear();
    this.rulesByServiceCategory.clear();
    this.rulesByJurisdiction.clear();
    this.rulesByCompositeKey.clear();

    // Default baseline for general worker registration (when no worker type is specified)
    this.defaultRule = {
      requiredDocumentTypes: ['IDENTITY_PROOF', 'PROFILE_PHOTO'],
      optionalDocumentTypes: ['POLICE_VERIFICATION', 'ADDRESS_PROOF', 'SKILL_CERTIFICATE'],
      minExperienceYears: 0,
      legalApplicabilityNotes: 'General baseline requirements for marketplace worker profile registration.',
    };

    // 1. HELPER (Unskilled / General manual assistance)
    this.rulesByWorkerType.set('HELPER', {
      requiredDocumentTypes: ['IDENTITY_PROOF', 'PROFILE_PHOTO'],
      optionalDocumentTypes: ['POLICE_VERIFICATION', 'ADDRESS_PROOF', 'MEDICAL_FITNESS'],
      minExperienceYears: 0,
      legalApplicabilityNotes: 'Helper baseline: Identity proof and profile photo.',
    });

    // 2. TECHNICIAN (Skilled trades: Electrician, Plumber, Appliance repair)
    this.rulesByWorkerType.set('TECHNICIAN', {
      requiredDocumentTypes: ['IDENTITY_PROOF', 'PROFILE_PHOTO', 'SKILL_CERTIFICATE', 'POLICE_VERIFICATION'],
      optionalDocumentTypes: ['ADDRESS_PROOF', 'MEDICAL_FITNESS'],
      minExperienceYears: 1,
      requiresSkillCertificate: true,
      requiresPoliceVerification: true,
      legalApplicabilityNotes: 'Technician baseline: Identity, photo, skill certificate, and police verification with min 1 yr experience.',
    });

    // 3. SPECIALIST (Master trades / High liability / Commercial services)
    this.rulesByWorkerType.set('SPECIALIST', {
      requiredDocumentTypes: ['IDENTITY_PROOF', 'PROFILE_PHOTO', 'SKILL_CERTIFICATE', 'POLICE_VERIFICATION', 'MEDICAL_FITNESS'],
      optionalDocumentTypes: ['ADDRESS_PROOF'],
      minExperienceYears: 3,
      requiresSkillCertificate: true,
      requiresPoliceVerification: true,
      requiresMedicalFitness: true,
      legalApplicabilityNotes: 'Specialist baseline: Identity, photo, skill certificate, police verification, medical fitness, min 3 yrs experience.',
    });
  }

  /**
   * Retrieves KYC requirements based on worker evaluation context.
   * Merges multiple matching rules into the most restrictive mandatory policy.
   * Fails closed by returning null if no rule applies and default rule is null/missing.
   */
  public async getRulesForWorker(
    params: WorkerKycPolicyParams
  ): Promise<WorkerKycRule | null | undefined> {
    if (!params) {
      return this.defaultRule;
    }

    const matchingRules: WorkerKycRule[] = [];
    const { workerType, serviceCategoryCode, jurisdiction } = params;

    const normWorkerType = workerType ? workerType.trim().toUpperCase() : undefined;
    const normCategory = serviceCategoryCode ? serviceCategoryCode.trim().toUpperCase() : undefined;
    const normJurisdiction = jurisdiction ? jurisdiction.trim().toUpperCase() : undefined;

    // 1. Check Jurisdiction Composite Override (e.g. JURISDICTION:BENGALURU:TECHNICIAN)
    if (normJurisdiction && normWorkerType) {
      const jurWorkerKey = `JURISDICTION:${normJurisdiction}:${normWorkerType}`;
      if (this.rulesByCompositeKey.has(jurWorkerKey)) {
        matchingRules.push(this.rulesByCompositeKey.get(jurWorkerKey)!);
      }
    }

    // 2. Check Service Category + Worker Type Composite Rule (e.g. TECHNICIAN:ELECTRICAL)
    if (normWorkerType && normCategory) {
      const compKey = `${normWorkerType}:${normCategory}`;
      if (this.rulesByCompositeKey.has(compKey)) {
        matchingRules.push(this.rulesByCompositeKey.get(compKey)!);
      }
    }

    // 3. Check Jurisdiction Rule (standalone)
    if (normJurisdiction && this.rulesByJurisdiction.has(normJurisdiction)) {
      matchingRules.push(this.rulesByJurisdiction.get(normJurisdiction)!);
    }

    // 4. Check Service Category Rule (standalone)
    if (normCategory && this.rulesByServiceCategory.has(normCategory)) {
      matchingRules.push(this.rulesByServiceCategory.get(normCategory)!);
    }

    // 5. Check Worker Type Rule (standalone)
    if (normWorkerType && this.rulesByWorkerType.has(normWorkerType)) {
      matchingRules.push(this.rulesByWorkerType.get(normWorkerType)!);
    }

    // If no specific rules matched, fall back to defaultRule (or null if fail-closed)
    if (matchingRules.length === 0) {
      return this.defaultRule;
    }

    // If only one rule matched, return it directly
    if (matchingRules.length === 1) {
      return matchingRules[0];
    }

    // Merge multiple rules by applying the MOST RESTRICTIVE MANDATORY REQUIREMENTS
    const requiredDocs = new Set<string>();
    const optionalDocs = new Set<string>();
    const requiredSkills = new Set<string | bigint>();
    let maxExp = 0;
    let reqPolice = false;
    let reqSkillCert = false;
    let reqMedical = false;
    const notes: string[] = [];

    for (const rule of matchingRules) {
      if (rule.requiredDocumentTypes) {
        rule.requiredDocumentTypes.forEach((doc) => requiredDocs.add(doc.trim().toUpperCase()));
      }
      if (rule.optionalDocumentTypes) {
        rule.optionalDocumentTypes.forEach((doc) => optionalDocs.add(doc.trim().toUpperCase()));
      }
      if (rule.requiredVerifiedSkillCategories) {
        rule.requiredVerifiedSkillCategories.forEach((sc) => requiredSkills.add(sc));
      }
      if (rule.minExperienceYears && rule.minExperienceYears > maxExp) {
        maxExp = rule.minExperienceYears;
      }
      if (rule.requiresPoliceVerification) {
        reqPolice = true;
      }
      if (rule.requiresSkillCertificate) {
        reqSkillCert = true;
      }
      if (rule.requiresMedicalFitness) {
        reqMedical = true;
      }
      if (rule.legalApplicabilityNotes) {
        notes.push(rule.legalApplicabilityNotes);
      }
    }

    // Enforce boolean flags into required documents
    if (reqPolice) {
      requiredDocs.add('POLICE_VERIFICATION');
    }
    if (reqSkillCert) {
      requiredDocs.add('SKILL_CERTIFICATE');
    }
    if (reqMedical) {
      requiredDocs.add('MEDICAL_FITNESS');
    }

    // Filter optionalDocs to exclude any docs that have become mandatory
    const finalOptionalDocs = Array.from(optionalDocs).filter((doc) => !requiredDocs.has(doc));

    return {
      requiredDocumentTypes: Array.from(requiredDocs),
      optionalDocumentTypes: finalOptionalDocs,
      requiredVerifiedSkillCategories: Array.from(requiredSkills),
      minExperienceYears: maxExp,
      requiresPoliceVerification: reqPolice,
      requiresSkillCertificate: reqSkillCert,
      requiresMedicalFitness: reqMedical,
      legalApplicabilityNotes: notes.join(' | '),
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
    private profileRepo?: WorkerProfileRepository,
    private skillRepo?: WorkerSkillRepository
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
   * 1. Fail-closed: Fails immediately if policy provider is missing, throws, or returns invalid/null policy.
   * 2. Anti-bypass evaluation: For each required document type, strictly evaluates ONLY the latest
   *    document (sorted by uploadedAt DESC / id DESC). A PENDING, REJECTED, or EXPIRED replacement
   *    does NOT fall back to an older verified document.
   * 3. Zero-grace-period calendar expiry: Evaluated strictly in Asia/Kolkata timezone via DateUtil.
   *    Documents expire at 00:00:00.000 IST following their expiry calendar date.
   * 4. 15-day warning: Flagged when a verified document is within 15 calendar days of expiry.
   * 5. Skill & Qualification Validation: Validates required verified skills matching service category.
   * 6. Multi-policy conflict resolution: Applies the most restrictive mandatory requirements.
   */
  public async validateForApproval(
    worker: WorkerProfileForValidation = {},
    documents: WorkerDocumentRecord[] = [],
    skills: WorkerSkillRecord[] = [],
    policyParams: WorkerKycPolicyParams = {},
    referenceDate: Date = new Date()
  ): Promise<WorkerKycValidationResult> {
    const missingTypes: string[] = [];
    const unverifiedTypes: string[] = [];
    const expiredTypes: string[] = [];
    const expiringSoonTypes: string[] = [];
    const missingSkills: string[] = [];
    const unverifiedSkills: string[] = [];
    const reasons: string[] = [];
    const documentWarnings: WorkerDocumentWarning[] = [];
    let experienceShortfall: number | undefined = undefined;

    // -------------------------------------------------------------------------
    // 1. Mandatory Safeguard: Fail-closed if policy provider is missing or invalid
    // -------------------------------------------------------------------------
    if (!this.policyProvider || typeof this.policyProvider.getRulesForWorker !== 'function') {
      logger.error('[Worker KYC Validation] Policy provider missing or invalid. Failing closed.');
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        expiringSoonTypes: [],
        missingSkills: [],
        unverifiedSkills: [],
        reasons: ['Worker KYC policy provider unavailable: Security gate fail-closed.'],
        documentWarnings: [],
      };
    }

    let policy: WorkerKycRule | null | undefined;
    try {
      // Merge workerType from profile if not explicitly passed
      const mergedParams: WorkerKycPolicyParams = {
        workerType: policyParams.workerType || worker.workerType || undefined,
        ...policyParams,
      };
      policy = await this.policyProvider.getRulesForWorker(mergedParams);
    } catch (err: any) {
      logger.error('[Worker KYC Validation] Policy provider threw an error. Failing closed.', err);
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        expiringSoonTypes: [],
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
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        expiringSoonTypes: [],
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
          return (
            dt === 'IDENTITY_PROOF' ||
            dt === 'AADHAAR' ||
            dt === 'PAN' ||
            dt === 'VOTER_ID' ||
            dt === 'PASSPORT'
          );
        }
        if (normalizedReqType === 'AADHAAR') {
          return dt === 'AADHAAR' || dt === 'IDENTITY_PROOF';
        }
        return dt === normalizedReqType;
      });

      if (matchingDocs.length === 0) {
        missingTypes.push(normalizedReqType);
        reasons.push(`Mandatory worker document missing: ${normalizedReqType}`);
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
        const idA = a.id !== undefined && a.id !== null ? BigInt(a.id) : 0n;
        const idB = b.id !== undefined && b.id !== null ? BigInt(b.id) : 0n;
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
          } (Asia/Kolkata timezone)`
        );
      } else if (expiryEval.isExpiringSoon) {
        expiringSoonTypes.push(normalizedReqType);
        documentWarnings.push({
          documentType: normalizedReqType,
          warning: 'DOCUMENT_EXPIRING_SOON',
          daysRemaining: expiryEval.daysRemaining,
          expiryDate: expiryEval.formattedExpiry,
        });
      }
    }

    // -------------------------------------------------------------------------
    // 3. Evaluate Required Skills & Qualifications
    // -------------------------------------------------------------------------
    if (
      policy.requiredVerifiedSkillCategories &&
      Array.isArray(policy.requiredVerifiedSkillCategories) &&
      policy.requiredVerifiedSkillCategories.length > 0
    ) {
      for (const requiredCat of policy.requiredVerifiedSkillCategories) {
        const reqStr = requiredCat.toString().trim().toUpperCase();

        // Match against worker skills by category ID or category code
        const matchingSkill = skills.find((s) => {
          if (s.serviceCategoryId && s.serviceCategoryId.toString() === requiredCat.toString()) {
            return true;
          }
          if (
            s.serviceCategory?.categoryCode &&
            s.serviceCategory.categoryCode.trim().toUpperCase() === reqStr
          ) {
            return true;
          }
          return false;
        });

        if (!matchingSkill) {
          missingSkills.push(reqStr);
          reasons.push(`Required skill category '${reqStr}' is not added to worker profile.`);
          continue;
        }

        const skillStatus = (matchingSkill.verificationStatus || '').trim().toUpperCase();
        if (skillStatus !== 'VERIFIED') {
          unverifiedSkills.push(reqStr);
          reasons.push(
            `Required skill category '${reqStr}' is not verified (status: ${skillStatus || 'PENDING'}).`
          );
        }
      }
    }

    // -------------------------------------------------------------------------
    // 4. Evaluate Minimum Experience Requirement
    // -------------------------------------------------------------------------
    if (policy.minExperienceYears && policy.minExperienceYears > 0) {
      const expYears = worker.experienceYears ?? 0;
      if (expYears < policy.minExperienceYears) {
        experienceShortfall = policy.minExperienceYears - expYears;
        reasons.push(
          `Worker has ${expYears} year(s) of experience, but minimum required is ${policy.minExperienceYears} year(s) (${experienceShortfall} year(s) shortfall).`
        );
      }
    }

    // -------------------------------------------------------------------------
    // 5. Overall Validity Conclusion
    // -------------------------------------------------------------------------
    const isValid =
      missingTypes.length === 0 &&
      unverifiedTypes.length === 0 &&
      expiredTypes.length === 0 &&
      missingSkills.length === 0 &&
      unverifiedSkills.length === 0 &&
      (experienceShortfall === undefined || experienceShortfall <= 0);

    return {
      isValid,
      missingTypes,
      unverifiedTypes,
      expiredTypes,
      expiringSoonTypes,
      missingSkills,
      unverifiedSkills,
      experienceShortfall,
      reasons,
      documentWarnings,
    };
  }

  /**
   * Convenience helper: Validates a worker using database repositories.
   * Strictly avoids leaking raw file storage paths or sensitive tokens.
   */
  public async validateWorkerWithRepository(
    workerIdInput: bigint | string | number,
    policyParams: WorkerKycPolicyParams = {},
    referenceDate: Date = new Date()
  ): Promise<WorkerKycValidationResult> {
    const workerId = BigInt(workerIdInput);

    const docRepo = this.documentRepo || new WorkerDocumentRepository();
    const profRepo = this.profileRepo || new WorkerProfileRepository();
    const skillRepo = this.skillRepo || new WorkerSkillRepository();

    const [worker, documents, skills] = await Promise.all([
      profRepo.findById(workerId),
      docRepo.findByWorkerId(workerId),
      skillRepo.findByWorkerId(workerId),
    ]);

    if (!worker) {
      return {
        isValid: false,
        missingTypes: [],
        unverifiedTypes: [],
        expiredTypes: [],
        expiringSoonTypes: [],
        missingSkills: [],
        unverifiedSkills: [],
        reasons: [`Worker profile with ID ${workerId.toString()} not found.`],
        documentWarnings: [],
      };
    }

    return this.validateForApproval(
      worker,
      documents,
      skills,
      policyParams,
      referenceDate
    );
  }
}

// Default singleton export
export const workerKycValidationService = new WorkerKycValidationService();
