import {
  DefaultWorkerKycPolicyProvider,
  WorkerKycValidationService,
  WorkerKycRule,
  WorkerDocumentRecord,
  WorkerSkillRecord,
  IWorkerKycPolicyProvider,
} from '../src/modules/workers/services/worker-kyc.service';
import { DateUtil } from '../src/common/utils/date.util';

describe('Phase 6E Batch 2: Worker KYC Policy & Validation Service', () => {
  let policyProvider: DefaultWorkerKycPolicyProvider;
  let validationService: WorkerKycValidationService;

  beforeEach(() => {
    policyProvider = new DefaultWorkerKycPolicyProvider();
    validationService = new WorkerKycValidationService(policyProvider);
  });

  // ==========================================================================
  // 1. Policy Provider Configuration & Multi-Dimension Mappings
  // ==========================================================================
  describe('1. Policy Provider & Dimension Mappings', () => {
    it('should return baseline default rules when no params specified', async () => {
      const rule = await policyProvider.getRulesForWorker({});
      expect(rule).toBeDefined();
      expect(rule?.requiredDocumentTypes).toContain('IDENTITY_PROOF');
      expect(rule?.optionalDocumentTypes).toEqual(
        expect.arrayContaining(['POLICE_VERIFICATION', 'ADDRESS_PROOF', 'MEDICAL_FITNESS'])
      );
    });

    it('should configure HELPER requiring IDENTITY_PROOF', async () => {
      const rule = await policyProvider.getRulesForWorker({ workerType: 'HELPER' });
      expect(rule).toBeDefined();
      expect(rule?.requiredDocumentTypes).toEqual(['IDENTITY_PROOF']);
      expect(rule?.optionalDocumentTypes).toEqual(
        expect.arrayContaining(['POLICE_VERIFICATION', 'ADDRESS_PROOF', 'MEDICAL_FITNESS'])
      );
    });

    it('should configure TECHNICIAN requiring IDENTITY_PROOF and SKILL_CERTIFICATE', async () => {
      const rule = await policyProvider.getRulesForWorker({ workerType: 'TECHNICIAN' });
      expect(rule).toBeDefined();
      expect(rule?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['IDENTITY_PROOF', 'SKILL_CERTIFICATE'])
      );
    });

    it('should configure SPECIALIST requiring IDENTITY_PROOF, SKILL_CERTIFICATE, and POLICE_VERIFICATION', async () => {
      const rule = await policyProvider.getRulesForWorker({ workerType: 'SPECIALIST' });
      expect(rule).toBeDefined();
      expect(rule?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['IDENTITY_PROOF', 'SKILL_CERTIFICATE', 'POLICE_VERIFICATION'])
      );
    });

    it('should support category-specific rules', async () => {
      policyProvider.setCategoryRule('HAZARDOUS_ELECTRICAL', {
        requiredDocumentTypes: ['IDENTITY_PROOF', 'SKILL_CERTIFICATE', 'MEDICAL_FITNESS'],
        legalApplicabilityNotes: 'Mandatory medical fitness for high-voltage works',
      });

      const rule = await policyProvider.getRulesForWorker({
        serviceCategoryCode: 'HAZARDOUS_ELECTRICAL',
      });
      expect(rule).toBeDefined();
      expect(rule?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['IDENTITY_PROOF', 'SKILL_CERTIFICATE', 'MEDICAL_FITNESS'])
      );
    });

    it('should support jurisdiction-specific rules', async () => {
      policyProvider.setJurisdictionRule('MUMBAI', {
        requiredDocumentTypes: ['IDENTITY_PROOF', 'POLICE_VERIFICATION', 'ADDRESS_PROOF'],
        legalApplicabilityNotes: 'Municipal mandate requiring local police verification and address proof',
      });

      const rule = await policyProvider.getRulesForWorker({
        jurisdiction: 'MUMBAI',
      });
      expect(rule).toBeDefined();
      expect(rule?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['IDENTITY_PROOF', 'POLICE_VERIFICATION', 'ADDRESS_PROOF'])
      );
    });

    it('should support composite rules (WorkerType + Category)', async () => {
      policyProvider.setCompositeRule('TECHNICIAN', 'PLUMBING', {
        requiredDocumentTypes: ['IDENTITY_PROOF', 'SKILL_CERTIFICATE'],
        requiredSkillCategories: ['PLUMBING'],
        legalApplicabilityNotes: 'Plumbing technician trade certification mandate',
      });

      const rule = await policyProvider.getRulesForWorker({
        workerType: 'TECHNICIAN',
        serviceCategoryCode: 'PLUMBING',
      });
      expect(rule).toBeDefined();
      expect(rule?.requiredDocumentTypes).toEqual(
        expect.arrayContaining(['IDENTITY_PROOF', 'SKILL_CERTIFICATE'])
      );
      expect(rule?.requiredSkillCategories).toContain('PLUMBING');
    });

    it('should apply MOST RESTRICTIVE mandatory requirement when multiple policies conflict', async () => {
      // Helper alone requires IDENTITY_PROOF
      // Mumbai jurisdiction requires POLICE_VERIFICATION, ADDRESS_PROOF
      // Electrical category requires SKILL_CERTIFICATE, MEDICAL_FITNESS
      policyProvider.setJurisdictionRule('MUMBAI', {
        requiredDocumentTypes: ['POLICE_VERIFICATION', 'ADDRESS_PROOF'],
      });
      policyProvider.setCategoryRule('ELECTRICAL', {
        requiredDocumentTypes: ['SKILL_CERTIFICATE', 'MEDICAL_FITNESS'],
        requiredSkillCategories: ['ELECTRICAL'],
      });

      const combined = await policyProvider.getRulesForWorker({
        workerType: 'HELPER',
        jurisdiction: 'MUMBAI',
        serviceCategoryCode: 'ELECTRICAL',
      });

      expect(combined).toBeDefined();
      // Should be union of all mandatory document types
      expect(combined?.requiredDocumentTypes).toEqual(
        expect.arrayContaining([
          'IDENTITY_PROOF',
          'POLICE_VERIFICATION',
          'ADDRESS_PROOF',
          'SKILL_CERTIFICATE',
          'MEDICAL_FITNESS',
        ])
      );
      // Required skill categories should be combined
      expect(combined?.requiredSkillCategories).toContain('ELECTRICAL');
    });
  });

  // ==========================================================================
  // 2. Fail-Closed Security Invariants
  // ==========================================================================
  describe('2. Fail-Closed Security Invariants', () => {
    it('should fail closed when policy provider is missing or null', async () => {
      const invalidService = new WorkerKycValidationService(null as any);
      const res = await invalidService.validateForApproval({}, []);

      expect(res.isValid).toBe(false);
      expect(res.reasons.length).toBeGreaterThan(0);
      expect(res.reasons[0]).toContain('fail-closed');
    });

    it('should fail closed when policy provider throws an exception', async () => {
      const throwingProvider: IWorkerKycPolicyProvider = {
        getRulesForWorker: jest.fn().mockRejectedValue(new Error('Database connection down')),
      };
      const throwingService = new WorkerKycValidationService(throwingProvider);
      const res = await throwingService.validateForApproval({}, []);

      expect(res.isValid).toBe(false);
      expect(res.reasons[0]).toContain('fail-closed');
      expect(res.reasons[0]).not.toContain('Database connection down'); // No internal error leaks
    });

    it('should fail closed when policy provider returns null (no rule found and no default)', async () => {
      policyProvider.clearRules(); // Nullifies all rules and defaultRule
      const res = await validationService.validateForApproval({}, []);

      expect(res.isValid).toBe(false);
      expect(res.reasons[0]).toContain('fail-closed');
    });

    it('should fail closed when policy configuration is malformed or invalid', async () => {
      const malformedProvider: IWorkerKycPolicyProvider = {
        getRulesForWorker: jest.fn().mockResolvedValue({
          requiredDocumentTypes: 'NOT_AN_ARRAY' as any,
        }),
      };
      const brokenService = new WorkerKycValidationService(malformedProvider);
      const res = await brokenService.validateForApproval({}, []);

      expect(res.isValid).toBe(false);
      expect(res.reasons[0]).toContain('fail-closed');
    });
  });

  // ==========================================================================
  // 3. Document Requirements & Deterministic Ordering
  // ==========================================================================
  describe('3. Document Validation & Anti-Bypass Gate', () => {
    it('should report missing mandatory documents', async () => {
      policyProvider.setWorkerTypeRule('TECHNICIAN', {
        requiredDocumentTypes: ['IDENTITY_PROOF', 'SKILL_CERTIFICATE'],
      });

      const res = await validationService.validateForApproval(
        { workerType: 'TECHNICIAN' },
        [] // No documents uploaded
      );

      expect(res.isValid).toBe(false);
      expect(res.missingDocuments).toEqual(
        expect.arrayContaining(['IDENTITY_PROOF', 'SKILL_CERTIFICATE'])
      );
      expect(res.reasons).toEqual(
        expect.arrayContaining([
          'Mandatory worker document missing: IDENTITY_PROOF',
          'Mandatory worker document missing: SKILL_CERTIFICATE',
        ])
      );
    });

    it('should validate verified latest documents successfully', async () => {
      const docs: WorkerDocumentRecord[] = [
        {
          id: 10n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs
      );

      expect(res.isValid).toBe(true);
      expect(res.missingDocuments).toHaveLength(0);
      expect(res.unverifiedDocuments).toHaveLength(0);
      expect(res.reasons).toHaveLength(0);
    });

    it('should fail validation when latest document is PENDING', async () => {
      const docs: WorkerDocumentRecord[] = [
        {
          id: 10n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'PENDING',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs
      );

      expect(res.isValid).toBe(false);
      expect(res.unverifiedDocuments).toContain('IDENTITY_PROOF');
      expect(res.reasons[0]).toContain('verification is pending');
    });

    it('should fail validation when latest document is REJECTED', async () => {
      const docs: WorkerDocumentRecord[] = [
        {
          id: 10n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'REJECTED',
          rejectionReason: 'Blurry photo ID',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs
      );

      expect(res.isValid).toBe(false);
      expect(res.unverifiedDocuments).toContain('IDENTITY_PROOF');
      expect(res.reasons[0]).toContain('Blurry photo ID');
    });

    it('ANTI-BYPASS: should evaluate ONLY latest document and NEVER fall back to older verified document', async () => {
      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
        {
          id: 2n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'PENDING', // New replacement under review
          uploadedAt: new Date('2026-01-05T10:00:00Z'),
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs
      );

      // Must fail because latest document is PENDING!
      expect(res.isValid).toBe(false);
      expect(res.unverifiedDocuments).toContain('IDENTITY_PROOF');
      expect(res.reasons[0]).toContain('replacement under review');
    });

    it('ANTI-BYPASS: should fail if latest replacement was REJECTED even with older verified doc', async () => {
      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
        {
          id: 2n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'REJECTED',
          rejectionReason: 'Altered document detected',
          uploadedAt: new Date('2026-01-06T10:00:00Z'),
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs
      );

      expect(res.isValid).toBe(false);
      expect(res.unverifiedDocuments).toContain('IDENTITY_PROOF');
      expect(res.reasons[0]).toContain('Altered document detected');
    });

    it('DETERMINISTIC ORDERING: should use ID DESC as tie-breaker when uploadedAt timestamps are identical', async () => {
      const sharedTime = new Date('2026-01-01T12:00:00Z');
      const docs: WorkerDocumentRecord[] = [
        {
          id: 100n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: sharedTime,
        },
        {
          id: 105n, // Newer ID with same timestamp
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'PENDING',
          uploadedAt: sharedTime,
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs
      );

      // Doc 105n is newer by ID tie-breaker, so it must be evaluated
      expect(res.isValid).toBe(false);
      expect(res.unverifiedDocuments).toContain('IDENTITY_PROOF');
      expect(res.reasons[0]).toContain('verification is pending');
    });
  });

  // ==========================================================================
  // 4. Asia/Kolkata Expiry Rules & Warnings
  // ==========================================================================
  describe('4. Asia/Kolkata Expiry Rules & Warnings', () => {
    it('should fail validation with zero grace days when verified document is expired in Asia/Kolkata', async () => {
      // Expiry on 2026-06-01. Reference date is 2026-06-02
      const referenceDate = new Date('2026-06-02T12:00:00+05:30');
      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2026-06-01T00:00:00Z'),
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs,
        [],
        {},
        referenceDate
      );

      expect(res.isValid).toBe(false);
      expect(res.expiredDocuments).toContain('IDENTITY_PROOF');
      expect(res.reasons[0]).toContain('expired on 2026-06-01');
      expect(res.documentWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documentType: 'IDENTITY_PROOF',
            warning: 'DOCUMENT_EXPIRED',
            daysRemaining: 0,
          }),
        ])
      );
    });

    it('should issue warning 15 days before expiry when document is expiring soon', async () => {
      // Expiry on 2026-06-20. Reference date is 2026-06-10 (10 days remaining <= 15)
      const referenceDate = new Date('2026-06-10T12:00:00+05:30');
      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2026-06-20T00:00:00Z'),
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs,
        [],
        {},
        referenceDate
      );

      // Still valid because not yet expired, but warning is present
      expect(res.isValid).toBe(true);
      expect(res.expiringSoonDocuments).toContain('IDENTITY_PROOF');
      expect(res.documentWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documentType: 'IDENTITY_PROOF',
            warning: 'DOCUMENT_EXPIRING_SOON',
            daysRemaining: 10,
          }),
        ])
      );
    });

    it('should NOT flag warning when document has more than 15 days remaining', async () => {
      const referenceDate = new Date('2026-06-01T12:00:00+05:30');
      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          expiryDate: new Date('2026-07-15T00:00:00Z'), // ~44 days remaining
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'HELPER' },
        docs,
        [],
        {},
        referenceDate
      );

      expect(res.isValid).toBe(true);
      expect(res.expiringSoonDocuments).toHaveLength(0);
      expect(res.documentWarnings).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 5. Skill Verification Requirements
  // ==========================================================================
  describe('5. Skill Verification Requirements', () => {
    it('should fail validation when a required skill category is missing', async () => {
      policyProvider.setWorkerTypeRule('TECHNICIAN', {
        requiredDocumentTypes: ['IDENTITY_PROOF'],
        requiredSkillCategories: ['PLUMBING'],
      });

      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'TECHNICIAN' },
        docs,
        [] // No skills added
      );

      expect(res.isValid).toBe(false);
      expect(res.missingSkills).toContain('PLUMBING');
      expect(res.reasons).toContain("Required skill category 'PLUMBING' is missing.");
    });

    it('should fail validation when a required skill is added but still PENDING', async () => {
      policyProvider.setWorkerTypeRule('TECHNICIAN', {
        requiredDocumentTypes: ['IDENTITY_PROOF'],
        requiredSkillCategories: ['PLUMBING'],
      });

      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const skills: WorkerSkillRecord[] = [
        {
          id: 1n,
          workerId: 10n,
          serviceCategoryId: 5n,
          serviceCategoryCode: 'PLUMBING',
          verificationStatus: 'PENDING',
          isActive: true,
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'TECHNICIAN' },
        docs,
        skills
      );

      expect(res.isValid).toBe(false);
      expect(res.unverifiedSkills).toContain('PLUMBING');
      expect(res.reasons[0]).toContain("Required skill category 'PLUMBING' is not verified");
    });

    it('should pass validation when required skill is VERIFIED and active', async () => {
      policyProvider.setWorkerTypeRule('TECHNICIAN', {
        requiredDocumentTypes: ['IDENTITY_PROOF'],
        requiredSkillCategories: ['PLUMBING'],
      });

      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const skills: WorkerSkillRecord[] = [
        {
          id: 1n,
          workerId: 10n,
          serviceCategoryId: 5n,
          serviceCategoryCode: 'PLUMBING',
          verificationStatus: 'VERIFIED',
          isActive: true,
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'TECHNICIAN' },
        docs,
        skills
      );

      expect(res.isValid).toBe(true);
      expect(res.missingSkills).toHaveLength(0);
      expect(res.unverifiedSkills).toHaveLength(0);
      expect(res.reasons).toHaveLength(0);
    });

    it('should ignore inactive skills even if verified', async () => {
      policyProvider.setWorkerTypeRule('TECHNICIAN', {
        requiredDocumentTypes: ['IDENTITY_PROOF'],
        requiredSkillCategories: ['PLUMBING'],
      });

      const docs: WorkerDocumentRecord[] = [
        {
          id: 1n,
          documentType: 'IDENTITY_PROOF',
          verificationStatus: 'VERIFIED',
          uploadedAt: new Date('2026-01-01T10:00:00Z'),
        },
      ];

      const skills: WorkerSkillRecord[] = [
        {
          id: 1n,
          workerId: 10n,
          serviceCategoryId: 5n,
          serviceCategoryCode: 'PLUMBING',
          verificationStatus: 'VERIFIED',
          isActive: false, // Inactive skill
        },
      ];

      const res = await validationService.validateForApproval(
        { workerType: 'TECHNICIAN' },
        docs,
        skills
      );

      expect(res.isValid).toBe(false);
      expect(res.missingSkills).toContain('PLUMBING');
    });
  });
});
